/** Additive collector API schemas; see docs/adr/0003-collector-contracts.md. */
import { z } from "zod";
export const uuid = z.uuid();
export const modeSchema = z.enum(["real", "virtual"]);
export const goalSchema = z.enum(["base", "master", "extended"]);
export const mapSchema = z.object({
  enabled: z.boolean(),
  config: z
    .object({ template: z.string(), attribution: z.string(), host: z.string() })
    .nullable(),
});
export const variantSchema = z.object({
  id: uuid,
  set_id: uuid,
  card_number: z.string(),
  card_name: z.string(),
  rarity: z.string().nullable().default(null),
  image_url: z.null().default(null),
  image_rights_cleared: z.literal(false).default(false),
  finish: z.string(),
  eligible_for_packs: z.boolean(),
});
export const manifestSchema = z.object({
  set_id: uuid,
  version: z.string(),
  validated: z.boolean(),
  supported_goals: z.array(goalSchema),
  requirements: z.array(
    z.object({
      variant_id: uuid,
      collectible_key: z.string(),
      scope: goalSchema,
      rationale: z.string(),
    }),
  ),
});
export const oddsSchema = z.object({
  version: z.string(),
  model: z.enum(["fictional", "estimated"]),
  methodology: z.string(),
  sample_size: z.number().int().nullable(),
  source_url: z.string().nullable(),
  checked_label: z.string().nullable(),
  uncertainty: z.string().nullable(),
  slots: z.array(
    z.object({
      label: z.string(),
      outcomes: z.array(
        z.object({ label: z.string(), probability: z.string() }),
      ),
    }),
  ),
});
export const setSchema = z.object({
  id: uuid,
  name: z.string(),
  metadata_source: z.string(),
  metadata_permission_checked_at: z.string().nullable(),
  release_date: z.string().nullable(),
  manifest_version: z.string().nullable(),
  odds_version: z.string().nullable(),
  enabled_for_simulation: z.boolean(),
  rights_status: z.enum(["approved", "metadata_only", "disabled"]),
  enabled: z.boolean(),
  is_demo: z.boolean(),
  coin_cost: z.number().int().nullable(),
  odds: oddsSchema.nullable(),
});
export const setsSchema = z.object({
  enabled: z.boolean(),
  sets: z.array(setSchema),
});
export const cardsSchema = z.object({
  variants: z.array(variantSchema),
  manifest: manifestSchema.nullable(),
  is_demo: z.boolean(),
  metadata_source: z.string(),
});
export const openingSchema = z.object({
  id: uuid,
  set_id: uuid,
  set_name: z.string(),
  opened_at: z.string(),
  odds_version: z.string(),
  spent_coins: z.number().int().nonnegative(),
  used_free_open: z.boolean(),
  opening_status: z.literal("committed"),
  cards: z.array(
    z.object({
      card_variant_id: uuid,
      slot_index: z.number().int(),
      card_name: z.string(),
      card_number: z.string(),
      finish: z.string(),
    }),
  ),
});
export const summarySchema = z.object({
  id: uuid,
  set_name: z.string(),
  opened_at_label: z.string(),
  odds_version: z.string(),
});
export const historySchema = z.object({
  openings: z.array(summarySchema),
  next_cursor: z.string().nullable(),
});
export const labSchema = z.object({
  balance: z.number().int().nonnegative(),
  welcome_grant_on_first_open: z.number().int(),
  free_open_available: z.boolean(),
  allowance_note: z.string(),
  history: z.array(summarySchema),
  next_cursor: z.string().nullable(),
});
export const collectionProgressSchema = z.object({
  set_id: uuid,
  mode: modeSchema,
  base_collected: z.number().int().nonnegative(),
  base_required: z.number().int().nonnegative(),
  master_collected: z.number().int().nonnegative().nullable(),
  master_required: z.number().int().nonnegative().nullable(),
  extended_collected: z.number().int().nonnegative().nullable(),
  extended_required: z.number().int().nonnegative().nullable(),
  manifest_version: z.string(),
});
export const inventorySchema = z.object({
  entries: z.array(
    z.object({ variant_id: uuid, quantity: z.number().int().nonnegative() }),
  ),
  realNotes: z.record(z.string(), z.string()),
  mode: modeSchema,
  progress: collectionProgressSchema.nullable(),
});
export const releaseSchema = z.object({
  id: uuid,
  product_id: uuid.nullable(),
  name: z.string(),
  date: z.string().nullable(),
  date_precision: z.enum(["day", "month", "unconfirmed"]),
  event_type: z.enum(["release", "preorder", "announcement"]),
  region: z.string().nullable(),
  source_url: z.string(),
  verified_at: z.string(),
  is_demo: z.boolean(),
});
export const releaseInput = releaseSchema
  .omit({ id: true })
  .extend({ status: z.enum(["published", "withdrawn"]) })
  .strict();
export const editableRelease = releaseInput.extend({
  id: uuid,
  revision: z.number().int().nonnegative(),
});
export const releaseDraft = z
  .object({
    release_id: uuid.nullable(),
    expected_revision: z.number().int().nonnegative(),
    entry: releaseInput,
    reason: z.string().min(1).max(500),
  })
  .strict();
export const storeSchema = z.object({
  id: uuid,
  name: z.string(),
  address: z.string().nullable(),
  region: z.string().nullable(),
  distance_mi: z.number().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  directory_source: z.string(),
  is_demo: z.boolean(),
});
export const storesSchema = z.object({
  stores: z.array(storeSchema),
  next_cursor: z.string().nullable(),
});
export const sightingSchema = z.object({
  id: uuid,
  store_id: uuid,
  product_id: uuid.nullable(),
  report_type: z.enum(["found_stock", "shelf_empty"]),
  submitted_at: z.string(),
  observed_at: z.string(),
  expires_at: z.string(),
  moderation: z.enum(["pending", "approved", "rejected", "expired"]),
  independent_confirmations: z.number().int(),
  conflict_count: z.number().int(),
  public_notes: z.string().nullable(),
  is_demo: z.boolean(),
});
export const reportDraft = z
  .object({
    store_id: uuid,
    product_id: uuid.nullable(),
    report_type: z.enum(["found_stock", "shelf_empty"]),
    observed_at: z.iso.datetime({ offset: true }),
    notes: z.string().max(280),
  })
  .strict();
export const reviewSchema = z.object({
  id: uuid,
  store_name: z.string(),
  product_name: z.string().nullable(),
  report_type: z.enum(["found_stock", "shelf_empty"]),
  moderation: z.enum(["pending", "approved", "rejected", "expired"]),
  observed_at: z.string(),
  expires_at: z.string(),
  private_notes: z.string(),
  public_notes: z.string().nullable(),
  is_demo: z.boolean(),
  submitted_by_current_staff: z.boolean(),
  revision: z.number().int(),
});
export const reviewDraft = z
  .object({
    sighting_id: uuid,
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().min(1).max(500),
    public_notes: z.string().max(280).nullable(),
    expected_revision: z.number().int().nonnegative(),
  })
  .strict();
export const reviewReceipt = z.object({
  id: uuid,
  moderation: z.enum(["approved", "rejected"]),
  revision: z.number().int(),
});

export type StoreDTO = z.infer<typeof storeSchema>;
export type CollectionSnapshotDTO = z.infer<typeof inventorySchema>;
