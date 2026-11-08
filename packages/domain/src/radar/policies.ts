export type ReportType = "found_stock" | "shelf_empty";
export interface PrivateReport {
  id: string;
  store_id: string;
  product_id: string | null;
  reporter_id: string;
  report_type: ReportType;
  submitted_at: string;
  observed_at: string;
  expires_at: string;
  moderation: "pending" | "approved" | "rejected" | "expired";
  /** Free text is never public until independently reviewed. */
  public_notes: string | null;
  is_demo: boolean;
}
export interface Confirmation {
  sighting_id: string;
  user_id: string;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function uuidValue(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
export function nearbyQuery(zip: string, radius: number) {
  if (!/^\d{5}$/.test(zip)) throw new Error("INVALID_ZIP");
  if (!Number.isInteger(radius) || radius < 1 || radius > 100)
    throw new Error("INVALID_RADIUS");
  return { zip, radius_mi: radius };
}
export function observationTime(
  value: string,
  now: number,
  maxAgeMs = 24 * 60 * 60 * 1000,
): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    throw new Error("INVALID_TIME");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > now || parsed < now - maxAgeMs)
    throw new Error("INVALID_TIME");
  // Date.parse normalizes impossible days; reject normalized calendar components.
  if (new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19))
    throw new Error("INVALID_TIME");
  return new Date(parsed).toISOString();
}
export function validateReportNotes(value: string): string {
  if (
    typeof value !== "string" ||
    value.length > 280 ||
    /[<>\u0000-\u001f]/u.test(value)
  )
    throw new Error("INVALID_NOTES");
  // Conservative prefilter only. Does not replace staff privacy review.
  if (
    /https?:\/\/|www\.|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?\d[\d ().-]{7,}\d)/i.test(
      value,
    )
  ) {
    throw new Error("PRIVATE_INFORMATION");
  }
  return value.trim();
}

/** Must run in the submission DB transaction under a per-account lock. */
export function checkReportRate(
  prior: readonly PrivateReport[],
  userId: string,
  storeId: string,
  productId: string | null,
  now: number,
  cooldownMs = 5 * 60 * 1000,
  dailyCap = 10,
): void {
  const mine = prior.filter((r) => r.reporter_id === userId);
  const utcDay = new Date(now).toISOString().slice(0, 10);
  if (
    mine.filter((r) => r.submitted_at.slice(0, 10) === utcDay).length >=
    dailyCap
  )
    throw new Error("RATE_LIMITED");
  if (mine.some((r) => now - Date.parse(r.submitted_at) < cooldownMs))
    throw new Error("RATE_LIMITED");
  if (
    mine.some(
      (r) =>
        r.store_id === storeId &&
        r.product_id === productId &&
        r.moderation !== "rejected" &&
        Date.parse(r.expires_at) > now,
    )
  )
    throw new Error("DUPLICATE_REPORT");
}

function visible(report: PrivateReport, now: number) {
  return (
    report.moderation === "approved" &&
    Date.parse(report.expires_at) > now &&
    Date.parse(report.observed_at) <= now
  );
}
/** Allowlist DTO projection: private report fields cannot escape by object spread. */
export function publicReports(
  reports: readonly PrivateReport[],
  confirmations: readonly Confirmation[],
  now: number,
) {
  const active = reports.filter((r) => visible(r, now));
  return active
    .map((report) => ({
      id: report.id,
      store_id: report.store_id,
      product_id: report.product_id,
      report_type: report.report_type,
      submitted_at: report.submitted_at,
      observed_at: report.observed_at,
      expires_at: report.expires_at,
      moderation: "approved" as const,
      independent_confirmations: new Set(
        confirmations
          .filter(
            (c) =>
              c.sighting_id === report.id && c.user_id !== report.reporter_id,
          )
          .map((c) => c.user_id),
      ).size,
      // Different users and exactly the same product scope. Unknown product does not imply all products.
      conflict_count: new Set(
        active
          .filter(
            (other) =>
              other.store_id === report.store_id &&
              other.product_id === report.product_id &&
              other.report_type !== report.report_type &&
              other.reporter_id !== report.reporter_id,
          )
          .map((other) => other.reporter_id),
      ).size,
      is_demo: report.is_demo,
      public_notes: report.public_notes,
    }))
    .sort(
      (a, b) =>
        b.observed_at.localeCompare(a.observed_at) || a.id.localeCompare(b.id),
    );
}

/** Internal event proposal; producer outbox and A consumer must recheck expiry/reversal. */
export function approvalEnvelope(
  report: PrivateReport,
  now: number,
  moderationRevision: number,
) {
  if (!visible(report, now)) throw new Error("REPORT_NOT_CURRENT");
  if (!Number.isSafeInteger(moderationRevision) || moderationRevision < 1)
    throw new Error("INVALID_REVISION");
  return {
    version: 1,
    type: "sighting_approved",
    event_id: `${report.id}:approval:${moderationRevision}`,
    sighting_id: report.id,
    store_id: report.store_id,
    product_id: report.product_id,
    report_type: report.report_type,
    evidence_type: "moderated_report",
    observed_at: report.observed_at,
    expires_at: report.expires_at,
    is_demo: report.is_demo,
  } as const;
}
