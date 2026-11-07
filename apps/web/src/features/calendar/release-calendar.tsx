"use client";
import { useId, useMemo, useState } from "react";
import { releaseDateLabel } from "../../../../../packages/domain/src/calendar/dates";
import { Skeleton, StateCard } from "../../../../../packages/ui/src/primitives";

/** B presentation projection. Nullable unknown date/demo provenance need contract review.
 * A's product catalog supplies the product-to-set map; this module does not infer it.
 */
export interface CalendarRelease {
  id: string;
  product_id: string | null;
  name: string;
  date: string | null;
  date_precision: "day" | "month" | "unconfirmed";
  event_type: "release" | "preorder" | "announcement";
  region: string | null;
  source_url: string;
  verified_at: string;
  is_demo: boolean;
}
export interface ReleaseCalendarProps {
  entries: readonly CalendarRelease[];
  productSetNames?: Readonly<Record<string, string>>;
  initialMonth: string;
  formatVerifiedAt: (value: string) => string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  filters?: { region: string; event_type: string; set_name: string };
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Parent loads all results for these filters, with cursor pagination as needed. */
  onFiltersChange?: (filters: {
    region: string;
    event_type: string;
    set_name: string;
  }) => void;
}
function safeSource(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function validMonth(value: string): boolean {
  return (
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 1000
  );
}

export function ReleaseCalendar({
  entries,
  productSetNames = {},
  initialMonth,
  formatVerifiedAt,
  loading = false,
  error,
  onRetry,
  onFiltersChange,
  filters,
  hasMore = false,
  onLoadMore,
}: ReleaseCalendarProps) {
  const id = useId();
  const [view, setView] = useState<"list" | "month">("list");
  const [month, setMonth] = useState(
    validMonth(initialMonth) ? initialMonth : "2000-01",
  );
  const [day, setDay] = useState<string | null>(null);
  const [region, setRegion] = useState("");
  const [type, setType] = useState("");
  const [setName, setSetName] = useState("");
  const activeRegion = filters?.region ?? region,
    activeType = filters?.event_type ?? type,
    activeSet = filters?.set_name ?? setName;
  const filtered = useMemo(
    () =>
      entries
        .filter(
          (entry) =>
            (!activeRegion || entry.region === activeRegion) &&
            (!activeType || entry.event_type === activeType) &&
            (!activeSet ||
              (entry.product_id !== null &&
                productSetNames[entry.product_id] === activeSet)),
        )
        .sort(
          (a, b) =>
            (a.date === null ? 1 : 0) - (b.date === null ? 1 : 0) ||
            (a.date ?? "").localeCompare(b.date ?? "") ||
            a.id.localeCompare(b.id),
        ),
    [entries, activeRegion, activeType, activeSet, productSetNames],
  );
  const unknown = filtered.filter((e) => e.date_precision === "unconfirmed");
  const monthOnly = filtered.filter(
    (e) => e.date_precision === "month" && e.date?.startsWith(month),
  );
  const known = filtered.filter((e) => e.date_precision !== "unconfirmed");
  const visibleDay = day?.startsWith(month) ? day : null;
  const days = filtered.filter(
    (e) => e.date_precision === "day" && e.date?.startsWith(month),
  );
  const year = Number(month.slice(0, 4)),
    monthIndex = Number(month.slice(5)) - 1;
  const offset = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const weeks = Array.from(
    { length: Math.ceil((offset + dayCount) / 7) },
    (_, row) =>
      Array.from({ length: 7 }, (_, column) => {
        const value = row * 7 + column - offset + 1;
        return value > 0 && value <= dayCount ? value : null;
      }),
  );
  function updateFilters(next: {
    region?: string;
    event_type?: string;
    set_name?: string;
  }) {
    const merged = {
      region: activeRegion,
      event_type: activeType,
      set_name: activeSet,
      ...next,
    };
    setRegion(merged.region);
    setType(merged.event_type);
    setSetName(merged.set_name);
    setDay(null);
    onFiltersChange?.(merged);
  }
  function shiftMonth(delta: number) {
    const date = new Date(Date.UTC(year, monthIndex + delta, 1));
    const value = date.toISOString().slice(0, 7);
    if (validMonth(value)) {
      setMonth(value);
      setDay(null);
    }
  }
  function cards(items: readonly CalendarRelease[]) {
    return items.map((entry) => {
      const source = safeSource(entry.source_url);
      const dateLabel =
        entry.date_precision === "unconfirmed"
          ? "Date unconfirmed"
          : releaseDateLabel(entry.date ?? "", entry.date_precision);
      return (
        <article className="pp-card" key={entry.id}>
          {entry.is_demo && (
            <p className="pp-status" data-tone="warning">
              △ DEMO DATA
            </p>
          )}
          <h3>{entry.name}</h3>
          <p>
            <strong>{dateLabel}</strong>
            {entry.date_precision === "month" ? " · exact day unconfirmed" : ""}
          </p>
          <p>
            {entry.event_type === "preorder"
              ? "Preorder announcement"
              : entry.event_type === "release"
                ? "Product release"
                : "Announcement"}{" "}
            · {entry.region ?? "Region unconfirmed"}
          </p>
          <p className="pp-muted">
            Editorial release information · not retailer stock.
          </p>
          {source ? (
            <p>
              <a href={source}>Source announcement for {entry.name}</a>
            </p>
          ) : (
            <p>Source link unavailable</p>
          )}
          <p>
            Last verified:{" "}
            <time dateTime={entry.verified_at}>
              {formatVerifiedAt(entry.verified_at)}
            </time>
          </p>
          {entry.product_id && (
            <a href={`/products/${encodeURIComponent(entry.product_id)}`}>
              View product details
            </a>
          )}
        </article>
      );
    });
  }
  return (
    <section className="pp-stack" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`}>Release calendar</h1>
      <p>
        Plan around sourced announcements. A release date does not mean a
        retailer has stock.
      </p>
      <div className="pp-grid">
        <div className="pp-field">
          <label htmlFor={`${id}-region`}>Region</label>
          <select
            id={`${id}-region`}
            className="pp-input"
            value={activeRegion}
            onChange={(e) => updateFilters({ region: e.target.value })}
          >
            <option value="">All regions</option>
            {[
              ...new Set([
                ...entries.flatMap((e) => (e.region ? [e.region] : [])),
                ...(activeRegion ? [activeRegion] : []),
              ]),
            ]
              .sort()
              .map((value) => (
                <option key={value}>{value}</option>
              ))}
          </select>
        </div>
        <div className="pp-field">
          <label htmlFor={`${id}-type`}>Event type</label>
          <select
            id={`${id}-type`}
            className="pp-input"
            value={activeType}
            onChange={(e) => updateFilters({ event_type: e.target.value })}
          >
            <option value="">All events</option>
            <option value="release">Releases</option>
            <option value="preorder">Preorders</option>
            <option value="announcement">Announcements</option>
          </select>
        </div>
        <div className="pp-field">
          <label htmlFor={`${id}-set`}>Set</label>
          <select
            id={`${id}-set`}
            className="pp-input"
            value={activeSet}
            onChange={(e) => updateFilters({ set_name: e.target.value })}
          >
            <option value="">All sets</option>
            {[
              ...new Set([
                ...Object.values(productSetNames),
                ...(activeSet ? [activeSet] : []),
              ]),
            ]
              .sort()
              .map((value) => (
                <option key={value}>{value}</option>
              ))}
          </select>
        </div>
      </div>
      <div className="pp-row" role="group" aria-label="Calendar view">
        <button
          className="pp-button"
          type="button"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
        >
          List view
        </button>
        <button
          className="pp-button"
          type="button"
          aria-pressed={view === "month"}
          onClick={() => setView("month")}
        >
          Month view
        </button>
      </div>
      {loading ? (
        <Skeleton label="Loading release calendar" />
      ) : error ? (
        <StateCard title="Calendar unavailable" error retry={onRetry}>
          {error}
        </StateCard>
      ) : (
        <>
          <p role="status">
            {filtered.length} loaded sourced entries; {unknown.length} with
            unconfirmed dates.
          </p>
          {!filtered.length ? (
            <StateCard title="No sourced releases">
              Try other filters or check again after an editorial update.
            </StateCard>
          ) : view === "list" ? (
            <div className="pp-grid">{cards(known)}</div>
          ) : (
            <>
              <div className="pp-row">
                <button
                  className="pp-button"
                  data-variant="secondary"
                  type="button"
                  onClick={() => shiftMonth(-1)}
                >
                  Previous month
                </button>
                <label className="pp-field">
                  Month
                  <input
                    className="pp-input"
                    type="month"
                    value={month}
                    onChange={(e) => {
                      if (validMonth(e.target.value)) {
                        setMonth(e.target.value);
                        setDay(null);
                      }
                    }}
                  />
                </label>
                <button
                  className="pp-button"
                  data-variant="secondary"
                  type="button"
                  onClick={() => shiftMonth(1)}
                >
                  Next month
                </button>
              </div>
              <table className="pp-calendar-table">
                <caption>
                  {releaseDateLabel(`${month}-01`, "month")} · select a day to
                  read its announcements
                </caption>
                <thead>
                  <tr>
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                      (value) => (
                        <th key={value} scope="col">
                          {value}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, index) => (
                    <tr key={index}>
                      {week.map((value, column) => {
                        if (value === null) return <td key={column} />;
                        const date = `${month}-${String(value).padStart(2, "0")}`;
                        const count = days.filter(
                          (e) => e.date === date,
                        ).length;
                        return (
                          <td key={column}>
                            <button
                              type="button"
                              aria-pressed={visibleDay === date}
                              aria-label={`${releaseDateLabel(date, "day")}, ${count} announcements`}
                              onClick={() => setDay(date)}
                            >
                              <span>{value}</span>
                              <small aria-hidden="true">
                                {count ? `· ${count}` : "\u00a0"}
                              </small>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleDay && (
                <section aria-label="Selected day announcements">
                  <h2>{releaseDateLabel(visibleDay, "day")}</h2>
                  <div className="pp-grid">
                    {days.some((e) => e.date === visibleDay) ? (
                      cards(days.filter((e) => e.date === visibleDay))
                    ) : (
                      <p>No sourced announcements for this day.</p>
                    )}
                  </div>
                </section>
              )}
              {monthOnly.length > 0 && (
                <section>
                  <h2>Month announced; exact day unconfirmed</h2>
                  <div className="pp-grid">{cards(monthOnly)}</div>
                </section>
              )}
            </>
          )}
          {unknown.length > 0 && (
            <section>
              <h2>Date unconfirmed</h2>
              <div className="pp-grid">{cards(unknown)}</div>
            </section>
          )}
          {hasMore && onLoadMore && (
            <button className="pp-button" type="button" onClick={onLoadMore}>
              Load more sourced entries
            </button>
          )}
        </>
      )}
    </section>
  );
}
