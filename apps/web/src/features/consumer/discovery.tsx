"use client";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createApiClient,
  catalogQuerySchema,
  type ListingDTO,
  type ProductRecord,
  ApiError,
} from "@pokepulse/contracts";
import Link from "next/link";
import { Skeleton, StateCard, useNow } from "@pokepulse/ui";
import { useResource, useSourceRefresh } from "./workspace";

export const client = (signal?: AbortSignal) =>
  createApiClient(window.location.origin, (input, init) =>
    fetch(input, {
      ...init,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    }),
  );
export async function allProducts(signal?: AbortSignal) {
  const products: ProductRecord[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await client(signal).products({
      limit: 50,
      ...(cursor ? { cursor } : {}),
    });
    products.push(...page.data);
    cursor = page.meta.next_cursor;
  } while (cursor);
  return products;
}
export async function allOffers(signal?: AbortSignal) {
  const offers: ListingDTO[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await client(signal).drops({
      limit: 50,
      ...(cursor ? { cursor } : {}),
    });
    offers.push(...page.data);
    cursor = page.meta.next_cursor;
  } while (cursor);
  return offers;
}
const words = (value: string) => value.replaceAll("_", " ");
export const timestamp = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not recorded";
export function safeLink(value: string | null): string | null {
  if (!value || /[\\\r\n]/.test(value)) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function money(amount: number | null, currency: string | null) {
  return amount === null || currency === null
    ? "Price unavailable"
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
        amount / 100,
      );
}
export function WatchButton({
  productId,
  listingId,
}: {
  productId?: string;
  listingId?: string;
}) {
  const pending = useRef(false),
    key = useRef<string | null>(null);
  const [message, setMessage] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        className="pp-button"
        disabled={busy || message === "Saved to your watchlist."}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          key.current ??= crypto.randomUUID();
          try {
            await client().watch(
              { product_id: productId ?? null, listing_id: listingId ?? null },
              key.current,
            );
            setMessage("Saved to your watchlist.");
            setNeedsSignIn(false);
          } catch (error) {
            setNeedsSignIn(error instanceof ApiError && error.status === 401);
            setMessage(
              error instanceof Error
                ? error.message + ". Sign in if needed, then retry."
                : "Unable to save. Retry.",
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : listingId ? "Watch exact offer" : "Watch product"}
      </button>
      <span role="status">{message}</span>
      {needsSignIn && <Link href="/dashboard">Sign in to save this watch</Link>}
    </div>
  );
}
export function Offer({
  offer,
  product,
  detailed = false,
}: {
  offer: ListingDTO;
  product?: ProductRecord;
  detailed?: boolean;
}) {
  const now = useNow(30000);
  const checked = offer.last_successful_check_at;
  const age =
    checked && now
      ? Math.max(0, Math.floor((now - Date.parse(checked)) / 60000))
      : null;
  return (
    <article className="pp-card pp-offer">
      <div className="pp-eyebrow">
        {offer.is_demo ? "DEMO DATA · synthetic offer" : offer.retailer_name}
      </div>
      {product && (
        <h2>
          <a href={`/products/${product.id}`}>{product.name}</a>
        </h2>
      )}
      <div className="pp-badges">
        <span>{words(offer.availability_status)}</span>
        <span>{words(offer.evidence_type)}</span>
        <span>{offer.freshness}</span>
      </div>
      <p>
        <strong>{money(offer.price_minor, offer.currency)}</strong> ·{" "}
        {offer.retailer_name}
      </p>
      <dl className="pp-facts">
        <div>
          <dt>Seller</dt>
          <dd>
            {offer.seller_type === "third_party"
              ? "Third-party marketplace seller"
              : words(offer.seller_type)}
          </dd>
        </div>
        <div>
          <dt>Channel / region</dt>
          <dd>
            {words(offer.channel)} · {offer.region_code ?? "Region unknown"}
          </dd>
        </div>
        <div>
          <dt>Source checked</dt>
          <dd title={timestamp(checked)}>
            {age === null ? "No successful check recorded" : `${age} min ago`}
          </dd>
        </div>
        <div>
          <dt>Observed</dt>
          <dd>{timestamp(offer.observed_at)}</dd>
        </div>
      </dl>
      <p className="pp-muted">{offer.evidence_summary}</p>
      {offer.freshness !== "fresh" && (
        <p className="pp-banner">
          {offer.freshness === "unavailable"
            ? "Source unavailable. Current availability is unknown."
            : "Last known evidence; availability may have changed."}
        </p>
      )}
      {detailed && product?.pack_count && offer.price_minor !== null && (
        <p>
          {money(
            Math.round(offer.price_minor / product.pack_count),
            offer.currency,
          )}{" "}
          per pack · based on catalog pack count {product.pack_count}.
        </p>
      )}
      <div className="pp-actions">
        {safeLink(offer.retailer_url) ? (
          <a
            href={safeLink(offer.retailer_url)!}
            target="_blank"
            rel="noopener noreferrer"
          >
            {offer.is_demo ? "Demo source page" : "Visit retailer"} ↗
          </a>
        ) : (
          <p>Source link unavailable</p>
        )}
        <WatchButton listingId={offer.id} />
      </div>
      <small>
        Listed price may differ at checkout. Shipping, taxes and marketplace
        sellers can vary.
      </small>
    </article>
  );
}

export function Discovery({ mode }: { mode: "home" | "products" | "drops" }) {
  const params = useSearchParams(),
    router = useRouter();
  const queryText = params.toString();
  const parsed = useMemo(
    () =>
      catalogQuerySchema.safeParse(
        Object.fromEntries(new URLSearchParams(queryText)),
      ),
    [queryText],
  );
  const resource = useResource(async (signal) => {
    if (!parsed.success)
      throw new Error(
        "Invalid filters. Reset filters or supply a currency with a maximum price.",
      );
    const api = client(signal);
    const [products, offers, retailers] = await Promise.all([
      api.products(
        mode === "drops"
          ? { ...parsed.data, cursor: undefined, limit: 50 }
          : parsed.data,
      ),
      api.drops(
        mode === "drops"
          ? parsed.data
          : { ...parsed.data, cursor: undefined, limit: 1 },
      ),
      api.retailers(),
    ]);
    return { products, offers, retailers };
  }, queryText);
  const [view, setView] = useState("grid"),
    [sort, setSort] = useState(mode === "drops" ? "observed" : "name");
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget))
      if (String(value).trim()) next.set(key, String(value));
    router.push(`${mode === "home" ? "/products" : "/" + mode}?${next}`);
  }
  const data = resource.data;
  useSourceRefresh(data?.offers.data, resource.retry);
  const products = [...(data?.products.data ?? [])]
    .slice(0, mode === "home" ? 6 : 50)
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : (b.release_date ?? "").localeCompare(a.release_date ?? ""),
    );
  const next =
    mode === "drops"
      ? data?.offers.meta.next_cursor
      : data?.products.meta.next_cursor;
  const sortedOffers = [...(data?.offers.data ?? [])].sort((a, b) =>
    sort === "retailer"
      ? a.retailer_name.localeCompare(b.retailer_name)
      : (b.observed_at ?? "").localeCompare(a.observed_at ?? ""),
  );
  return (
    <>
      {mode === "home" ? (
        <section className="pp-hero">
          <p className="pp-eyebrow">THE COLLECTOR’S DAILY CHECK-IN</p>
          <h1>
            Find your next pack.
            <br />
            Know the evidence.
          </h1>
          <p>
            Explore sealed products, compare retailer offers and keep your
            collection in view.
          </p>
          <div className="pp-actions">
            <a className="pp-button" href="/drops">
              Explore drops →
            </a>
            <a href="/local">Check nearby reports</a>
          </div>
          <div className="pp-hero-note">
            Freshness. Source. Seller.
            <br />
            Every offer tells the full story.
          </div>
        </section>
      ) : (
        <header>
          <p className="pp-eyebrow">DISCOVER</p>
          <h1>{mode === "products" ? "Product Explorer" : "Live Drops"}</h1>
          <p>Availability, evidence and freshness are shown independently.</p>
        </header>
      )}
      {mode === "home" ? (
        <form className="pp-quick-search" onSubmit={filter}>
          <label>
            Find a product
            <input
              className="pp-input"
              name="q"
              placeholder="Search products or sets"
              maxLength={100}
            />
          </label>
          <button className="pp-button">Search catalog</button>
        </form>
      ) : (
        <details className="pp-filter-panel">
          <summary>Filter products and offers</summary>
          <form
            className="pp-card pp-filters"
            onSubmit={filter}
            key={queryText}
            aria-label="Catalog filters"
          >
            <label>
              Search
              <input
                className="pp-input"
                name="q"
                defaultValue={params.get("q") ?? ""}
                placeholder="Product or set name"
                maxLength={100}
              />
            </label>
            <label>
              Set
              <input
                className="pp-input"
                name="set_name"
                defaultValue={params.get("set_name") ?? ""}
              />
            </label>
            <label>
              Format
              <select
                className="pp-input"
                name="product_type"
                defaultValue={params.get("product_type") ?? ""}
              >
                <option value="">All formats</option>
                <option value="booster_box">Booster box</option>
                <option value="multi_pack">Multi-pack</option>
              </select>
            </label>
            <label>
              Retailer
              <select
                className="pp-input"
                name="retailer_id"
                defaultValue={params.get("retailer_id") ?? ""}
              >
                <option value="">All retailers</option>
                {data?.retailers.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Seller
              <select
                className="pp-input"
                name="seller_type"
                defaultValue={params.get("seller_type") ?? ""}
              >
                <option value="">All sellers</option>
                {["retailer", "third_party", "mixed", "unknown"].map((v) => (
                  <option key={v} value={v}>
                    {words(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fulfillment channel
              <select
                className="pp-input"
                name="channel"
                defaultValue={params.get("channel") ?? ""}
              >
                <option value="">All channels</option>
                {["ship_to_home", "pickup", "in_store_report", "unknown"].map(
                  (v) => (
                    <option key={v} value={v}>
                      {words(v)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Availability
              <select
                className="pp-input"
                name="availability_status"
                defaultValue={params.get("availability_status") ?? ""}
              >
                <option value="">Any status</option>
                {["in_stock", "out_of_stock", "preorder", "unknown"].map(
                  (v) => (
                    <option key={v} value={v}>
                      {words(v)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Freshness
              <select
                className="pp-input"
                name="freshness"
                defaultValue={params.get("freshness") ?? ""}
              >
                <option value="">Any freshness</option>
                {["fresh", "aging", "stale", "unavailable"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Maximum price (minor units)
              <input
                className="pp-input"
                type="number"
                min="0"
                name="max_price_minor"
                defaultValue={params.get("max_price_minor") ?? ""}
              />
            </label>
            <label>
              Currency
              <select
                className="pp-input"
                name="currency"
                defaultValue={params.get("currency") ?? ""}
              >
                <option value="">Any currency</option>
                <option>USD</option>
                <option>EUR</option>
                <option>GBP</option>
              </select>
            </label>
            <button className="pp-button">Apply filters</button>
            <a href={`/${mode}`}>Reset filters</a>
          </form>
        </details>
      )}
      <div className="pp-topbar">
        <h2>
          {mode === "drops"
            ? "Source observations on this page"
            : "Explore the catalog"}
        </h2>
        <div>
          <label>
            Sort this page{" "}
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {mode === "drops" ? (
                <>
                  <option value="observed">Observation time</option>
                  <option value="retailer">Retailer name</option>
                </>
              ) : (
                <>
                  <option value="name">Name</option>
                  <option value="release">Release date</option>
                </>
              )}
            </select>
          </label>
          <label>
            View{" "}
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="grid">Grid</option>
              <option value="list">List</option>
            </select>
          </label>
        </div>
      </div>
      <div className="pp-provenance" aria-live="polite">
        {resource.loading ? (
          <p className="pp-banner" role="status">
            Loading source details and catalog…
          </p>
        ) : data &&
          (data.products.data.some((p) => p.is_demo) ||
            data.offers.data.some((l) => l.is_demo)) ? (
          <p className="pp-banner">
            DEMO DATA — synthetic products and offers. No live retailer
            verification.
          </p>
        ) : data ? (
          <p className="pp-banner">
            Review each offer’s source, observation time and seller before
            buying.
          </p>
        ) : null}
      </div>
      {resource.loading && (
        <div className="pp-product-grid" aria-hidden="true">
          {Array.from({ length: mode === "home" ? 6 : 20 }, (_, index) => (
            <div className="pp-card pp-catalog-placeholder" key={index}>
              <div className="pp-product-art" />
              <div className="pp-skeleton" />
            </div>
          ))}
        </div>
      )}
      {resource.error && (
        <StateCard error title="Catalog unavailable" retry={resource.retry}>
          {resource.error}
        </StateCard>
      )}
      {data && !resource.loading && (
        <>
          <div className={view === "grid" ? "pp-product-grid" : "pp-stack"}>
            {mode === "drops"
              ? sortedOffers.map((offer) => (
                  <Offer
                    key={offer.id}
                    offer={offer}
                    product={products.find((p) => p.id === offer.product_id)}
                  />
                ))
              : products.map((product) => (
                  <article
                    className="pp-card pp-catalog-product"
                    key={product.id}
                  >
                    <div className="pp-product-art" aria-hidden="true">
                      <span>◈</span>
                      <small>
                        {product.product_type === "booster_box"
                          ? "BOX"
                          : "PACKS"}
                      </small>
                    </div>
                    <p className="pp-eyebrow">
                      {product.is_demo ? "DEMO · " : ""}
                      {product.set_name ?? "Set unconfirmed"}
                    </p>
                    <h2>
                      <a href={`/products/${product.id}`}>{product.name}</a>
                    </h2>
                    <p>
                      {words(product.product_type)} ·{" "}
                      {product.pack_count ?? "Unknown"} packs
                    </p>
                    <p className="pp-muted">
                      {product.edition ?? "Edition unconfirmed"} ·{" "}
                      {product.release_region ?? "Region unknown"}
                    </p>
                    <WatchButton productId={product.id} />
                  </article>
                ))}
          </div>
          {(mode === "drops" ? data.offers.data.length : products.length) ===
            0 && (
            <StateCard title="No matching records">
              Try fewer filters. An empty result does not establish that a
              retailer is sold out.
            </StateCard>
          )}
          {mode === "home" ? (
            <Link className="pp-button" href="/products">
              View all products →
            </Link>
          ) : (
            next && (
              <a
                className="pp-button"
                href={`/${mode}?${new URLSearchParams({ ...Object.fromEntries(params), cursor: next })}`}
              >
                Next page →
              </a>
            )
          )}
        </>
      )}
    </>
  );
}

export function ProductDetail({ id }: { id: string }) {
  const resource = useResource((signal) => client(signal).product(id), id);
  useSourceRefresh(resource.data?.data.offers, resource.retry);
  if (resource.loading) return <Skeleton label="Loading product" />;
  if (resource.error || !resource.data)
    return (
      <StateCard error title="Product unavailable" retry={resource.retry}>
        {resource.error ?? "Try again."}
      </StateCard>
    );
  const { product, offers, history } = resource.data.data;
  return (
    <>
      <Link href="/products">← Product Explorer</Link>
      <h1>{product.name}</h1>
      {product.is_demo && (
        <p className="pp-banner">
          DEMO DATA — original synthetic catalog record.
        </p>
      )}
      <p>
        {product.set_name} · {product.edition} ·{" "}
        {product.language ?? "Language unknown"} ·{" "}
        {product.pack_count ?? "Unverified"} packs
      </p>
      <p>Release date: {product.release_date ?? "Unconfirmed"}</p>
      {product.reference_price_minor !== null &&
        product.reference_price_source && (
          <p>
            Reference price:{" "}
            {money(
              product.reference_price_minor,
              product.reference_price_currency,
            )}{" "}
            · Source: {product.reference_price_source}. Not a guaranteed
            checkout price.
          </p>
        )}
      <WatchButton productId={product.id} />
      <p>
        Watching this product covers matching offers. Watching an exact offer
        tracks that listing only.
      </p>
      <h2>Retailer offers</h2>
      <div className="pp-product-grid">
        {offers.map((offer) => (
          <Offer key={offer.id} offer={offer} product={product} detailed />
        ))}
      </div>
      {!offers.length && (
        <p>No offers recorded. Current retailer availability is unknown.</p>
      )}
      <h2>Evidence timeline</h2>
      <p>
        Events only cover recorded observations. Gaps do not prove continuous
        availability.
      </p>
      <ol>
        {history.map((event) => (
          <li key={event.id}>
            {timestamp(event.observed_at)} · {words(event.previous_status)} →{" "}
            {words(event.current_status)} · {words(event.evidence_type)}
          </li>
        ))}
      </ol>
      {!history.length && <p>No recorded observation history.</p>}
    </>
  );
}
