"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { nearbyQuery } from "../../../../../packages/domain/src/radar/policies";
import {
  Skeleton,
  StateCard,
  StatusBadge,
  useNow,
} from "../../../../../packages/ui/src/primitives";

/** Presentation types for B's proposed APIs. No reporter identity/location fields. */
export interface RadarStore {
  id: string;
  name: string;
  address: string | null;
  region: string | null;
  distance_mi: number | null;
  latitude: number | null;
  longitude: number | null;
  directory_source: string;
  is_demo: boolean;
}
export interface RadarSighting {
  id: string;
  store_id: string;
  product_id: string | null;
  report_type: "found_stock" | "shelf_empty";
  observed_at: string;
  expires_at: string;
  moderation: "pending" | "approved" | "rejected" | "expired";
  independent_confirmations: number;
  conflict_count: number;
  public_notes: string | null;
  is_demo: boolean;
}
export interface RadarService {
  stores: (
    query: { zip: string; radius_mi: number; cursor: string | null },
    signal: AbortSignal,
  ) => Promise<{ stores: readonly RadarStore[]; next_cursor: string | null }>;
  sightings: (
    storeId: string,
    signal: AbortSignal,
  ) => Promise<readonly RadarSighting[]>;
}
type LoadState = "idle" | "loading" | "ready" | "error";
function directions(store: RadarStore): string | null {
  if (store.is_demo) return null;
  if (
    store.latitude !== null &&
    store.longitude !== null &&
    Number.isFinite(store.latitude) &&
    Number.isFinite(store.longitude) &&
    Math.abs(store.latitude) <= 90 &&
    Math.abs(store.longitude) <= 180
  )
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${store.latitude},${store.longitude}`)}`;
  return store.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(store.address)}`
    : null;
}

export function LocalRadar({
  service,
  authenticated,
  onSignIn,
  onReportStore,
  formatTimestamp,
  mapContent: providedMap,
  renderMap,
  onConfirmReport,
}: {
  service: RadarService;
  authenticated: boolean;
  onSignIn: () => void;
  onReportStore: (store: RadarStore) => void;
  formatTimestamp: (iso: string) => string;
  mapContent?: ReactNode;
  renderMap?: (stores: readonly RadarStore[]) => ReactNode;
  onConfirmReport?: (id: string) => Promise<void>;
}) {
  const now = useNow();
  const id = useId();
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState("25");
  const [query, setQuery] = useState<{ zip: string; radius_mi: number } | null>(
    null,
  );
  const [stores, setStores] = useState<readonly RadarStore[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [storeState, setStoreState] = useState<LoadState>("idle");
  const [validation, setValidation] = useState("");
  const [selected, setSelected] = useState<RadarStore | null>(null);
  const [reports, setReports] = useState<readonly RadarSighting[]>([]);
  const [reportState, setReportState] = useState<LoadState>("idle");
  const [reportRefresh, setReportRefresh] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const storeRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const validationRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      requestGeneration.current++;
      storeRequest.current?.abort();
    },
    [],
  );
  async function find(
    next: { zip: string; radius_mi: number },
    nextCursor: string | null = null,
  ) {
    storeRequest.current?.abort();
    const controller = new AbortController();
    storeRequest.current = controller;
    const generation = ++requestGeneration.current;
    setStoreState("loading");
    if (nextCursor === null) {
      setStores([]);
      setCursor(null);
      setSelected(null);
      setReports([]);
      setReportState("idle");
    }
    try {
      const result = await service.stores(
        { ...next, cursor: nextCursor },
        controller.signal,
      );
      if (controller.signal.aborted || generation !== requestGeneration.current)
        return;
      setStores((current) =>
        nextCursor === null
          ? result.stores
          : [
              ...current,
              ...result.stores.filter(
                (item) => !current.some((old) => old.id === item.id),
              ),
            ],
      );
      setCursor(result.next_cursor);
      setStoreState("ready");
    } catch {
      if (
        !controller.signal.aborted &&
        generation === requestGeneration.current
      )
        setStoreState("error");
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    try {
      const next = nearbyQuery(zip.trim(), Number(radius));
      setQuery(next);
      void find(next);
    } catch {
      setValidation(
        "Enter a 5-digit ZIP and a whole radius from 1 to 100 miles.",
      );
      requestAnimationFrame(() => validationRef.current?.focus());
    }
  }
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = setTimeout(() => {
      setReportState("loading");
      setReports([]);
      void (async () => {
        try {
          const result = await service.sightings(
            selected.id,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const now = Date.now();
          const active = result.filter(
            (r) =>
              r.store_id === selected.id &&
              r.moderation === "approved" &&
              Number.isFinite(Date.parse(r.expires_at)) &&
              Date.parse(r.expires_at) > now &&
              Date.parse(r.observed_at) <= now,
          );
          setReports(active);
          setReportState("ready");
          const nextExpiry = Math.min(
            ...active.map((r) => Date.parse(r.expires_at)),
          );
          timer = setTimeout(
            () => {
              setReports([]);
              setReportState("loading");
              setReportRefresh((value) => value + 1);
            },
            Math.max(1, Math.min(30000, nextExpiry - Date.now() + 1)),
          );
        } catch {
          if (!controller.signal.aborted) {
            setReports([]);
            setReportState("error");
          }
        }
      })();
    }, 0);
    const recheck = () => {
      if (document.visibilityState === "visible") {
        setReports([]);
        setReportState("loading");
        setReportRefresh((value) => value + 1);
      }
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      clearTimeout(start);
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [selected, reportRefresh, service]);
  const visibleReports = reports.filter(
    (r) => now > 0 && Date.parse(r.expires_at) > now,
  );
  const mapContent = providedMap ?? renderMap?.(stores);
  const [confirming, setConfirming] = useState<string | null>(null),
    [confirmError, setConfirmError] = useState("");
  return (
    <section className="pp-stack" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`}>Local Radar</h1>
      <p>Choose a ZIP area. We do not request GPS or track your movement.</p>
      <form className="pp-row" onSubmit={submit} noValidate>
        <div className="pp-field">
          <label htmlFor={`${id}-zip`}>ZIP code</label>
          <input
            ref={validationRef}
            className="pp-input"
            id={`${id}-zip`}
            inputMode="numeric"
            maxLength={5}
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            aria-invalid={Boolean(validation)}
            aria-describedby={validation ? `${id}-error` : undefined}
          />
        </div>
        <div className="pp-field">
          <label htmlFor={`${id}-radius`}>Radius in miles</label>
          <select
            className="pp-input"
            id={`${id}-radius`}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
          >
            {[10, 25, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value} miles
              </option>
            ))}
          </select>
        </div>
        <button className="pp-button" type="submit">
          Find stores
        </button>
      </form>
      {validation && (
        <p id={`${id}-error`} className="pp-error" role="alert">
          {validation}
        </p>
      )}
      {mapContent ? (
        <>
          <button
            className="pp-button"
            data-variant="secondary"
            type="button"
            aria-pressed={showMap}
            onClick={() => setShowMap((value) => !value)}
          >
            Show map
          </button>
          {showMap && mapContent}
        </>
      ) : (
        <p className="pp-banner">
          Map provider unavailable. The store list remains available.
        </p>
      )}
      {query && (
        <p>
          Within {query.radius_mi} miles of ZIP {query.zip}. Distances use the
          ZIP centroid, not your precise location.
        </p>
      )}
      {storeState === "loading" && <Skeleton label="Loading nearby stores" />}
      {storeState === "error" && (
        <StateCard
          title="Store directory unavailable"
          error
          retry={() => {
            if (query) void find(query);
          }}
        >
          The directory request failed. This does not mean stores are out of
          stock.
        </StateCard>
      )}
      {storeState === "ready" && !stores.length && (
        <StateCard title="No stores in this directory area">
          Try another ZIP or radius. Directory coverage does not establish
          inventory availability.
        </StateCard>
      )}
      <div className="pp-grid">
        {stores.map((store) => {
          const url = directions(store);
          return (
            <article className="pp-card" key={store.id}>
              {store.is_demo && (
                <StatusBadge tone="warning">DEMO DATA</StatusBadge>
              )}
              <h2>{store.name}</h2>
              <p>
                {store.address ?? "Address unavailable"}
                {store.region ? ` · ${store.region}` : ""}
              </p>
              <p>
                {store.distance_mi === null ||
                !Number.isFinite(store.distance_mi)
                  ? "Distance unavailable"
                  : `${store.distance_mi.toFixed(1)} miles from ZIP centroid`}
              </p>
              <p className="pp-muted">
                Directory source: {store.directory_source}
              </p>
              {url ? (
                <p>
                  <a href={url}>Directions to {store.name}</a>
                </p>
              ) : (
                <p>
                  {store.is_demo
                    ? "Demo store; directions unavailable."
                    : "Directions unavailable."}
                </p>
              )}
              <div className="pp-row">
                <button
                  className="pp-button"
                  type="button"
                  aria-pressed={selected?.id === store.id}
                  onClick={() => {
                    if (selected?.id === store.id)
                      setReportRefresh((value) => value + 1);
                    else setSelected(store);
                  }}
                >
                  View reports for {store.name}
                </button>
                <button
                  className="pp-button"
                  data-variant="secondary"
                  type="button"
                  onClick={() =>
                    authenticated ? onReportStore(store) : onSignIn()
                  }
                >
                  Report at {store.name}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {storeState === "ready" && cursor && query && (
        <button
          className="pp-button"
          type="button"
          onClick={() => void find(query, cursor)}
        >
          Load more stores
        </button>
      )}
      {selected && (
        <section
          className="pp-stack"
          aria-label={`Community reports at ${selected.name}`}
        >
          <h2>Community reports at {selected.name}</h2>
          <p>
            Community reported · not store verified. Conflicting claims do not
            establish an official stock status.
          </p>
          <p className="pp-muted">
            Recent reports refresh every 30 seconds and on return to this page.
            Reports may be revised or withdrawn. Showing up to 50 current
            approved reports.
          </p>
          {confirmError && <p role="alert">{confirmError}</p>}
          {reportState === "loading" ? (
            <Skeleton label="Loading current community reports" />
          ) : reportState === "error" ? (
            <StateCard
              title="Community reports unavailable"
              error
              retry={() => setReportRefresh((value) => value + 1)}
            >
              Reports could not be refreshed. No current stock claim is
              available.
            </StateCard>
          ) : !visibleReports.length ? (
            <p>
              No current approved reports. Pending, rejected and expired reports
              are excluded.
            </p>
          ) : (
            <div className="pp-grid">
              {visibleReports.map((report) => (
                <article className="pp-card" key={report.id}>
                  {report.is_demo && (
                    <StatusBadge tone="warning">DEMO DATA</StatusBadge>
                  )}
                  <h3>
                    {report.report_type === "found_stock"
                      ? "Found stock reported"
                      : "Shelf empty reported"}
                  </h3>
                  <p>Evidence: moderated community report</p>
                  <p>
                    Observed{" "}
                    <time dateTime={report.observed_at}>
                      {formatTimestamp(report.observed_at)}
                    </time>
                  </p>
                  <p>
                    Expires{" "}
                    <time dateTime={report.expires_at}>
                      {formatTimestamp(report.expires_at)}
                    </time>
                  </p>
                  <p>
                    {report.independent_confirmations} independent confirmations
                  </p>
                  {report.conflict_count > 0 && (
                    <StatusBadge tone="warning">
                      Conflicting reports: {report.conflict_count}
                    </StatusBadge>
                  )}
                  {report.public_notes && <p>{report.public_notes}</p>}
                  {onConfirmReport && (
                    <button
                      className="pp-button"
                      type="button"
                      disabled={confirming !== null}
                      onClick={async () => {
                        if (!authenticated) {
                          onSignIn();
                          return;
                        }
                        setConfirming(report.id);
                        setConfirmError("");
                        try {
                          await onConfirmReport(report.id);
                          setReportRefresh((value) => value + 1);
                        } catch {
                          setConfirmError(
                            "Could not confirm. A report cannot be confirmed by its author, and expired or withdrawn reports cannot be confirmed.",
                          );
                        } finally {
                          setConfirming(null);
                        }
                      }}
                    >
                      Confirm independently
                    </button>
                  )}
                  {report.product_id && (
                    <a
                      href={`/products/${encodeURIComponent(report.product_id)}`}
                    >
                      View reported product
                    </a>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
