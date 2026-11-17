export interface Observation {
  amount_minor: number;
  observed_at: string;
  variant_id: string;
  currency: string;
  condition: string;
  grading_company: string;
  grade: string;
  statistic: string;
  provider_id: string;
}
export function priceSeries(rows: readonly Observation[], now = Date.now()) {
  const identity = (r: Observation) =>
    [
      r.variant_id,
      r.currency,
      r.condition,
      r.grading_company,
      r.grade,
      r.statistic,
      r.provider_id,
    ].join("|");
  if (new Set(rows.map(identity)).size > 1)
    throw new Error("INCOMPARABLE_PRICES");
  const ordered = [...rows].sort((a, b) =>
    a.observed_at.localeCompare(b.observed_at),
  );
  if (
    ordered.some(
      (r) =>
        !Number.isSafeInteger(r.amount_minor) ||
        r.amount_minor < 0 ||
        !Number.isFinite(Date.parse(r.observed_at)) ||
        Date.parse(r.observed_at) > now,
    )
  )
    throw new Error("INVALID_PRICE");
  const first = ordered[0],
    last = ordered.at(-1);
  const change =
    first && last && ordered.length > 1
      ? last.amount_minor - first.amount_minor
      : null;
  return {
    min: ordered.length
      ? Math.min(...ordered.map((r) => r.amount_minor))
      : null,
    max: ordered.length
      ? Math.max(...ordered.map((r) => r.amount_minor))
      : null,
    change,
    change_percent:
      change !== null && first.amount_minor > 0
        ? (100 * change) / first.amount_minor
        : null,
    last_observed_at: last?.observed_at ?? null,
    count: ordered.length,
    stale: !last || now - Date.parse(last.observed_at) > 7 * 86400000,
  };
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
