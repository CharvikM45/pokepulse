import "server-only";
import { z } from "zod";
import {
  listingSchema,
  productRecordSchema,
  stockEventSchema,
  type ListingDTO,
  type StockEventDTO,
} from "@pokepulse/contracts";
import { demoCatalog, demoOffers } from "@pokepulse/fixtures";
import { projectListing } from "@pokepulse/domain";
import { adminDb, configured, dbError } from "./server";
const observation = z.object({
  id: z.string(),
  listing_id: z.string(),
  availability_status: z.enum([
    "in_stock",
    "out_of_stock",
    "preorder",
    "unknown",
  ]),
  evidence_type: z.enum([
    "retailer_api",
    "permitted_partner",
    "moderated_report",
    "editorial",
  ]),
  observed_at: z.string(),
  ingested_at: z.string(),
  stale_after: z.string(),
  price_minor: z.number().nullable(),
  currency: z.string().nullable(),
  seller_type: z.enum(["retailer", "third_party", "mixed", "unknown"]),
  channel: z.enum(["ship_to_home", "pickup", "in_store_report", "unknown"]),
  region_code: z.string().nullable(),
});
export async function catalogSnapshot() {
  const now = new Date();
  if (!configured())
    return {
      products: demoCatalog,
      offers: demoOffers.map((l) => projectListing(l, now, true)),
      retailers: [
        {
          id: demoOffers[0].retailer_id,
          name: "Demo retailer",
          website: "https://example.com/demo",
          is_demo: true,
          coverage: "Synthetic fixtures only",
        },
      ],
      history: [] as StockEventDTO[],
    };
  const db = adminDb();
  async function rows(table: string) {
    const all: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from(table)
        .select("*")
        .order(table === "listing_current_state" ? "listing_id" : "id")
        .range(offset, offset + 999);
      dbError(error);
      all.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return all;
  }
  const [p, l, r, s, states, observations, events, flags] = await Promise.all(
    [
      "products",
      "listings",
      "retailers",
      "source_permissions",
      "listing_current_state",
      "stock_observations",
      "stock_events",
      "feature_flags",
    ].map((t) =>
      t === "feature_flags"
        ? db
            .from(t)
            .select("*")
            .then((v) => {
              dbError(v.error);
              return v.data ?? [];
            })
        : rows(t),
    ),
  );
  const products = p.map((raw) => {
    const row = z
      .object({
        reference_price_valid_from: z.string().nullable(),
        reference_price_valid_until: z.string().nullable(),
      })
      .passthrough()
      .parse(raw);
    const valid =
      row.reference_price_valid_from !== null &&
      row.reference_price_valid_until !== null &&
      Date.parse(row.reference_price_valid_from) <= now.getTime() &&
      Date.parse(row.reference_price_valid_until) > now.getTime();
    return productRecordSchema.parse(
      valid
        ? row
        : {
            ...row,
            reference_price_minor: null,
            reference_price_currency: null,
            reference_price_source: null,
          },
    );
  });
  const retailers = z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        website: z.string(),
        is_demo: z.boolean(),
      }),
    )
    .parse(r)
    .map((v) => ({
      ...v,
      coverage:
        "Coverage depends on permitted source, seller, channel and region.",
    }));
  const sources = z
    .array(
      z.object({
        id: z.string(),
        status: z.string(),
        enabled: z.boolean(),
        is_demo: z.boolean(),
      }),
    )
    .parse(s);
  const current = z
    .array(
      z.object({
        listing_id: z.string(),
        observation_id: z.string(),
        conflicted: z.boolean(),
        last_successful_check_at: z.string(),
      }),
    )
    .parse(states);
  const obs = z.array(observation).parse(observations);
  const verification = z
    .array(z.object({ name: z.string(), enabled: z.boolean() }))
    .parse(flags)
    .some((f) => f.name === "retailer_verification" && f.enabled);
  const offers: ListingDTO[] = l.map((raw) => {
    const row = z
      .object({
        id: z.string(),
        product_id: z.string(),
        retailer_id: z.string(),
        retailer_url: z.string(),
        seller_type: z.enum(["retailer", "third_party", "mixed", "unknown"]),
        channel: z.enum([
          "ship_to_home",
          "pickup",
          "in_store_report",
          "unknown",
        ]),
        region_code: z.string().nullable(),
        price_minor: z.number().nullable(),
        currency: z.string().nullable(),
        source_id: z.string(),
        is_demo: z.boolean(),
      })
      .parse(raw);
    const state = current.find((v) => v.listing_id === row.id);
    const evidence = obs.find((v) => v.id === state?.observation_id);
    const source = sources.find((v) => v.id === row.source_id);
    return projectListing(
      listingSchema.parse({
        ...row,
        retailer_name:
          retailers.find((v) => v.id === row.retailer_id)?.name ??
          "Unknown retailer",
        availability_status: evidence?.availability_status ?? "unknown",
        price_minor: evidence ? evidence.price_minor : row.price_minor,
        currency: evidence ? evidence.currency : row.currency,
        seller_type: evidence?.seller_type ?? row.seller_type,
        channel: evidence?.channel ?? row.channel,
        region_code: evidence ? evidence.region_code : row.region_code,
        evidence_type: evidence?.evidence_type ?? "editorial",
        freshness: "unavailable",
        observed_at: evidence?.observed_at ?? null,
        ingested_at: evidence?.ingested_at ?? null,
        last_successful_check_at: state?.last_successful_check_at ?? null,
        stale_after: evidence?.stale_after ?? null,
        source_url: row.retailer_url,
        evidence_summary: row.is_demo
          ? "DEMO DATA — synthetic source."
          : "Listed price is not guaranteed checkout price; see source, channel and region.",
      }),
      now,
      source?.enabled === true &&
        source.status === "approved" &&
        (source.is_demo || verification),
      state?.conflicted,
    );
  });
  const history: StockEventDTO[] = events.flatMap((raw) => {
    const e = z
      .object({
        id: z.string(),
        listing_id: z.string().nullable(),
        snapshot: z.record(z.string(), z.unknown()),
      })
      .parse(raw);
    if (!e.listing_id) return [];
    return [
      stockEventSchema.parse({
        ...e.snapshot,
        id: e.id,
        listing_id: e.listing_id,
      }),
    ];
  });
  return { products, offers, retailers, history };
}
