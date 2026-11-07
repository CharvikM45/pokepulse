export type AvailabilityStatus =
  "in_stock" | "out_of_stock" | "preorder" | "unknown";
export type EvidenceType =
  "retailer_api" | "permitted_partner" | "moderated_report" | "editorial";
export type FreshnessStatus = "fresh" | "aging" | "stale" | "unavailable";
export type SellerType = "retailer" | "third_party" | "mixed" | "unknown";
export type FulfillmentChannel =
  "ship_to_home" | "pickup" | "in_store_report" | "unknown";
export type ReportModeration = "pending" | "approved" | "rejected" | "expired";
export type AlertChannel = "in_app" | "web_push"; // email later, not in initial contract
export type FeatureFlag =
  | "retailer_verification"
  | "local_radar"
  | "web_push"
  | "calendar"
  | "pack_lab"
  | "licensed_card_art";

export interface ProductDTO {
  id: string;
  slug: string;
  name: string;
  set_name: string | null;
  era: string | null;
  product_type: string;
  language: string | null;
  release_region: string | null;
  edition: string | null;
  pack_count: number | null;
  gtin: string | null;
  release_date: string | null;
  reference_price_minor: number | null;
  reference_price_currency: string | null;
  reference_price_source: string | null;
  image_url: string | null;
}

export interface ListingDTO {
  id: string;
  product_id: string;
  retailer_id: string;
  retailer_name: string;
  retailer_url: string;
  seller_type: SellerType;
  channel: FulfillmentChannel;
  region_code: string | null;
  price_minor: number | null;
  currency: string | null;
  availability_status: AvailabilityStatus;
  evidence_type: EvidenceType;
  freshness: FreshnessStatus;
  observed_at: string | null;
  ingested_at: string | null;
  last_successful_check_at: string | null;
  stale_after: string | null;
  source_id: string | null;
  source_url: string | null;
  is_demo: boolean;
  evidence_summary: string;
}

export interface StockEventDTO {
  id: string;
  listing_id: string;
  previous_status: AvailabilityStatus;
  current_status: AvailabilityStatus;
  observed_at: string;
  ingested_at: string;
  evidence_type: EvidenceType;
  source_id: string;
  price_minor: number | null;
  currency: string | null;
}

export interface SightingDTO {
  id: string;
  store_id: string;
  product_id: string | null;
  report_type: "found_stock" | "shelf_empty";
  submitted_at: string;
  observed_at: string;
  expires_at: string;
  moderation: ReportModeration;
  independent_confirmations: number;
  conflict_count: number;
  is_demo: boolean;
  public_notes: string | null;
  // no public reporter ID, precise reporter location, or phone number
}

export interface AlertRuleDTO {
  /** Additive A-08 filters; joint review recorded in CONTRACT-01. */
  listing_ids?: string[];
  region_codes?: string[];
  source_ids?: string[];
  id: string;
  enabled: boolean;
  product_ids: string[];
  set_names: string[];
  retailer_ids: string[];
  product_types: string[];
  seller_types: SellerType[];
  channels: FulfillmentChannel[];
  evidence_types: EvidenceType[];
  max_price_minor: number | null;
  currency: string | null;
  store_ids: string[];
  zip: string | null;
  radius_mi: number | null;
  triggers: (
    | "restock"
    | "new_listing"
    | "local_sighting"
    | "price_drop"
    | "release_reminder"
  )[];
  delivery_channels: AlertChannel[];
  quiet_hours: { start: string; end: string; time_zone: string } | null;
  daily_cap: number;
  cooldown_minutes: number;
}

export interface NotificationDTO {
  id: string;
  rule_id: string | null;
  event_id: string | null;
  channel: AlertChannel;
  created_at: string;
  read_at: string | null;
  title: string;
  body: string;
  action_url: string | null;
  evidence_type: EvidenceType | null;
  observed_at: string | null;
}

export interface ReleaseDTO {
  id: string;
  product_id: string | null;
  name: string;
  date: string;
  event_type: "release" | "preorder" | "announcement";
  date_precision: "day" | "month" | "unconfirmed";
  region: string | null;
  source_url: string;
  verified_at: string;
}

export interface SetDTO {
  id: string;
  name: string;
  release_date: string | null;
  rights_status: "approved" | "metadata_only" | "disabled";
  manifest_version: string;
  odds_version: string | null;
  enabled_for_simulation: boolean;
}

export interface CardVariantDTO {
  id: string;
  set_id: string;
  card_number: string;
  card_name: string;
  rarity: string | null;
  finish: string;
  image_url: string | null;
  image_rights_cleared: boolean;
  eligible_for_packs: boolean;
}

export interface PackOpeningDTO {
  id: string;
  set_id: string;
  opened_at: string;
  spent_coins: number;
  used_free_open: boolean;
  odds_version: string;
  cards: { card_variant_id: string; slot_index: number }[];
  opening_status: "committed";
}

export interface CollectionProgressDTO {
  set_id: string;
  mode: "virtual" | "real";
  base_collected: number;
  base_required: number;
  master_collected: number;
  master_required: number;
  extended_collected: number | null;
  extended_required: number | null;
  manifest_version: string;
}
