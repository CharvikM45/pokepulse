import { describe, it, expect, vi } from "vitest";
import {
  cardSearchQuery,
  lotInputSchema,
} from "../../packages/contracts/src/cards";
import {
  providerIdentity,
  normalizedRarity,
} from "../../packages/domain/src/cards/normalization";
import { priceSeries, csvCell } from "../../packages/domain/src/cards/pricing";
import { parseCopyCsv } from "../../packages/domain/src/cards/csv";
import {
  TcgdexAdapter,
  normalizeCard,
  type CatalogPermission,
} from "../../services/ingestion/cards/tcgdex";
const permission: CatalogPermission = {
  id: "tcgdex",
  enabled: true,
  metadata_approved: true,
  artwork_approved: false,
  retention_approved: true,
  allowed_image_hosts: ["assets.tcgdex.net"],
  reviewer: "test",
  evidence_url: "https://example.com/review",
  checked_at: "2026-11-16T00:00:00Z",
};
const input = {
  id: "set-1",
  name: "Pikachu",
  localId: "1",
  set: { id: "set", name: "Set" },
  rarity: "Special illustration rare",
  illustrator: "Test illustrator",
  image: "https://assets.tcgdex.net/en/test/1",
  variants: { normal: true, holo: true },
};
describe("catalog identity and approval", () => {
  it("keeps same-name regional printings distinct and repeat sync stable", () => {
    expect(providerIdentity("tcgdex", "en", "card", "set-1")).not.toBe(
      providerIdentity("tcgdex", "ja", "card", "set-1"),
    );
    expect(providerIdentity("tcgdex", "en", "card", "set-1")).toBe(
      providerIdentity("tcgdex", "en", "card", "set-1"),
    );
    expect(normalizedRarity("Uncommon")).toBe("uncommon");
  });
  it("retains illustrator/provider rarity and denies unapproved images", () => {
    const result = normalizeCard(input, "en", "set", permission);
    expect(result.card.artists).toEqual(["Test illustrator"]);
    expect(result.card.rarity_original).toBe(input.rarity);
    expect(result.card.rarity_normalized).toBe("special_illustration_rare");
    expect(result.variants).toHaveLength(2);
    expect(
      result.variants.every(
        (v) => v.image_url === null && !v.eligible_for_packs,
      ),
    ).toBe(true);
  });
  it("rejects a source/set conflict and unapproved fetch before network", async () => {
    expect(() => normalizeCard(input, "en", "other", permission)).toThrow(
      "PROVIDER_SET_CONFLICT",
    );
    const fetcher = vi.fn();
    await expect(
      new TcgdexAdapter({ ...permission, enabled: false }, fetcher).sets("en"),
    ).rejects.toThrow("CARD_PROVIDER_NOT_APPROVED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not approve arbitrary artwork hosts", () => {
    expect(
      normalizeCard(
        { ...input, image: "https://untrusted.test/1" },
        "en",
        "set",
        { ...permission, artwork_approved: true },
      ).variants[0].image_url,
    ).toBeNull();
  });
  it("retries bounded provider rate limits", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "1" } }),
      )
      .mockResolvedValueOnce(Response.json([{ id: "set", name: "Set" }]));
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(
      await new TcgdexAdapter(permission, fetcher, sleep).sets("en"),
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});
describe("price and copy data boundaries", () => {
  const row = {
    amount_minor: 100,
    observed_at: "2026-11-15T00:00:00Z",
    variant_id: "v",
    currency: "USD",
    condition: "unknown",
    grading_company: "",
    grade: "",
    statistic: "market",
    provider_id: "one",
  };
  it("never invents history or percent change from one sample", () => {
    expect(priceSeries([], Date.parse("2026-11-16"))).toMatchObject({
      count: 0,
      change: null,
      min: null,
    });
    expect(priceSeries([row], Date.parse("2026-11-16"))).toMatchObject({
      count: 1,
      change: null,
      stale: false,
    });
    expect(
      priceSeries(
        [
          { ...row, amount_minor: 0 },
          { ...row, observed_at: "2026-11-16", amount_minor: 10 },
        ],
        Date.parse("2026-11-17"),
      ),
    ).toMatchObject({ change: 10, change_percent: null });
  });
  it("refuses mixed currencies, variants, providers, grades and conditions", () => {
    for (const patch of [
      { currency: "JPY" },
      { variant_id: "other" },
      { provider_id: "two" },
      { condition: "near_mint" },
      { grade: "10", grading_company: "PSA" },
    ])
      expect(() => priceSeries([row, { ...row, ...patch }])).toThrow(
        "INCOMPARABLE_PRICES",
      );
    expect(priceSeries([row], Date.parse("2026-12-01")).stale).toBe(true);
  });
  it("requires paired cost and grade, strictly bounds queries", () => {
    const lot = { variant_id: crypto.randomUUID(), quantity: 1 };
    expect(lotInputSchema.safeParse({ ...lot, cost_minor: 100 }).success).toBe(
      false,
    );
    expect(lotInputSchema.safeParse({ ...lot, grade: "10" }).success).toBe(
      false,
    );
    expect(cardSearchQuery.safeParse({ limit: 51 }).success).toBe(false);
    expect(cardSearchQuery.safeParse({ surprise: "field" }).success).toBe(
      false,
    );
    expect(cardSearchQuery.parse({ rarity: "rare,ultra_rare" }).rarity).toEqual(
      ["rare", "ultra_rare"],
    );
  });
  it("parses quoted CSV and neutralizes spreadsheet formulas on export", () => {
    const id = crypto.randomUUID();
    expect(
      parseCopyCsv(
        `variant_id,quantity,notes\r\n${id},2,"hello, \"\"friend\"\""`,
      )[0].notes,
    ).toBe('hello, "friend"');
    expect(csvCell("=IMPORTXML(1)")).toBe('"\'=IMPORTXML(1)"');
    expect(() =>
      parseCopyCsv("variant_id,variant_id,quantity\na,b,2"),
    ).toThrow();
  });
});

it("keeps multilingual printing identities distinct and accepts the supported catalog locales", () => {
  const languages = [
    "en",
    "ja",
    "fr",
    "de",
    "es",
    "it",
    "pt",
    "es-mx",
    "zh-tw",
    "zh-cn",
    "ko",
    "th",
    "id",
  ];
  const ids = languages.map((language) =>
    providerIdentity("tcgdex", language, "card", "base1-4"),
  );
  expect(new Set(ids).size).toBe(languages.length);
  for (const language of languages)
    expect(cardSearchQuery.parse({ language }).language).toBe(language);
  expect(() =>
    providerIdentity("tcgdex", "invented", "card", "base1-4"),
  ).toThrow();
});
