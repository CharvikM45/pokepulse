import { describe, it, expect, vi } from "vitest";
import { demoCatalog, demoOffers } from "../../packages/fixtures/src";
import {
  canonicalIdentity,
  normalizeGtin,
  mappingDecision,
  safeSourceUrl,
  catalogFilter,
  projectListing,
  stockLabel,
} from "../../packages/domain/src/inventory/catalog";
import {
  FixtureAdapter,
  fetchApprovedObservation,
} from "../../packages/domain/src/inventory/providers";
import {
  matchRule,
  inQuietHours,
  type MatchEvent,
} from "../../packages/domain/src/alerts";
import {
  ruleInputSchema,
  ruleSchema,
  observationSchema,
} from "../../packages/contracts/src";
const rule = ruleSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  enabled: true,
  product_ids: [],
  set_names: [],
  retailer_ids: [],
  product_types: [],
  seller_types: ["retailer"],
  channels: ["ship_to_home"],
  evidence_types: ["retailer_api"],
  max_price_minor: 5000,
  currency: "USD",
  store_ids: [],
  zip: null,
  radius_mi: null,
  triggers: ["restock"],
  delivery_channels: ["in_app"],
  quiet_hours: null,
  daily_cap: 20,
  cooldown_minutes: 0,
});
const event: MatchEvent = {
  id: rule.id,
  event_type: "restock",
  product_id: demoCatalog[0].id,
  set_name: demoCatalog[0].set_name,
  product_type: "multi_pack",
  retailer_id: demoOffers[0].retailer_id,
  seller_type: "retailer",
  channel: "ship_to_home",
  evidence_type: "retailer_api",
  price_minor: 4000,
  currency: "USD",
  region_code: "US",
  stale_after: "2026-11-06T13:00:00Z",
  source_url: "https://example.com/demo",
  is_demo: true,
};
const now = new Date("2026-11-06T12:00:00Z");
describe("catalog identity and source safety", () => {
  it("has 50 identities and keeps edition/format distinct", () => {
    expect(new Set(demoCatalog.map(canonicalIdentity)).size).toBe(50);
    expect(canonicalIdentity(demoCatalog[0])).not.toBe(
      canonicalIdentity({ ...demoCatalog[0], edition: "another" }),
    );
  });
  it("normalizes equivalent GTIN widths and rejects invalid checksums", () => {
    expect(normalizeGtin("036000291452")).toBe(normalizeGtin("00036000291452"));
    expect(() => normalizeGtin("036000291453")).toThrow();
  });
  it("quarantines partial and ambiguous mappings", () => {
    expect(
      mappingDecision({ ...demoCatalog[0], pack_count: null }, demoCatalog)
        .kind,
    ).toBe("review");
    expect(
      mappingDecision(demoCatalog[0], [demoCatalog[0], demoCatalog[0]]).kind,
    ).toBe("review");
    expect(mappingDecision(demoCatalog[0], demoCatalog).kind).toBe("match");
  });
  for (const url of [
    "http://example.com",
    "https://127.0.0.1",
    "https://localhost",
    "https://example.com.evil.test",
    "https://user:pass@example.com",
    "https://example.com:444",
    "https://[::1]",
  ])
    it(`rejects unsafe URL ${url}`, () =>
      expect(() => safeSourceUrl(url, ["example.com"])).toThrow());
  it("filters prices without converting null to zero or mixing currency", () => {
    const results = catalogFilter(demoCatalog, demoOffers, {
      limit: 20,
      max_price_minor: 1,
      currency: "USD",
    });
    expect(results).toHaveLength(0);
  });
  it("ages old observed time despite new ingestion and labels demo", () => {
    const l = projectListing(
      { ...demoOffers[0], ingested_at: "2026-11-07T12:00:00Z" },
      new Date("2026-11-07T12:00:00Z"),
      true,
    );
    expect(l.availability_status).toBe("unknown");
    expect(l.freshness).toBe("stale");
    expect(stockLabel(l)).toContain("DEMO DATA");
    expect(projectListing(l, now, false).freshness).toBe("unavailable");
  });
});
describe("alert matching", () => {
  it("explains a match", () =>
    expect(matchRule(rule, event, now)).toMatchObject({
      matches: true,
      reasons: expect.arrayContaining(["seller", "evidence", "price"]),
    }));
  for (const patch of [
    { price_minor: null },
    { currency: "EUR" },
    { seller_type: "third_party" as const },
    { seller_type: "mixed" as const },
    { evidence_type: "moderated_report" as const },
    { region_code: null, channel: "unknown" as const },
    { stale_after: "2026-11-06T11:00:00Z" },
  ])
    it(`does not match ${JSON.stringify(patch)}`, () =>
      expect(matchRule(rule, { ...event, ...patch }, now).matches).toBe(false));
  it("requires exact local stores or known ZIP distances, never guesses region", () => {
    const local = {
      ...rule,
      evidence_types: ["moderated_report" as const],
      seller_types: [],
      channels: [],
      max_price_minor: null,
      zip: "10001",
      radius_mi: 10,
      store_ids: ["11111111-1111-4111-8111-111111111111"],
    };
    expect(
      matchRule(
        local,
        {
          ...event,
          evidence_type: "moderated_report",
          store_id: rule.id,
          store_zip: "10001",
        },
        now,
      ).matches,
    ).toBe(true);
    expect(
      matchRule(
        local,
        {
          ...event,
          evidence_type: "moderated_report",
          store_id: rule.id,
          store_zip: "10002",
        },
        now,
      ).matches,
    ).toBe(false);
  });
  it("rejects incomplete rule currency and paired geography", () => {
    const { id: unused, ...input } = rule;
    void unused;
    expect(
      ruleInputSchema.safeParse({ ...input, currency: null }).success,
    ).toBe(false);
    expect(ruleInputSchema.safeParse({ ...input, zip: "10001" }).success).toBe(
      false,
    );
  });
  it("handles overnight quiet hours and both fall-back hours", () => {
    const q = { start: "01:00", end: "02:00", time_zone: "America/New_York" };
    expect(inQuietHours(q, new Date("2026-11-01T05:30:00Z"))).toBe(true);
    expect(inQuietHours(q, new Date("2026-11-01T06:30:00Z"))).toBe(true);
    expect(
      inQuietHours({ start: "22:00", end: "07:00", time_zone: "UTC" }, now),
    ).toBe(false);
  });
});
const query = {
  listing_id: demoOffers[0].id,
  source_id: "demo",
  source_item_id: "one",
  source_url: "https://example.com/demo",
  seller_type: "retailer" as const,
  seller_id: "demo-retailer",
  channel: "ship_to_home" as const,
  region_code: "US",
  check_id: "00000000-0000-4000-8000-000000000000",
};
const observation = observationSchema.parse({
  listing_id: query.listing_id,
  source_id: query.source_id,
  seller_type: query.seller_type,
  seller_id: query.seller_id,
  channel: query.channel,
  region_code: query.region_code,
  availability_status: "in_stock",
  observed_at: now.toISOString(),
  evidence_type: "editorial",
  price_minor: 3000,
  currency: "USD",
  parser_version: "fixture-v1",
  payload_hash: "fixture",
});
const config = {
  sourceId: "demo",
  hosts: ["example.com"],
  credential: "fake-test-key",
  permission: {
    status: "approved",
    enabled: true,
    reviewer: "test",
    evidence_url: "https://example.com/test",
  },
};
describe("provider boundary", () => {
  it("replays deterministically", async () => {
    const adapter = new FixtureAdapter([
      { kind: "observation", observation },
      { kind: "temporary_error", reason_code: "timeout" },
    ]);
    expect(await adapter.check(query)).toEqual(await adapter.check(query));
  });
  it("never invokes denied sources even with a key", async () => {
    const fetcher = vi.fn();
    const result = await fetchApprovedObservation(
      { ...config, permission: { ...config.permission, status: "denied" } },
      query,
      (v) => v,
      fetcher,
    );
    expect(result.kind).toBe("not_supported");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("validates explicit observation and hashes the response", async () => {
    const result = await fetchApprovedObservation(
      config,
      query,
      (v) => v,
      vi.fn().mockResolvedValue(new Response(JSON.stringify(observation))),
    );
    expect(result.kind).toBe("observation");
  });
  it("honors Retry-After without inventing negative stock", async () => {
    const result = await fetchApprovedObservation(
      config,
      query,
      (v) => v,
      vi
        .fn()
        .mockResolvedValue(
          new Response("", { status: 429, headers: { "Retry-After": "120" } }),
        ),
    );
    expect(result).toEqual({
      kind: "temporary_error",
      reason_code: "rate_limited",
      retry_after_seconds: 120,
    });
  });
  it("rejects missing stock and ambiguous region", async () => {
    for (const body of [{}, { ...observation, region_code: null }])
      expect(
        (
          await fetchApprovedObservation(
            config,
            query,
            (v) => v,
            vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
          )
        ).kind,
      ).toBe("not_supported");
  });
  it("fails closed on redirects and network errors", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("private token should not escape"));
    const result = await fetchApprovedObservation(
      config,
      query,
      (v) => v,
      fetcher,
    );
    expect(result).toEqual({
      kind: "temporary_error",
      reason_code: "transport_or_schema_error",
    });
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
});
it("exact listing and source/region filters fail closed on missing context", () => {
  const exact = {
    ...rule,
    listing_ids: [demoOffers[0].id],
    region_codes: ["US"],
    source_ids: ["approved-source"],
  };
  expect(
    matchRule(
      exact,
      { ...event, listing_id: demoOffers[0].id, source_id: "approved-source" },
      now,
    ).matches,
  ).toBe(true);
  expect(
    matchRule(
      exact,
      {
        ...event,
        listing_id: demoOffers[0].id,
        source_id: "approved-source",
        region_code: null,
      },
      now,
    ).matches,
  ).toBe(false);
  expect(matchRule(exact, event, now).matches).toBe(false);
});
