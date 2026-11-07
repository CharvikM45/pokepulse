import { z } from "zod";
import type { ProductDTO, ListingDTO } from "./types";
export const availabilitySchema = z.enum([
  "in_stock",
  "out_of_stock",
  "preorder",
  "unknown",
]);
export const evidenceSchema = z.enum([
  "retailer_api",
  "permitted_partner",
  "moderated_report",
  "editorial",
]);
export const freshnessSchema = z.enum([
  "fresh",
  "aging",
  "stale",
  "unavailable",
]);
export const sellerSchema = z.enum([
  "retailer",
  "third_party",
  "mixed",
  "unknown",
]);
export const channelSchema = z.enum([
  "ship_to_home",
  "pickup",
  "in_store_report",
  "unknown",
]);
const timestamp = z.iso.datetime({ offset: true });
const price = z.number().int().nonnegative().nullable();
export const productSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  set_name: z.string().nullable(),
  era: z.string().nullable(),
  product_type: z.string(),
  language: z.string().nullable(),
  release_region: z.string().nullable(),
  edition: z.string().nullable(),
  pack_count: z.number().int().positive().nullable(),
  gtin: z.string().nullable(),
  release_date: z.iso.date().nullable(),
  reference_price_minor: price,
  reference_price_currency: z.string().length(3).nullable(),
  reference_price_source: z.string().nullable(),
  image_url: z.url().nullable(),
}) satisfies z.ZodType<ProductDTO>;
// Additive demo marker resolves the source specification's ProductDTO/seed-label mismatch.
export const demoProductSchema = z.object({
  ...productSchema.shape,
  is_demo: z.literal(true),
});
export type DemoProductDTO = z.infer<typeof demoProductSchema>;
export const listingSchema: z.ZodType<ListingDTO> = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  retailer_id: z.uuid(),
  retailer_name: z.string(),
  retailer_url: z.url(),
  seller_type: sellerSchema,
  channel: channelSchema,
  region_code: z.string().nullable(),
  price_minor: price,
  currency: z.string().length(3).nullable(),
  availability_status: availabilitySchema,
  evidence_type: evidenceSchema,
  freshness: freshnessSchema,
  observed_at: timestamp.nullable(),
  ingested_at: timestamp.nullable(),
  last_successful_check_at: timestamp.nullable(),
  stale_after: timestamp.nullable(),
  source_id: z.string().nullable(),
  source_url: z.url().nullable(),
  is_demo: z.boolean(),
  evidence_summary: z.string(),
});
export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "SOURCE_UNAVAILABLE",
  "RIGHTS_DISABLED",
  "INTERNAL_ERROR",
]);
export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
  meta: z.object({ request_id: z.uuid() }),
});
export const successSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    data,
    meta: z.object({
      request_id: z.uuid(),
      next_cursor: z.string().nullable().optional(),
    }),
  });
export const pageQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.uuid().optional(),
  })
  .strict();
