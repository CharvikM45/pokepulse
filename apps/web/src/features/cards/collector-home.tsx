"use client";
import Link from "next/link";
import { cardSearchResult, coverageSchema } from "@pokepulse/contracts";
import { Skeleton, StateCard } from "@pokepulse/ui";
import { useResource } from "../consumer/workspace";
import { cardRequest } from "./api";
import { CardTile } from "./card-explorer";
export function CollectorHome() {
  const catalog = useResource(async (signal) => {
    const [cards, coverage] = await Promise.all([
      cardRequest("cards?sort=release&limit=8&language=en", cardSearchResult, {
        signal,
      }),
      cardRequest("cards/coverage", coverageSchema, { signal }),
    ]);
    return { cards: cards.data.cards, coverage: coverage.data };
  }, "collector-home");
  return (
    <>
      <header className="pp-collector-welcome">
        <p className="pp-eyebrow">YOUR COLLECTION, IN FOCUS</p>
        <h1>
          A home for every
          <br />
          card you collect.
        </h1>
        <p>
          Find the exact printing. Add your copies. Watch your collection grow.
        </p>
        <form action="/cards" className="pp-library-search">
          <label className="pp-sr-only" htmlFor="home-card-search">
            Search Pokémon cards
          </label>
          <span aria-hidden="true">⌕</span>
          <input
            id="home-card-search"
            name="q"
            placeholder="Search Pokémon, cards or sets"
            maxLength={100}
          />
          <button className="pp-button">Search</button>
        </form>
        <div className="pp-collector-stats" aria-label="Catalog coverage">
          <span>
            <strong>
              {catalog.data?.coverage.printings.toLocaleString() ?? "—"}
            </strong>{" "}
            card printings
          </span>
          <span>
            <strong>
              {catalog.data?.coverage.sets.toLocaleString() ?? "—"}
            </strong>{" "}
            sets
          </span>
          <span>
            <strong>{catalog.data?.coverage.languages.length ?? "—"}</strong>{" "}
            languages
          </span>
        </div>
      </header>
      <section className="pp-library-links" aria-label="Start collecting">
        <Link href="/collection/portfolio">
          <span>YOUR CARDS</span>
          <strong>
            My collection <span aria-hidden="true">↗</span>
          </strong>
          <p>Every copy, organized in one place.</p>
        </Link>
        <Link href="/card-sets">
          <span>THE CHECKLIST</span>
          <strong>
            Explore sets <span aria-hidden="true">↗</span>
          </strong>
          <p>From the earliest releases to your next chase.</p>
        </Link>
      </section>
      <section>
        <div className="pp-section-heading">
          <div>
            <p className="pp-eyebrow">THE CARD LIBRARY</p>
            <h2>Discover your next addition</h2>
          </div>
          <Link href="/cards">Browse all cards →</Link>
        </div>
        {catalog.loading ? (
          <Skeleton label="Loading card library" />
        ) : catalog.error ? (
          <StateCard
            title="Card library unavailable"
            error
            retry={catalog.retry}
          >
            {catalog.error}
          </StateCard>
        ) : catalog.data?.cards.length ? (
          <div className="pp-pokedex-grid">
            {catalog.data.cards.map((card) => (
              <CardTile key={card.id} card={card} />
            ))}
          </div>
        ) : (
          <StateCard title="The card library is being indexed">
            Real card metadata will appear as each source import completes.
          </StateCard>
        )}
      </section>
      <p className="pp-library-source">
        Catalog metadata by{" "}
        <a href="https://tcgdex.dev" target="_blank" rel="noreferrer">
          TCGdex
        </a>
        . Coverage varies by language and printing. Artwork and prices appear
        only when available and cleared.
      </p>
      <div className="pp-library-more">
        <Link href="/products">Sealed products</Link>
        <Link href="/drops">Retail drops</Link>
        <Link href="/lab">Pack simulator</Link>
        <Link href="/local">Local Radar</Link>
      </div>
    </>
  );
}
