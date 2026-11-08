import type { Manifest, Variant } from "../../domain/src/collections/policies";
import type { PackConfig } from "../../domain/src/packs/policies";
import type { PrivateReport } from "../../domain/src/radar/policies";
export const ids = {
  set: "10000000-0000-4000-8000-000000000001",
  moss: "20000000-0000-4000-8000-000000000001",
  mossFoil: "20000000-0000-4000-8000-000000000002",
  lantern: "20000000-0000-4000-8000-000000000003",
  cloud: "20000000-0000-4000-8000-000000000004",
  promo: "20000000-0000-4000-8000-000000000005",
  store: "30000000-0000-4000-8000-000000000001",
  userA: "40000000-0000-4000-8000-000000000001",
  userB: "40000000-0000-4000-8000-000000000002",
};
export const fixtureDisclosure =
  "DEMO DATA — Lumen Grove is an original fictional set. No physical cards or prizes.";
export const variants: Variant[] = [
  {
    id: ids.moss,
    set_id: ids.set,
    card_number: "001",
    card_name: "Moss Courier",
    finish: "standard",
    eligible_for_packs: true,
  },
  {
    id: ids.mossFoil,
    set_id: ids.set,
    card_number: "001",
    card_name: "Moss Courier",
    finish: "foil",
    eligible_for_packs: true,
  },
  {
    id: ids.lantern,
    set_id: ids.set,
    card_number: "002",
    card_name: "Harbor Lantern",
    finish: "standard",
    eligible_for_packs: true,
  },
  {
    id: ids.cloud,
    set_id: ids.set,
    card_number: "003",
    card_name: "Cloud Archivist",
    finish: "foil",
    eligible_for_packs: true,
  },
  {
    id: ids.promo,
    set_id: ids.set,
    card_number: "P01",
    card_name: "Moss Courier — Festival",
    finish: "etched",
    eligible_for_packs: false,
  },
];
export const manifest: Manifest = {
  set_id: ids.set,
  version: "fictional-1",
  validated: true,
  supported_goals: ["base", "master", "extended"],
  requirements: [
    ...variants
      .filter((v) => v.card_number !== "P01")
      .map((v) => ({
        variant_id: v.id,
        collectible_key: `${ids.set}:${v.card_number}`,
        scope: "base" as const,
        rationale: "Any published in-set variant satisfies this numbered card.",
      })),
    ...variants
      .filter((v) => v.card_number !== "P01")
      .map((v) => ({
        variant_id: v.id,
        collectible_key: v.id,
        scope: "master" as const,
        rationale: "Explicit fictional in-set variant.",
      })),
    ...variants.map((v) => ({
      variant_id: v.id,
      collectible_key: v.id,
      scope: "extended" as const,
      rationale:
        "Published extended goal includes all in-set variants and separately declared festival promo.",
    })),
  ],
};
export const config: PackConfig = {
  set_id: ids.set,
  odds_version: "fictional-1",
  rights_status: "approved",
  enabled: true,
  fictional: true,
  price_coins: 10,
  slots: [
    {
      slot_index: 0,
      pool: [
        { variant_id: ids.moss, weight: 1 },
        { variant_id: ids.lantern, weight: 1 },
      ],
    },
    {
      slot_index: 1,
      pool: [
        { variant_id: ids.moss, weight: 70 },
        { variant_id: ids.mossFoil, weight: 25 },
        { variant_id: ids.cloud, weight: 5 },
      ],
    },
  ],
};
// This approved fixture config is ONLY a policy-test input, never a public feature flag.
export const fixtureNow = Date.parse("2026-11-06T18:00:00Z");
const report: PrivateReport = {
  id: "50000000-0000-4000-8000-000000000001",
  store_id: ids.store,
  product_id: null,
  reporter_id: ids.userA,
  report_type: "found_stock",
  submitted_at: "2026-11-06T17:00:00Z",
  observed_at: "2026-11-06T16:55:00Z",
  expires_at: "2026-11-06T20:55:00Z",
  moderation: "pending",
  public_notes: null,
  is_demo: true,
};
export const reportFixtures = {
  community_found_pending: report,
  community_found_approved: { ...report, moderation: "approved" as const },
  community_shelf_empty_conflict: {
    ...report,
    id: "50000000-0000-4000-8000-000000000002",
    reporter_id: ids.userB,
    report_type: "shelf_empty" as const,
    moderation: "approved" as const,
  },
  community_report_expired: {
    ...report,
    id: "50000000-0000-4000-8000-000000000003",
    moderation: "approved" as const,
    expires_at: "2026-11-06T17:59:59Z",
  },
  repeat_report_same_account: {
    ...report,
    id: "50000000-0000-4000-8000-000000000004",
  },
};
