"use client";
import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cardIndexResult, cardSearchResult } from "@pokepulse/contracts";
import { Skeleton, StateCard } from "@pokepulse/ui";
import { useResource } from "../consumer/workspace";
import { cardRequest } from "./api";
import { CardTile } from "./card-explorer";
export function CatalogIndex({
  kind,
  id,
}: {
  kind: "artists" | "card-sets";
  id?: string;
}) {
  const params = useSearchParams(),
    router = useRouter();
  const q = params.toString(),
    [view, setView] = useState("gallery");
  const index = useResource(
    (signal) =>
      cardRequest(
        `${kind}${id ? "/" + id : ""}?${q}`,
        id ? cardSearchResult : cardIndexResult,
        { signal },
      ),
    kind + id + q,
  );
  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    router.push(
      `/${kind}?${new URLSearchParams({ q: String(data.get("q") ?? "") })}`,
    );
  }
  const data = index.data?.data;
  return (
    <>
      <header className="pp-dex-hero">
        <p className="pp-eyebrow">THE CARD ARCHIVE</p>
        <h1>
          {id && data && "title" in data && data.title
            ? data.title
            : kind === "artists"
              ? "Behind every illustration."
              : "A world of expansions."}
        </h1>
        <p>
          {id
            ? "Documented printings from this archive entry."
            : kind === "artists"
              ? "Explore credited illustrators and their documented work."
              : "Browse indexed sets by release and language. Pack simulation eligibility is separate."}
        </p>
        <Link href="/cards">Return to card Pokédex →</Link>
      </header>
      {!id && (
        <form className="pp-quick-search" onSubmit={search}>
          <label>
            Search {kind === "artists" ? "illustrators" : "sets"}
            <input
              className="pp-input"
              name="q"
              defaultValue={params.get("q") ?? ""}
              maxLength={100}
            />
          </label>
          <button className="pp-button">Search archive</button>
        </form>
      )}
      {id && (
        <label>
          View{" "}
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="gallery">Gallery</option>
            <option value="list">List</option>
          </select>
        </label>
      )}
      {index.loading ? (
        <Skeleton label="Loading archive index" />
      ) : index.error ? (
        <StateCard error title="Archive unavailable" retry={index.retry}>
          {index.error}
        </StateCard>
      ) : data && "cards" in data ? (
        <div className={view === "gallery" ? "pp-pokedex-grid" : "pp-stack"}>
          {data.cards.map((c) => (
            <CardTile key={c.id} card={c} />
          ))}
        </div>
      ) : data && "entries" in data ? (
        <div className="pp-grid">
          {data.entries.map((e) => (
            <Link
              className="pp-card pp-index-entry"
              key={e.id}
              href={`/${kind}/${e.id}`}
            >
              <span className="pp-eyebrow">
                {e.language?.toUpperCase() ?? "ILLUSTRATOR"}
              </span>
              <h2>{e.name}</h2>
              <p>
                {e.series ?? ""} {e.release_date ?? ""}
              </p>
              <strong>{e.count} documented printings ↗</strong>
            </Link>
          ))}
        </div>
      ) : null}
      {data &&
        (("entries" in data && !data.entries.length) ||
          ("cards" in data && !data.cards.length)) && (
          <StateCard title="No approved archive entries">
            Catalog imports remain gated until provider permissions are
            recorded. Try another search after an approved import.
          </StateCard>
        )}
      {index.data?.meta.next_cursor && (
        <Link
          className="pp-button"
          href={`/${kind}${id ? "/" + id : ""}?${new URLSearchParams({ ...Object.fromEntries(params), cursor: index.data.meta.next_cursor })}`}
        >
          Next page →
        </Link>
      )}
    </>
  );
}
