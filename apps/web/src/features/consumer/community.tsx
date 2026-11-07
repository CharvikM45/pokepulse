"use client";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Skeleton, StateCard } from "@pokepulse/ui";
import * as c from "../../collector-contracts";
import { useSession } from "../../auth/use-session";
import {
  LocalRadar,
  type RadarService,
  type RadarStore,
} from "../radar/local-radar";
import { StoreMap } from "../radar/store-map";
import { ReportForm } from "../radar/report-form";
import { ReleaseCalendar } from "../calendar/release-calendar";
import { ModerationQueue, type ReviewService } from "../radar/moderation-queue";
import {
  ReleaseEditor,
  type EditableRelease,
} from "../calendar/release-editor";
import { SignIn } from "./account";
import { allProducts, timestamp } from "./discovery";
import { useResource } from "./workspace";

export function RadarPage() {
  const session = useSession(),
    [signIn, setSignIn] = useState(false),
    [store, setStore] = useState<RadarStore | null>(null);
  const [productId, setProductId] = useState<string | null>(null),
    [reporting, setReporting] = useState(false);
  const products = useResource(
    (signal) => (store ? allProducts(signal) : Promise.resolve([])),
    store?.id ?? "no-selected-store",
  );
  const maps = useResource(
    async (signal) =>
      (await c.collectorRequest("stores/map", c.mapSchema, { signal })).data,
    "map-configuration",
  );
  const service = useMemo<RadarService>(
    () => ({
      stores: async (query, signal) =>
        (
          await c.collectorRequest(
            `stores?${new URLSearchParams({ zip: query.zip, radius_mi: String(query.radius_mi), ...(query.cursor ? { cursor: query.cursor } : {}) })}`,
            c.storesSchema,
            { signal },
          )
        ).data,
      sightings: async (id, signal) =>
        (
          await c.collectorRequest(
            `stores/${id}/sightings?limit=50`,
            z.array(c.sightingSchema),
            { signal },
          )
        ).data,
    }),
    [],
  );
  return (
    <>
      <p className="pp-eyebrow">COMMUNITY · COARSE LOCATION</p>
      <p>
        Search by ZIP. Reports are community observations, not store-verified
        stock guarantees. We never request your GPS location.
      </p>
      <LocalRadar
        service={service}
        authenticated={!!session.user}
        onSignIn={() => setSignIn(true)}
        onReportStore={(store) => {
          setStore(store);
          setProductId(null);
        }}
        formatTimestamp={timestamp}
        renderMap={
          maps.data?.config
            ? (stores) => (
                <StoreMap stores={stores} config={maps.data!.config!} />
              )
            : undefined
        }
        onConfirmReport={async (id) => {
          await c.collectorRequest(
            "sightings/confirm",
            z.object({ id: c.uuid }),
            { method: "POST", body: { id } },
          );
        }}
      />
      {store && (
        <section className="pp-card">
          <h2>Report at {store.name}</h2>
          <button onClick={() => setStore(null)}>Close report</button>
          <label>
            Reported product (optional)
            <select
              className="pp-input"
              value={productId ?? ""}
              disabled={reporting}
              onChange={(event) => setProductId(event.target.value || null)}
            >
              <option value="">Product not specified</option>
              {products.data?.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                  {product.is_demo ? " · DEMO" : ""}
                </option>
              ))}
            </select>
          </label>
          {products.error && (
            <p>
              Product choices could not load. You may submit a store-only report
              or <button onClick={products.retry}>retry product choices</button>
              .
            </p>
          )}
          <ReportForm
            key={`${session.user?.id ?? "anonymous"}:${store.id}`}
            storeId={store.id}
            productId={productId}
            authenticated={!!session.user}
            onSignIn={() => setSignIn(true)}
            onSubmit={async (draft, key) => {
              setReporting(true);
              try {
                await c.collectorRequest(
                  "sightings",
                  z.object({ id: c.uuid, moderation: z.literal("pending") }),
                  { method: "POST", body: draft, key },
                );
              } finally {
                setReporting(false);
              }
            }}
          />
        </section>
      )}
      {signIn && !session.user && <SignIn />}
    </>
  );
}
export function CalendarPage() {
  const [filters, setFilters] = useState({
    region: "",
    event_type: "",
    set_name: "",
  });
  const resource = useResource(async (signal) => {
    const entries: z.infer<typeof c.releaseSchema>[] = [];
    let cursor: string | null | undefined;
    do {
      const q = new URLSearchParams({
        limit: "50",
        ...(filters.region ? { region: filters.region } : {}),
        ...(filters.event_type ? { event_type: filters.event_type } : {}),
        ...(cursor ? { cursor } : {}),
      });
      const page = await c.collectorRequest(
        `releases?${q}`,
        z.array(c.releaseSchema),
        { signal },
      );
      entries.push(...page.data);
      cursor = page.meta.next_cursor;
    } while (cursor);
    const products = await allProducts(signal);
    return {
      entries,
      names: Object.fromEntries(
        products.filter((p) => p.set_name).map((p) => [p.id, p.set_name!]),
      ),
    };
  }, JSON.stringify(filters));
  return (
    <>
      <p className="pp-eyebrow">PLAN · SOURCED DATES</p>
      <p>
        Editorial release information does not establish retailer availability.
      </p>
      <ReleaseCalendar
        entries={resource.data?.entries ?? []}
        productSetNames={resource.data?.names}
        initialMonth={new Date().toISOString().slice(0, 7)}
        formatVerifiedAt={timestamp}
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.retry}
        filters={filters}
        onFiltersChange={setFilters}
      />
    </>
  );
}
const adminSchema = z.object({
  authorized: z.literal(true),
  hosts: z.array(z.string()),
  products: z.array(z.object({ id: c.uuid, name: z.string() })),
  releases: z.array(c.editableRelease),
});
export function CollectorAdmin() {
  const resource = useResource(
    async () => (await c.collectorRequest("admin/collector", adminSchema)).data,
    "admin",
  );
  const [selected, setSelected] = useState<EditableRelease>();
  const service = useMemo<ReviewService>(
    () => ({
      load: async (query, signal) =>
        (
          await c.collectorRequest(
            `admin/sightings?${new URLSearchParams({ state: query.state, ...(query.cursor ? { cursor: query.cursor } : {}) })}`,
            z.object({
              reports: z.array(c.reviewSchema),
              next_cursor: z.string().nullable(),
            }),
            { signal },
          )
        ).data,
      moderate: async (draft, key) => {
        const { sighting_id, ...body } = draft;
        return (
          await c.collectorRequest(
            `admin/sightings/${sighting_id}/moderate`,
            c.reviewReceipt,
            { method: "POST", body, key },
          )
        ).data;
      },
    }),
    [],
  );
  return (
    <>
      <h1>Collector content review</h1>
      {resource.loading ? (
        <Skeleton label="Checking staff access" />
      ) : resource.error || !resource.data ? (
        <StateCard error title="Staff access required" retry={resource.retry}>
          {resource.error}
        </StateCard>
      ) : (
        <>
          <ModerationQueue
            authorized
            service={service}
            formatTimestamp={timestamp}
          />
          <h2>Release curation</h2>
          <label>
            Existing release
            <select
              className="pp-input"
              value={selected?.id ?? ""}
              onChange={(e) =>
                setSelected(
                  resource.data?.releases.find((r) => r.id === e.target.value),
                )
              }
            >
              <option value="">Create a release</option>
              {resource.data.releases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · revision {r.revision}
                </option>
              ))}
            </select>
          </label>
          <ReleaseEditor
            authorized
            initial={selected}
            approvedSourceHosts={resource.data.hosts}
            products={resource.data.products}
            save={async (body, key) =>
              (
                await c.collectorRequest(
                  "admin/collector/releases",
                  c.editableRelease,
                  { method: "POST", body, key },
                )
              ).data
            }
            onSaved={() => {
              setSelected(undefined);
              resource.retry();
            }}
          />
        </>
      )}
    </>
  );
}
