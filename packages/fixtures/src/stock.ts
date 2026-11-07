import { demoProductSchema, listingSchema } from "@pokepulse/contracts";
export const fixtureClock = "2026-11-06T12:00:00Z";
export const products = [
  demoProductSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    slug: "demo-starlight-box",
    name: "Demo Starlight Box",
    set_name: "Original Demo Set",
    era: null,
    product_type: "booster_box",
    language: "en",
    release_region: "US",
    edition: null,
    pack_count: 12,
    gtin: null,
    release_date: null,
    reference_price_minor: null,
    reference_price_currency: null,
    reference_price_source: null,
    image_url: null,
    is_demo: true,
  }),
];
const base = listingSchema.parse({
  id: "00000000-0000-4000-8000-000000000010",
  product_id: products[0].id,
  retailer_id: "00000000-0000-4000-8000-000000000020",
  retailer_name: "Demo retailer",
  retailer_url: "https://example.com/demo",
  seller_type: "retailer",
  channel: "ship_to_home",
  region_code: "US",
  price_minor: 4999,
  currency: "USD",
  availability_status: "in_stock",
  evidence_type: "editorial",
  freshness: "fresh",
  observed_at: fixtureClock,
  ingested_at: fixtureClock,
  last_successful_check_at: fixtureClock,
  stale_after: "2026-11-06T12:15:00Z",
  source_id: "demo",
  source_url: "https://example.com/demo",
  is_demo: true,
  evidence_summary: "DEMO DATA — synthetic evidence, never retailer verified.",
});
export const in_stock_fresh = base;
export const out_of_stock_explicit = {
  ...base,
  availability_status: "out_of_stock" as const,
};
export const preorder = { ...base, availability_status: "preorder" as const };
export const last_known_stale = {
  ...base,
  availability_status: "unknown" as const,
  freshness: "stale" as const,
};
export const third_party_seller = {
  ...base,
  seller_type: "third_party" as const,
};
export const missing_stock_field = {
  kind: "not_supported" as const,
  reason: "missing_stock_field",
};
export const rate_limited_source = {
  kind: "temporary_error" as const,
  reason_code: "rate_limited",
  retry_after_seconds: 60,
};
export const source_timeout = {
  kind: "temporary_error" as const,
  reason_code: "timeout",
};
export const conflicting_source_data = [in_stock_fresh, out_of_stock_explicit];
export const SKU_collision = [
  products[0],
  {
    ...products[0],
    id: "00000000-0000-4000-8000-000000000002",
    slug: "demo-starlight-exclusive",
    edition: "exclusive",
  },
];
export const same_event_replayed = [
  "00000000-0000-4000-8000-000000000030",
  "00000000-0000-4000-8000-000000000030",
];
/** Fixed clock is for tests only. API applies server time to historical fixtures. */
export function demoListings(now: Date) {
  return [
    {
      ...base,
      ...(now.getTime() >= Date.parse(base.stale_after!)
        ? {
            availability_status: "unknown" as const,
            freshness: "stale" as const,
          }
        : {}),
    },
  ];
}
