import type {
  AlertRuleDTO,
  EvidenceType,
  FulfillmentChannel,
  SellerType,
} from "@pokepulse/contracts";
export interface MatchEvent {
  id: string;
  event_type: string;
  product_id: string | null;
  listing_id?: string;
  source_id?: string;
  set_name: string | null;
  product_type: string | null;
  retailer_id: string | null;
  seller_type: SellerType;
  channel: FulfillmentChannel;
  evidence_type: EvidenceType;
  price_minor: number | null;
  currency: string | null;
  region_code: string | null;
  store_id?: string;
  store_zip?: string | null;
  distance_mi?: number | null;
  distance_from_zip?: string;
  stale_after: string;
  source_url: string | null;
  is_demo: boolean;
}
export function matchRule(
  rule: AlertRuleDTO,
  event: MatchEvent,
  now: Date,
): { matches: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const reject = () => ({ matches: false, reasons });
  if (
    !rule.enabled ||
    Date.parse(event.stale_after) <= now.getTime() ||
    !rule.triggers.includes(
      event.event_type as AlertRuleDTO["triggers"][number],
    )
  )
    return reject();
  const filters: [readonly string[], string | null | undefined, string][] = [
    [rule.listing_ids ?? [], event.listing_id, "listing"],
    [rule.region_codes ?? [], event.region_code, "region"],
    [rule.source_ids ?? [], event.source_id, "source"],
    [rule.product_ids, event.product_id, "product"],
    [rule.set_names, event.set_name, "set"],
    [rule.product_types, event.product_type, "type"],
    [rule.retailer_ids, event.retailer_id, "retailer"],
    [rule.seller_types, event.seller_type, "seller"],
    [rule.channels, event.channel, "channel"],
    [rule.evidence_types, event.evidence_type, "evidence"],
    [rule.store_ids, event.store_id, "store"],
  ];
  for (const [allowed, value, label] of filters) {
    if (allowed.length && (!value || !allowed.includes(value))) return reject();
    if (allowed.length) reasons.push(label);
  }
  if (
    rule.max_price_minor !== null &&
    (event.price_minor === null ||
      event.currency !== rule.currency ||
      event.price_minor > rule.max_price_minor)
  )
    return reject();
  if (rule.zip !== null) {
    const distance =
      event.store_zip === rule.zip
        ? 0
        : event.distance_from_zip === rule.zip
          ? event.distance_mi
          : null;
    if (
      distance === null ||
      distance === undefined ||
      rule.radius_mi === null ||
      distance > rule.radius_mi
    )
      return reject();
    reasons.push("local radius");
  }
  if (rule.max_price_minor !== null) reasons.push("price");
  reasons.push("trigger");
  return { matches: true, reasons };
}
export function inQuietHours(
  quiet: AlertRuleDTO["quiet_hours"],
  now: Date,
): boolean {
  if (!quiet) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: quiet.time_zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return (
    quiet.start === quiet.end ||
    (quiet.start < quiet.end
      ? parts >= quiet.start && parts < quiet.end
      : parts >= quiet.start || parts < quiet.end)
  );
}
