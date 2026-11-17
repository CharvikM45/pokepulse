"use client";
import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  cardSearchResult,
  coverageSchema,
  cardIndexResult,
  type SingleCard,
} from "@pokepulse/contracts";
import { Skeleton, StateCard, useNow } from "@pokepulse/ui";
import { useResource } from "../consumer/workspace";
import { CardSurface } from "./card-surface";
import { CardActions } from "./card-actions";
import { QuickAdd } from "../collection/quick-add";
import { cardRequest } from "./api";
import { currencyValue } from "../collection/price-chart";
export function CardTile({
  card,
  currency = "USD",
}: {
  card: SingleCard;
  currency?: string;
}) {
  const now = useNow(60000);
  const variant = card.variants[0];
  const prices = card.reference_prices
    .filter((p) => p.currency === currency)
    .sort((a, b) => a.amount_minor - b.amount_minor);
  const price = prices[0];
  return (
    <article className="pp-card pp-pokedex-tile">
      <Link href={`/cards/${card.id}`} className="pp-card-image-link">
        {variant ? (
          <CardSurface variant={variant} rarity={card.rarity} />
        ) : (
          <div className="pp-card-scan-unavailable">Card metadata only</div>
        )}
      </Link>
      <p className="pp-eyebrow">
        {card.set_name} · {card.language?.toUpperCase() ?? "Locale unavailable"}
      </p>
      <h2>
        <Link href={`/cards/${card.id}`}>{card.name}</Link>{" "}
        <small>#{card.number}</small>
      </h2>
      <p>
        {card.rarity?.replaceAll("_", " ") ?? "Rarity unavailable"} ·{" "}
        {card.types.join(" / ") || card.category || "Category unavailable"}
      </p>
      <p className="pp-muted">
        Illustrator: {card.artists.join(", ") || "Not documented"}
      </p>
      <p className="pp-muted">
        {card.favorites} favorites ·{" "}
        <Link href={`/cards/${card.id}#prices`}>View sourced prices</Link>
      </p>
      <p>
        {price
          ? `From ${currencyValue(price.amount_minor, price.currency)} · ${price.provider_id} market reference`
          : "Singles price unavailable"}
        {price && (
          <small className="pp-price-freshness">
            Observed {new Date(price.observed_at).toLocaleDateString()}
            {now > 0 && now - Date.parse(price.observed_at) > 7 * 86400000
              ? " · Stale reference"
              : ""}
          </small>
        )}
      </p>
      <QuickAdd card={card} />
      <CardActions id={card.id} />
    </article>
  );
}
export function CardExplorer({ market = false }: { market?: boolean }) {
  const params = useSearchParams(),
    router = useRouter();
  const identity = params.toString();
  const [view, setView] = useState("gallery");
  const [term, setTerm] = useState("");
  const resource = useResource(
    (signal) =>
      cardRequest(
        `cards?${identity}${!params.has("sort") && market ? "&sort=price" : ""}`,
        cardSearchResult,
        { signal },
      ),
    identity + market,
  );
  const coverage = useResource(
    (signal) => cardRequest("cards/coverage", coverageSchema, { signal }),
    "coverage",
  );
  const artists = useResource(
    (signal) =>
      cardRequest(
        `artists?q=${encodeURIComponent(term)}&limit=12`,
        cardIndexResult,
        { signal },
      ),
    term,
  );
  const sets = useResource(
    (signal) => cardRequest("card-sets?limit=50", cardIndexResult, { signal }),
    "card-set-index",
  );
  const suggestions = useResource(
    (signal) =>
      cardRequest(
        `cards?q=${encodeURIComponent(term)}&limit=6`,
        cardSearchResult,
        { signal },
      ),
    term,
  );
  function filter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      q = new URLSearchParams();
    for (const key of new Set(f.keys())) {
      const values = f.getAll(key).map(String).filter(Boolean);
      if (values.length) q.set(key, values.join(","));
    }
    const price = q.get("max_dollars");
    q.delete("max_dollars");
    if (price) q.set("max_price", String(Math.round(Number(price) * 100)));
    router.push(`${market ? "/market" : "/cards"}?${q}`);
  }
  const count = coverage.data?.data;
  return (
    <>
      <header className="pp-dex-hero">
        <p className="pp-eyebrow">
          POKÉPULSE / {market ? "SINGLES MARKET" : "CARD ARCHIVE"}
        </p>
        <h1>
          {market ? "A clearer view of the market." : "Every card has a story."}
        </h1>
        <p>
          Explore documented printings, meet the illustrators, and make your
          collection your own.
        </p>
        <div className="pp-row">
          <Link href="/card-sets">Browse sets ↗</Link>
          <Link href="/artists">Explore illustrators ↗</Link>
          <Link href="/collection/portfolio">Your physical portfolio ↗</Link>
        </div>
        <div className="pp-dex-counts">
          <div>
            <strong>{count?.printings ?? "—"}</strong>
            <span>Indexed printings</span>
          </div>
          <div>
            <strong>{count?.sets ?? "—"}</strong>
            <span>Documented sets</span>
          </div>
          <div>
            <strong>{count?.artists ?? "—"}</strong>
            <span>Illustrators</span>
          </div>
          <div>
            <strong>{count?.languages.join(" / ").toUpperCase() || "—"}</strong>
            <span>Indexed languages</span>
          </div>
        </div>
      </header>
      <form className="pp-card pp-dex-filters" key={identity} onSubmit={filter}>
        <label>
          Find a card
          <input
            className="pp-input"
            name="q"
            list="card-suggestions"
            defaultValue={params.get("q") ?? ""}
            placeholder="Name, discovery, your next favorite…"
            maxLength={100}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        <datalist id="card-suggestions">
          {suggestions.data?.data.cards.map((card) => (
            <option key={card.id} value={card.name}>
              {card.set_name} · #{card.number}
            </option>
          ))}
        </datalist>
        <details>
          <summary>Refine your discovery</summary>
          <div className="pp-filters">
            <label>
              Set
              <select
                className="pp-input"
                name="set_id"
                defaultValue={params.get("set_id") ?? ""}
              >
                <option value="">All approved sets</option>
                {sets.data?.data.entries.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.language}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Illustrator
              <input
                className="pp-input"
                name="artist"
                list="artist-suggestions"
                defaultValue={params.get("artist") ?? ""}
                onChange={(e) => setTerm(e.target.value)}
              />
            </label>
            <datalist id="artist-suggestions">
              {artists.data?.data.entries.map((a) => (
                <option key={a.id} value={a.name} />
              ))}
            </datalist>
            <label>
              Language
              <select
                className="pp-input"
                name="language"
                defaultValue={params.get("language") ?? ""}
              >
                <option value="">All languages</option>
                <option value="en">English</option>
                <option value="ja">Japanese</option>
              </select>
            </label>
            <label>
              Pokédex number
              <input
                className="pp-input"
                name="pokedex"
                type="number"
                min="1"
                max="10000"
                defaultValue={params.get("pokedex") ?? ""}
              />
            </label>
            <label>
              Era / series
              <input
                className="pp-input"
                name="series"
                defaultValue={params.get("series") ?? ""}
              />
            </label>
            <label>
              Finish
              <input
                className="pp-input"
                name="finish"
                placeholder="normal, holo, reverse…"
                defaultValue={params.get("finish") ?? ""}
              />
            </label>
            <label>
              Physical ownership
              <select
                className="pp-input"
                name="ownership"
                defaultValue={params.get("ownership") ?? "all"}
              >
                <option value="all">All cards</option>
                <option value="owned">Owned (sign in)</option>
                <option value="missing">Missing (sign in)</option>
              </select>
            </label>
            <label>
              Maximum reference price (USD)
              <input
                className="pp-input"
                name="max_dollars"
                type="number"
                min="0"
                step=".01"
                defaultValue={
                  params.has("max_price")
                    ? Number(params.get("max_price")) / 100
                    : ""
                }
              />
            </label>
            <label>
              Sort
              <select
                className="pp-input"
                name="sort"
                defaultValue={params.get("sort") ?? (market ? "price" : "name")}
              >
                <option value="name">Name</option>
                <option value="release">Newest release</option>
                <option value="price">Reference price (low first)</option>
                <option value="popular">Community favorites</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend>Rarity (select any)</legend>
            {[
              "common",
              "uncommon",
              "rare",
              "ultra_rare",
              "illustration_rare",
              "special_illustration_rare",
              "secret_rare",
            ].map((r) => (
              <label className="pp-inline-check" key={r}>
                <input
                  type="checkbox"
                  name="rarity"
                  value={r}
                  defaultChecked={params.get("rarity")?.split(",").includes(r)}
                />
                {r.replaceAll("_", " ")}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Type (select any)</legend>
            {[
              "Grass",
              "Fire",
              "Water",
              "Lightning",
              "Psychic",
              "Fighting",
              "Darkness",
              "Metal",
              "Dragon",
              "Colorless",
            ].map((t) => (
              <label className="pp-inline-check" key={t}>
                <input
                  type="checkbox"
                  name="type"
                  value={t}
                  defaultChecked={params.get("type")?.split(",").includes(t)}
                />
                {t}
              </label>
            ))}
          </fieldset>
        </details>
        <div className="pp-row">
          <button className="pp-button">Explore cards</button>
          <Link href={market ? "/market" : "/cards"}>Reset filters</Link>
        </div>
      </form>
      <div className="pp-topbar">
        <p>
          {count
            ? `${count.variants.toLocaleString()} indexed physical variants · measured coverage`
            : "Loading catalog coverage…"}
        </p>
        <label>
          View{" "}
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="gallery">Gallery</option>
            <option value="list">List</option>
          </select>
        </label>
      </div>
      {resource.loading ? (
        <Skeleton label="Searching the card archive" />
      ) : resource.error ? (
        <StateCard error title="Card search unavailable" retry={resource.retry}>
          {resource.error}
        </StateCard>
      ) : resource.data?.data.cards.length ? (
        <div className={view === "gallery" ? "pp-pokedex-grid" : "pp-stack"}>
          {resource.data.data.cards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              currency={params.get("currency") ?? "USD"}
            />
          ))}
        </div>
      ) : (
        <section className="pp-card pp-dex-empty">
          <span aria-hidden="true">✦</span>
          <h2>
            {count?.printings
              ? "No matching printings"
              : "The archive is waiting for its first approved import"}
          </h2>
          <p>
            {count?.printings
              ? "Try fewer filters or another language."
              : "Provider metadata is indexed only after permission and synchronization. No fictional catalog is presented as real cards."}
          </p>
          <p>
            Retail product discovery and your existing binder remain available.
          </p>
          <Link className="pp-button" href="/products">
            Explore sealed products
          </Link>
        </section>
      )}
      {resource.data?.meta.next_cursor && (
        <Link
          className="pp-button"
          href={`${market ? "/market" : "/cards"}?${new URLSearchParams({ ...Object.fromEntries(params), cursor: resource.data.meta.next_cursor })}`}
        >
          Next page →
        </Link>
      )}
      <p className="pp-muted">
        Singles prices are independent from sealed-product offers. Missing
        prices remain unavailable; artwork may be withheld while metadata
        remains searchable. Coverage is measured, not a claim of worldwide
        completeness.
      </p>
    </>
  );
}
