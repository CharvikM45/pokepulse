import { z } from "zod";
import {
  normalizedRarity,
  providerIdentity,
} from "../../../packages/domain/src/cards/normalization";
const brief = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(160),
});
const setSchema = brief.extend({
  cards: z.array(brief.extend({ localId: z.string().optional() })).max(2000),
  releaseDate: z.iso.date().optional(),
  serie: brief.optional(),
});
const cardSchema = brief.extend({
  localId: z.string().min(1).max(32),
  set: brief,
  illustrator: z.string().max(200).optional(),
  rarity: z.string().optional(),
  image: z.url().optional(),
  category: z.string().optional(),
  stage: z.string().optional(),
  hp: z.number().int().nonnegative().optional(),
  types: z.array(z.string()).optional(),
  dexId: z.array(z.number().int()).optional(),
  variants: z.record(z.string(), z.boolean()).optional(),
  attacks: z.array(z.record(z.string(), z.unknown())).optional(),
  abilities: z.array(z.record(z.string(), z.unknown())).optional(),
  weaknesses: z.array(z.record(z.string(), z.unknown())).optional(),
  resistances: z.array(z.record(z.string(), z.unknown())).optional(),
  retreat: z.number().optional(),
  regulationMark: z.string().optional(),
  legal: z.record(z.string(), z.boolean()).optional(),
  evolveFrom: z.string().optional(),
});
export interface CatalogPermission {
  id: string;
  enabled: boolean;
  metadata_approved: boolean;
  artwork_approved: boolean;
  retention_approved: boolean;
  allowed_image_hosts: string[];
  reviewer: string | null;
  evidence_url: string | null;
  checked_at: string | null;
}
export function assertCatalogPermission(p: CatalogPermission) {
  if (
    p.id !== "tcgdex" ||
    !p.enabled ||
    !p.metadata_approved ||
    !p.retention_approved ||
    !p.reviewer ||
    !p.evidence_url?.startsWith("https://") ||
    !p.checked_at
  )
    throw new Error("CARD_PROVIDER_NOT_APPROVED");
}
export function normalizeCard(
  input: unknown,
  language: "en" | "ja",
  expectedSet: string,
  permission: CatalogPermission,
) {
  assertCatalogPermission(permission);
  const card = cardSchema.parse(input);
  if (card.set.id !== expectedSet) throw new Error("PROVIDER_SET_CONFLICT");
  const set_id = providerIdentity("tcgdex", language, "set", expectedSet),
    id = providerIdentity("tcgdex", language, "card", card.id);
  const image = card.image ? new URL(card.image) : null;
  const allowed =
    permission.artwork_approved &&
    image?.protocol === "https:" &&
    !image.username &&
    !image.password &&
    !image.port &&
    permission.allowed_image_hosts.includes(image.hostname);
  const artists = card.illustrator ? [card.illustrator.trim()] : [];
  const finishes = Object.entries(card.variants ?? {})
    .filter(
      ([finish, on]) => on && ["normal", "holo", "reverse"].includes(finish),
    )
    .map(([finish]) => finish);
  if (!finishes.length) finishes.push("unspecified");
  return {
    card: {
      id,
      set_id,
      provider_id: "tcgdex",
      provider_card_id: card.id,
      language,
      card_name: card.name,
      card_number: card.localId,
      category: card.category ?? null,
      stage: card.stage ?? null,
      hp: card.hp ?? null,
      types: card.types ?? [],
      pokedex_numbers: card.dexId ?? [],
      artists,
      rarity_original: card.rarity ?? null,
      rarity_normalized: normalizedRarity(card.rarity),
      source_url: `https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(card.id)}`,
      synchronized_at: new Date().toISOString(),
      metadata: {
        attacks: card.attacks ?? [],
        abilities: card.abilities ?? [],
        weaknesses: card.weaknesses ?? [],
        resistances: card.resistances ?? [],
        retreat: card.retreat ?? null,
        regulation: card.regulationMark ?? null,
        legality: card.legal ?? {},
        evolves_from: card.evolveFrom ?? null,
        print_markers: {
          first_edition_available: card.variants?.firstEdition ?? null,
          promo_available: card.variants?.wPromo ?? null,
        },
      },
    },
    variants: finishes.map((finish) => ({
      id: providerIdentity(
        "tcgdex",
        language,
        "variant",
        `${card.id}:${finish}`,
      ),
      set_id,
      card_id: id,
      finish,
      edition: "",
      print_markers: {},
      rarity: card.rarity ?? null,
      eligible_for_packs: false,
      image_url: allowed ? card.image + "/high.webp" : null,
      image_rights_cleared: !!allowed,
    })),
  };
}
export class TcgdexAdapter {
  private nextRequest = 0;
  constructor(
    private permission: CatalogPermission,
    private fetcher: typeof fetch = fetch,
    private sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}
  async get(path: string) {
    assertCatalogPermission(this.permission);
    if (!/^\/(en|ja)\/(sets|cards)(\/[A-Za-z0-9_.%-]+)?$/.test(path))
      throw new Error("INVALID_PROVIDER_PATH");
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.sleep(Math.max(0, this.nextRequest - Date.now()));
      this.nextRequest = Date.now() + 750;
      let response: Response;
      try {
        response = await this.fetcher(`https://api.tcgdex.net/v2${path}`, {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: { Accept: "application/json" },
        });
      } catch (error) {
        if (attempt === 3) throw error;
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get("retry-after");
        const delay = retry
          ? Number.isFinite(Number(retry))
            ? Number(retry) * 1000
            : Date.parse(retry) - Date.now()
          : 1000 * 2 ** attempt;
        await response.body?.cancel();
        if (attempt === 3) throw new Error("PROVIDER_RETRY_EXHAUSTED");
        await this.sleep(Math.min(30000, Math.max(1000, delay || 1000)));
        continue;
      }
      if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("EMPTY_PROVIDER_RESPONSE");
      let size = 0,
        text = "";
      const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 4_000_000) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
          text += decoder.decode(part.value, { stream: true });
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(text + decoder.decode()) as unknown;
    }
    throw new Error("PROVIDER_UNAVAILABLE");
  }
  async sets(language: "en" | "ja") {
    return z
      .array(brief)
      .max(3000)
      .parse(await this.get(`/${language}/sets`))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  async set(language: "en" | "ja", id: string) {
    return setSchema.parse(
      await this.get(`/${language}/sets/${encodeURIComponent(id)}`),
    );
  }
  async card(language: "en" | "ja", id: string) {
    return this.get(`/${language}/cards/${encodeURIComponent(id)}`);
  }
}
