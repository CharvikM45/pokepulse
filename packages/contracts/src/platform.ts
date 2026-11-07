import { z } from "zod";
import {
  availabilitySchema,
  evidenceSchema,
  sellerSchema,
  channelSchema,
  freshnessSchema,
  productSchema,
  listingSchema,
} from "./schemas";
const id = z.uuid();
const ids = z.array(id).max(200);
const texts = z.array(z.string().min(1).max(100)).max(50);
export const timeZoneSchema = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, "Invalid IANA time zone");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const quietHoursSchema = z
  .object({ start: hhmm, end: hhmm, time_zone: timeZoneSchema })
  .strict();
export const ruleFields = {
  listing_ids: ids.optional(),
  region_codes: texts.optional(),
  source_ids: texts.optional(),
  enabled: z.boolean(),
  product_ids: ids,
  set_names: texts,
  retailer_ids: ids,
  product_types: texts,
  seller_types: z.array(sellerSchema).max(4),
  channels: z.array(channelSchema).max(4),
  evidence_types: z.array(evidenceSchema).max(4),
  max_price_minor: z.number().int().nonnegative().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  store_ids: ids,
  zip: z
    .string()
    .regex(/^\d{5}$/)
    .nullable(),
  radius_mi: z.number().int().min(1).max(100).nullable(),
  triggers: z
    .array(
      z.enum([
        "restock",
        "new_listing",
        "local_sighting",
        "price_drop",
        "release_reminder",
      ]),
    )
    .min(1)
    .max(5),
  delivery_channels: z
    .array(z.enum(["in_app", "web_push"]))
    .min(1)
    .max(2),
  quiet_hours: quietHoursSchema.nullable(),
  daily_cap: z.number().int().min(1).max(100),
  cooldown_minutes: z.number().int().min(0).max(10080),
};
const validRule = (v: {
  max_price_minor: number | null;
  currency: string | null;
  zip: string | null;
  radius_mi: number | null;
}) =>
  (v.max_price_minor === null || v.currency !== null) &&
  (v.zip === null) === (v.radius_mi === null);
export const ruleInputSchema = z
  .object(ruleFields)
  .strict()
  .refine(validRule, "Price requires currency; ZIP and radius must be paired");
export const ruleSchema = z
  .object({ id, ...ruleFields })
  .strict()
  .refine(validRule);
export const watchInputSchema = z
  .object({
    product_id: id.nullable().default(null),
    listing_id: id.nullable().default(null),
  })
  .strict()
  .refine(
    (v) => (v.product_id === null) !== (v.listing_id === null),
    "Select exactly one product or listing",
  );
export const watchSchema = z.object({
  id,
  product_id: id.nullable(),
  listing_id: id.nullable(),
  created_at: z.string(),
});
export const preferencesSchema = z
  .object({
    in_app: z.boolean(),
    web_push: z.boolean(),
    zip: z
      .string()
      .regex(/^\d{5}$/)
      .nullable(),
    time_zone: timeZoneSchema,
    quiet_hours: quietHoursSchema.nullable(),
    daily_cap: z.number().int().min(1).max(100),
  })
  .strict();
export const preferencesPatchSchema = preferencesSchema.partial();
export const notificationSchema = z.object({
  id,
  rule_id: id.nullable(),
  event_id: id.nullable(),
  channel: z.enum(["in_app", "web_push"]),
  created_at: z.string(),
  read_at: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  action_url: z.string().nullable(),
  evidence_type: evidenceSchema.nullable(),
  observed_at: z.string().nullable(),
});
export const productRecordSchema = productSchema.extend({
  is_demo: z.boolean(),
});
export type ProductRecord = z.infer<typeof productRecordSchema>;
export const retailerSchema = z.object({
  id,
  name: z.string(),
  website: z.url(),
  is_demo: z.boolean(),
  coverage: z.string(),
});
export const stockEventSchema = z.object({
  id,
  listing_id: id,
  previous_status: availabilitySchema,
  current_status: availabilitySchema,
  observed_at: z.string(),
  ingested_at: z.string(),
  evidence_type: evidenceSchema,
  source_id: z.string(),
  price_minor: z.number().int().nullable(),
  currency: z.string().nullable(),
});
export const detailSchema = z.object({
  product: productRecordSchema,
  offers: z.array(listingSchema),
  history: z.array(stockEventSchema),
});
export const catalogQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: id.optional(),
    q: z.string().max(100).optional(),
    set_name: z.string().max(100).optional(),
    product_type: z.string().max(100).optional(),
    seller_type: sellerSchema.optional(),
    retailer_id: id.optional(),
    max_price_minor: z.coerce.number().int().nonnegative().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    availability_status: availabilitySchema.optional(),
    evidence_type: evidenceSchema.optional(),
    freshness: freshnessSchema.optional(),
  })
  .strict()
  .refine(
    (v) => v.max_price_minor === undefined || v.currency !== undefined,
    "Price filter requires currency",
  );
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export const observationSchema = z
  .object({
    listing_id: id,
    source_id: z.string().min(1),
    availability_status: availabilitySchema,
    observed_at: z.iso.datetime({ offset: true }),
    evidence_type: evidenceSchema,
    price_minor: z.number().int().nonnegative().nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    seller_type: sellerSchema,
    seller_id: z.string().nullable(),
    channel: channelSchema,
    region_code: z.string().nullable(),
    parser_version: z.string().min(1),
    payload_hash: z.string().min(1),
  })
  .strict();
export type NormalizedProviderObservation = z.infer<typeof observationSchema>;
export const providerOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("observation"), observation: observationSchema }),
  z.object({ kind: z.literal("not_supported"), reason: z.string().max(80) }),
  z.object({
    kind: z.literal("temporary_error"),
    reason_code: z.string().max(80),
    retry_after_seconds: z.number().int().min(0).max(86400).optional(),
  }),
]);
export type ProviderCheckOutcome = z.infer<typeof providerOutcomeSchema>;
export interface ProviderCheckQuery {
  listing_id: string;
  source_id: string;
  source_item_id: string;
  source_url: string;
  seller_type: z.infer<typeof sellerSchema>;
  seller_id: string | null;
  channel: z.infer<typeof channelSchema>;
  region_code: string | null;
  check_id: string;
}
export interface StockProviderAdapter {
  sourceId: string;
  capabilities: {
    availability: boolean;
    price: boolean;
    seller: boolean;
    shipping: boolean;
    pickup: boolean;
    regionality: boolean;
  };
  check(query: ProviderCheckQuery): Promise<ProviderCheckOutcome>;
}
export const localEventSchema = z
  .object({
    event_id: id,
    event_type: z.literal("sighting_approved"),
    occurred_at: z.iso.datetime({ offset: true }),
    evidence_type: z.literal("moderated_report"),
    entity_id: id,
    region_code: z.string().nullable(),
    payload_version: z.literal(1),
    payload: z
      .object({
        store_id: id,
        product_id: id.nullable(),
        set_name: z.string().nullable(),
        product_type: z.string().nullable(),
        expires_at: z.iso.datetime({ offset: true }),
        store_zip: z
          .string()
          .regex(/^\d{5}$/)
          .nullable(),
        source_url: z.url().nullable(),
        is_demo: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type LocalSightingEvent = z.infer<typeof localEventSchema>;
export const pushSubscriptionSchema = z
  .object({
    endpoint: z.url().max(4096),
    keys: z
      .object({
        p256dh: z.string().min(16).max(256),
        auth: z.string().min(8).max(256),
      })
      .strict(),
  })
  .strict();
export const privacyJobSchema = z.object({
  id,
  kind: z.enum(["export", "delete"]),
  status: z.enum(["pending", "running", "completed", "blocked", "failed"]),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  error_code: z.string().nullable(),
});
