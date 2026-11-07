import { createHash } from "node:crypto";
import type {
  ProductRecord,
  ListingDTO,
  CatalogQuery,
} from "@pokepulse/contracts";
export function normalizeGtin(value: string): string {
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) throw new Error("VALIDATION_ERROR");
  const digits = [...value].map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((n, v, i) => n + v * (i % 2 === 0 ? 3 : 1), 0);
  if ((10 - (sum % 10)) % 10 !== check) throw new Error("VALIDATION_ERROR");
  return value.padStart(14, "0");
}
export function canonicalIdentity(p: ProductRecord): string {
  const fields = [
    p.set_name,
    p.product_type,
    p.language,
    p.release_region,
    p.edition,
    p.pack_count,
    p.gtin ? normalizeGtin(p.gtin) : null,
  ];
  return createHash("sha256")
    .update(
      JSON.stringify(
        fields.map((v) =>
          typeof v === "string" ? v.trim().normalize("NFKC").toLowerCase() : v,
        ),
      ),
    )
    .digest("hex");
}
export function mappingDecision(
  candidate: ProductRecord,
  known: ProductRecord[],
): { kind: "match"; product_id: string } | { kind: "review"; reason: string } {
  if (
    candidate.pack_count === null ||
    candidate.language === null ||
    candidate.release_region === null
  )
    return { kind: "review", reason: "incomplete_identity" };
  const matches = known.filter(
    (p) => canonicalIdentity(p) === canonicalIdentity(candidate),
  );
  return matches.length === 1
    ? { kind: "match", product_id: matches[0].id }
    : {
        kind: "review",
        reason: matches.length ? "ambiguous_identity" : "unmatched_identity",
      };
}
export function safeSourceUrl(value: string, hosts: readonly string[]): URL {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !hosts.includes(u.hostname.toLowerCase()) ||
    u.hostname === "localhost" ||
    /^(\d+\.){3}\d+$/.test(u.hostname) ||
    u.hostname.includes(":")
  )
    throw new Error("UNSAFE_URL");
  return u;
}
export function listingMatches(l: ListingDTO, q: CatalogQuery): boolean {
  return (
    (!q.retailer_id || q.retailer_id === l.retailer_id) &&
    (!q.seller_type || q.seller_type === l.seller_type) &&
    (!q.channel || q.channel === l.channel) &&
    (!q.currency || q.currency === l.currency) &&
    (q.max_price_minor === undefined ||
      (l.price_minor !== null && l.price_minor <= q.max_price_minor)) &&
    (!q.availability_status ||
      q.availability_status === l.availability_status) &&
    (!q.evidence_type || q.evidence_type === l.evidence_type) &&
    (!q.freshness || q.freshness === l.freshness)
  );
}
export function catalogFilter(
  products: ProductRecord[],
  listings: ListingDTO[],
  q: CatalogQuery,
): ProductRecord[] {
  const offerFilter = [
    "retailer_id",
    "seller_type",
    "channel",
    "currency",
    "max_price_minor",
    "availability_status",
    "evidence_type",
    "freshness",
  ].some((k) => q[k as keyof CatalogQuery] !== undefined);
  return products.filter(
    (p) =>
      (!q.q ||
        p.name.toLowerCase().includes(q.q.toLowerCase()) ||
        p.set_name?.toLowerCase().includes(q.q.toLowerCase())) &&
      (!q.set_name || p.set_name === q.set_name) &&
      (!q.product_type || p.product_type === q.product_type) &&
      (!offerFilter ||
        listings.some((l) => l.product_id === p.id && listingMatches(l, q))),
  );
}
export function projectListing(
  l: ListingDTO,
  now: Date,
  permission: boolean,
  conflict = false,
): ListingDTO {
  if (!permission || conflict)
    return {
      ...l,
      availability_status: "unknown",
      freshness: "unavailable",
      evidence_summary: conflict
        ? "Conflicting observations; availability unknown."
        : "Source unavailable; last observation is historical.",
    };
  if (!l.observed_at || !l.stale_after)
    return { ...l, availability_status: "unknown", freshness: "unavailable" };
  const age = now.getTime() - Date.parse(l.observed_at),
    ttl = Date.parse(l.stale_after) - Date.parse(l.observed_at);
  return {
    ...l,
    ...(age >= ttl
      ? { availability_status: "unknown" as const, freshness: "stale" as const }
      : age >= ttl * 0.75
        ? { freshness: "aging" as const }
        : { freshness: "fresh" as const }),
  };
}
export function stockLabel(l: ListingDTO): string {
  if (l.is_demo)
    return `DEMO DATA — ${l.freshness === "stale" ? "last seen; stale" : l.availability_status.replaceAll("_", " ")}`;
  if (l.freshness === "stale" || l.freshness === "unavailable")
    return "Availability unknown — historical evidence";
  if (l.evidence_type === "moderated_report") return "Community reported";
  return `${l.availability_status.replaceAll("_", " ")} — ${l.evidence_type === "editorial" ? "editorial" : "source reported"}`;
}
