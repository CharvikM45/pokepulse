import { z } from "zod";
import { variantSchema } from "./collector";
export const cardConditions = [
  "unknown",
  "near_mint",
  "lightly_played",
  "moderately_played",
  "heavily_played",
  "damaged",
] as const;
const multi = z
  .preprocess(
    (v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v),
    z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  )
  .optional();
export const cardSearchQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    artist: multi,
    rarity: multi,
    type: multi,
    set_id: z.uuid().optional(),
    series: z.string().max(100).optional(),
    language: z.enum(["en", "ja"]).optional(),
    pokedex: z.coerce.number().int().min(1).max(10000).optional(),
    finish: z.string().max(64).optional(),
    ownership: z.enum(["all", "owned", "missing"]).default("all"),
    sort: z.enum(["name", "release", "price", "popular"]).default("name"),
    min_price: z.coerce.number().int().min(0).max(1e12).optional(),
    max_price: z.coerce.number().int().min(0).max(1e12).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
    limit: z.coerce.number().int().min(1).max(50).default(24),
    cursor: z.string().max(4096).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.min_price === undefined ||
      v.max_price === undefined ||
      v.min_price <= v.max_price,
    "Minimum price exceeds maximum",
  );
export const priceObservationSchema = z.object({
  id: z.uuid(),
  variant_id: z.uuid(),
  provider_id: z.string(),
  condition: z.enum(cardConditions),
  grading_company: z.string(),
  grade: z.string(),
  currency: z.string(),
  statistic: z.string(),
  amount_minor: z.number().nonnegative(),
  observed_at: z.iso.datetime({ offset: true }),
  captured_at: z.iso.datetime({ offset: true }),
  source_url: z.url(),
});
export const singleCardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  number: z.string(),
  set_id: z.uuid(),
  set_name: z.string(),
  language: z.string().nullable(),
  region: z.string().nullable(),
  series: z.string().nullable(),
  release_date: z.string().nullable(),
  artists: z.array(z.string()),
  types: z.array(z.string()),
  pokedex_numbers: z.array(z.number().int()),
  rarity: z.string().nullable(),
  rarity_original: z.string().nullable(),
  category: z.string().nullable(),
  stage: z.string().nullable(),
  hp: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  source_url: z.url().nullable(),
  synchronized_at: z.string().nullable(),
  favorites: z.number().int().nonnegative(),
  reference_prices: z.array(priceObservationSchema).default([]),
  variants: z.array(variantSchema),
});
export const cardSearchResult = z.object({
  title: z.string().optional(),
  cards: z.array(singleCardSchema),
});
export const cardIndexEntry = z.object({
  id: z.uuid(),
  name: z.string(),
  language: z.string().nullable().optional(),
  series: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  count: z.number().int(),
});
export const cardIndexResult = z.object({ entries: z.array(cardIndexEntry) });
export const coverageSchema = z.object({
  printings: z.number().int(),
  variants: z.number().int(),
  sets: z.number().int(),
  artists: z.number().int(),
  languages: z.array(z.string()),
  approved_providers: z.array(z.string()),
  art_enabled: z.boolean(),
  measured_at: z.string(),
});

export const pricesSchema = z.object({
  observations: z.array(priceObservationSchema),
  currency: z.string(),
  statistic: z.string(),
  condition: z.string(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  change: z.number().nullable(),
  change_percent: z.number().nullable(),
  last_observed_at: z.string().nullable(),
  count: z.number().int(),
  stale: z.boolean(),
  next_cursor: z.string().nullable(),
});
export const lotInputSchema = z
  .object({
    variant_id: z.uuid(),
    quantity: z.number().int().min(1).max(9999),
    condition: z.enum(cardConditions).default("unknown"),
    grading_company: z.string().max(40).default(""),
    grade: z.string().max(20).default(""),
    acquired_on: z.iso.date().nullable().optional(),
    cost_minor: z.number().int().min(0).max(1e12).nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    notes: z.string().max(500).default(""),
    binder: z.string().max(100).default(""),
    page: z.number().int().min(1).max(1000).nullable().optional(),
    position: z.number().int().min(1).max(100).nullable().optional(),
  })
  .strict()
  .refine(
    (v) => (v.cost_minor == null) === (v.currency == null),
    "Cost requires currency",
  )
  .refine(
    (v) => Boolean(v.grade) === Boolean(v.grading_company),
    "Grade requires grading company",
  );
export const lotSchema = lotInputSchema.safeExtend({
  id: z.uuid(),
  user_id: z.uuid(),
  created_at: z.string(),
  card_name: z.string().optional(),
  card_id: z.uuid().optional(),
});
export const actionInputSchema = z
  .object({ card_id: z.uuid(), active: z.boolean() })
  .strict();
export const portfolioSchema = z.object({
  references: z.array(
    z.object({
      variant_id: z.uuid(),
      provider_id: z.string(),
      source_url: z.url(),
      observed_at: z.string(),
      amount_minor: z.number(),
      currency: z.string(),
      condition: z.string(),
      grading_company: z.string(),
      grade: z.string(),
    }),
  ),
  breakdowns: z.record(
    z.string(),
    z.array(z.object({ label: z.string(), copies: z.number().int() })),
  ),
  currency: z.string(),
  statistic: z.string(),
  copies: z.number().int(),
  unique_variants: z.number().int(),
  unique_printings: z.number().int(),
  valued_copies: z.number().int(),
  unpriced_copies: z.number().int(),
  stale_copies: z.number().int(),
  value_minor: z.number().nullable(),
  cost_minor: z.number().nullable(),
  comparable_cost_minor: z.number().nullable(),
  gain_minor: z.number().nullable(),
  untracked_copies: z.number().int(),
  cost_coverage_copies: z.number().int(),
  sets: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      copies: z.number().int(),
      variants: z.number().int(),
    }),
  ),
  lots: z.array(lotSchema),
  top_cards: z.array(
    z.object({
      name: z.string(),
      value_minor: z.number(),
      quantity: z.number().int(),
    }),
  ),
  actions: z.array(
    z.object({
      card_id: z.uuid(),
      kind: z.enum(["favorite", "wishlist"]),
      name: z.string(),
    }),
  ),
  history: z.array(
    z.object({
      id: z.uuid(),
      captured_at: z.string(),
      kind: z.literal("observed"),
      value_minor: z.number().nullable(),
      valued_copies: z.number().int(),
    }),
  ),
});
export type SingleCard = z.infer<typeof singleCardSchema>;
export type PhysicalLotInput = z.infer<typeof lotInputSchema>;
