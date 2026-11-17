"use client";
import { useId } from "react";
export function currencyValue(
  amount: number | null | undefined,
  currency: string,
) {
  if (amount == null) return "Unavailable";
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  });
  return formatter.format(
    amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2),
  );
}
export function PriceChart({
  points,
  currency,
  label,
}: {
  points: { time: string; value: number | null }[];
  currency: string;
  label: string;
}) {
  const title = useId();
  const valid = points.filter(
    (p): p is { time: string; value: number } =>
      p.value !== null && Number.isFinite(Date.parse(p.time)),
  );
  if (!valid.length)
    return (
      <div className="pp-chart-empty">
        <h3>No measured history yet</h3>
        <p>
          New observations will appear here. Historical values are never
          invented or backfilled.
        </p>
      </div>
    );
  const min = Math.min(...valid.map((p) => p.value)),
    max = Math.max(...valid.map((p) => p.value)),
    first = Math.min(...valid.map((p) => Date.parse(p.time))),
    last = Math.max(...valid.map((p) => Date.parse(p.time)));
  const x = (t: string) =>
      25 + ((Date.parse(t) - first) / Math.max(1, last - first)) * 650,
    y = (v: number) => 160 - ((v - min) / Math.max(1, max - min)) * 125;
  return (
    <figure className="pp-price-chart">
      <svg viewBox="0 0 700 200" role="img" aria-labelledby={title}>
        <title id={title}>
          {label}: {valid.length} measured observations. Range{" "}
          {currencyValue(min, currency)} to {currencyValue(max, currency)}.
        </title>
        <line
          x1="25"
          y1="175"
          x2="675"
          y2="175"
          stroke="currentColor"
          opacity=".25"
        />
        {valid.length > 1 && (
          <polyline
            points={valid.map((p) => `${x(p.time)},${y(p.value)}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
        )}
        {valid.map((p, i) => (
          <circle
            key={p.time + i}
            cx={x(p.time)}
            cy={y(p.value)}
            r="4"
            fill="currentColor"
          />
        ))}
      </svg>
      <figcaption>
        {new Date(first).toLocaleDateString()} —{" "}
        {new Date(last).toLocaleDateString()} · Lines connect observed points;
        gaps are unknown.
      </figcaption>
      <details>
        <summary>Read chart observations</summary>
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Observed</th>
              <th scope="col">Reference value</th>
            </tr>
          </thead>
          <tbody>
            {valid.map((p, i) => (
              <tr key={p.time + i}>
                <td>{new Date(p.time).toLocaleString()}</td>
                <td>{currencyValue(p.value, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
