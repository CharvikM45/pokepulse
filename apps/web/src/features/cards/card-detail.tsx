"use client";
import { useState } from "react";
import { z } from "zod";
import { lotSchema } from "@pokepulse/contracts";
import { useCardUser } from "./card-user";
import Link from "next/link";
import { singleCardSchema, pricesSchema } from "@pokepulse/contracts";
import { Skeleton, StateCard } from "@pokepulse/ui";
import { useResource } from "../consumer/workspace";
import { CardSurface } from "./card-surface";
import { CardActions } from "./card-actions";
import { QuickAdd } from "../collection/quick-add";
import { PriceChart, currencyValue } from "../collection/price-chart";
import { cardRequest, queryString } from "./api";
import { cardSearchResult } from "@pokepulse/contracts";
export function CardDetail({ id }: { id: string }) {
  const resource = useResource(
    (signal) => cardRequest(`cards/${id}`, singleCardSchema, { signal }),
    id,
  );
  if (resource.loading)
    return <Skeleton label="Loading documented card details" />;
  if (resource.error || !resource.data)
    return (
      <StateCard error title="Card unavailable" retry={resource.retry}>
        {resource.error}
        <p>
          <Link href="/cards">Return to card archive</Link>
        </p>
      </StateCard>
    );
  return <Detail key={id} card={resource.data.data} />;
}
function Detail({ card }: { card: import("@pokepulse/contracts").SingleCard }) {
  const [variant, setVariant] = useState(card.variants[0]?.id ?? ""),
    [range, setRange] = useState("30D"),
    [currency, setCurrency] = useState("USD"),
    [condition, setCondition] = useState("unknown"),
    [provider, setProvider] = useState(""),
    [company, setCompany] = useState(""),
    [grade, setGrade] = useState("");
  const user = useCardUser();
  const holdings = useResource(
    async (signal) =>
      user
        ? (
            await cardRequest(
              `me/card-holdings?card_id=${card.id}`,
              z.object({
                physical: z.array(
                  z.object({ card_variant_id: z.uuid(), quantity: z.number() }),
                ),
                virtual: z.array(
                  z.object({ card_variant_id: z.uuid(), quantity: z.number() }),
                ),
                lots: z.array(lotSchema),
              }),
              { signal },
            )
          ).data
        : null,
    user + card.id,
  );
  const chosen = card.variants.find((v) => v.id === variant);
  const query = queryString({
    variant,
    range,
    currency,
    condition,
    limit: 366,
    provider: provider || undefined,
    grading_company: company,
    grade,
  });
  const prices = useResource(
    (signal) =>
      cardRequest(`cards/${card.id}/prices?${query}`, pricesSchema, { signal }),
    query,
  );
  const related = useResource(
    (signal) =>
      cardRequest(`cards?set_id=${card.set_id}&limit=6`, cardSearchResult, {
        signal,
      }),
    card.set_id,
  );
  const attacks = Array.isArray(card.metadata.attacks)
      ? card.metadata.attacks
      : [],
    abilities = Array.isArray(card.metadata.abilities)
      ? card.metadata.abilities
      : [];
  return (
    <>
      <Link href="/cards">← Card Pokédex</Link>
      <div className="pp-card-detail-grid">
        <section className="pp-card-detail-surface">
          {chosen ? (
            <CardSurface variant={chosen} rarity={card.rarity} />
          ) : (
            <div className="pp-card-scan-unavailable">Artwork unavailable</div>
          )}
        </section>
        <section>
          <p className="pp-eyebrow">
            {card.language?.toUpperCase()} /{" "}
            {card.series ?? "Series unavailable"}
          </p>
          <h1>{card.name}</h1>
          <p className="pp-card-number">
            #{card.number} ·{" "}
            {card.rarity?.replaceAll("_", " ") ?? "Rarity unavailable"}
          </p>
          <p>
            <Link href={`/card-sets/${card.set_id}`}>{card.set_name}</Link> ·{" "}
            {card.release_date ?? "Release date not documented"}
          </p>
          <p>
            Illustrator:{" "}
            {card.artists.length
              ? card.artists.map((a, i) => (
                  <span key={a}>
                    {i > 0 ? ", " : ""}
                    <Link href={`/artists?q=${encodeURIComponent(a)}`}>
                      {a}
                    </Link>
                  </span>
                ))
              : "Not documented"}
          </p>
          <dl className="pp-card-facts">
            <div>
              <dt>Category / stage</dt>
              <dd>
                {card.category ?? "Unavailable"} · {card.stage ?? "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>HP / type</dt>
              <dd>
                {card.hp ?? "—"} · {card.types.join(" / ") || "Not documented"}
              </dd>
            </div>
            <div>
              <dt>Pokédex numbers</dt>
              <dd>{card.pokedex_numbers.join(", ") || "Not documented"}</dd>
            </div>
            <div>
              <dt>Provider rarity</dt>
              <dd>{card.rarity_original ?? "Not documented"}</dd>
            </div>
          </dl>
          <label>
            Printing finish
            <select
              className="pp-input"
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
            >
              {card.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.finish}
                  {v.edition ? " · " + v.edition : ""} ·{" "}
                  {v.rarity ?? "Unknown rarity"}
                </option>
              ))}
            </select>
          </label>
          {holdings.data && (
            <section className="pp-card">
              <h2>Your copies</h2>
              <p>
                {holdings.data.physical.reduce((n, r) => n + r.quantity, 0)}{" "}
                physical ·{" "}
                {holdings.data.virtual.reduce((n, r) => n + r.quantity, 0)}{" "}
                virtual (separate)
              </p>
              <ul>
                {holdings.data.lots.map((l) => (
                  <li key={l.id}>
                    {l.quantity} · {l.condition.replaceAll("_", " ")} ·{" "}
                    {l.grading_company
                      ? `${l.grading_company} ${l.grade}`
                      : "raw"}
                  </li>
                ))}
              </ul>
              <Link href="/collection/portfolio">
                Manage conditions and acquisition details →
              </Link>
            </section>
          )}
          <div className="pp-stack">
            <QuickAdd card={card} />
            <CardActions id={card.id} />
          </div>
          <p className="pp-muted">
            Metadata synchronized{" "}
            {card.synchronized_at
              ? new Date(card.synchronized_at).toLocaleString()
              : "at an unrecorded time"}
            .{" "}
            {card.source_url && (
              <a
                href={card.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Verified detail source ↗
              </a>
            )}
          </p>
          <Link href={`/collection?set_id=${card.set_id}`}>
            View missing-in-set checklist →
          </Link>
        </section>
      </div>
      <section className="pp-card pp-stack">
        <h2>On the card</h2>
        {attacks.length > 0 && <h3>Attacks</h3>}
        {attacks.map((a, i) => {
          const v = a as Record<string, unknown>;
          return (
            <article key={i}>
              <h4>
                {String(v.name ?? "Unnamed attack")} {String(v.damage ?? "")}
              </h4>
              <p>{String(v.effect ?? "")}</p>
            </article>
          );
        })}
        {abilities.length > 0 && <h3>Abilities</h3>}
        {abilities.map((a, i) => {
          const v = a as Record<string, unknown>;
          return (
            <p key={i}>
              <strong>{String(v.name ?? "")}</strong> {String(v.effect ?? "")}
            </p>
          );
        })}
        {!attacks.length && !abilities.length && (
          <p>Attacks and abilities are not documented for this record.</p>
        )}
        <details>
          <summary>Legality, regulation, and other documented details</summary>
          <pre className="pp-metadata">
            {JSON.stringify(
              {
                weaknesses: card.metadata.weaknesses,
                resistances: card.metadata.resistances,
                retreat: card.metadata.retreat,
                regulation: card.metadata.regulation,
                legality: card.metadata.legality,
                evolves_from: card.metadata.evolves_from,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </section>
      <section id="prices" className="pp-card pp-stack">
        <p className="pp-eyebrow">MEASURED SINGLES OBSERVATIONS</p>
        <h2>Price history</h2>
        <div className="pp-filters">
          <label>
            Window
            <select
              className="pp-input"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              {["7D", "30D", "90D", "1Y", "ALL"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            Currency
            <select
              className="pp-input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option>USD</option>
              <option>JPY</option>
              <option>EUR</option>
              <option>GBP</option>
            </select>
          </label>
          <label>
            Condition
            <select
              className="pp-input"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              {[
                "unknown",
                "near_mint",
                "lightly_played",
                "moderately_played",
                "heavily_played",
                "damaged",
              ].map((v) => (
                <option key={v} value={v}>
                  {v.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Provider (blank chooses latest source)
            <input
              className="pp-input"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              maxLength={40}
            />
          </label>
          <label>
            Grading company (graded only)
            <input
              className="pp-input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={40}
            />
          </label>
          <label>
            Grade
            <input
              className="pp-input"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              maxLength={20}
            />
          </label>
        </div>
        {prices.loading ? (
          <Skeleton label="Loading price observations" />
        ) : prices.error ? (
          <StateCard error title="Prices unavailable" retry={prices.retry}>
            {prices.error}
          </StateCard>
        ) : (
          prices.data && (
            <>
              <PriceChart
                points={prices.data.data.observations.map((o) => ({
                  time: o.observed_at,
                  value: o.amount_minor,
                }))}
                currency={currency}
                label={`${card.name} market observations`}
              />
              <div className="pp-dex-counts">
                <div>
                  <strong>
                    {currencyValue(prices.data.data.min, currency)}
                  </strong>
                  <span>Observed low</span>
                </div>
                <div>
                  <strong>
                    {currencyValue(prices.data.data.max, currency)}
                  </strong>
                  <span>Observed high</span>
                </div>
                <div>
                  <strong>
                    {prices.data.data.change_percent === null
                      ? "—"
                      : prices.data.data.change_percent.toFixed(1) + "%"}
                  </strong>
                  <span>Observed change</span>
                </div>
                <div>
                  <strong>{prices.data.data.count}</strong>
                  <span>Observations in window</span>
                </div>
              </div>
              {prices.data.data.stale && (
                <p className="pp-banner">
                  No current reference observation for this exact variant,
                  condition, grade, source and currency.
                </p>
              )}
              <ul>
                {Array.from(
                  new Set(
                    prices.data.data.observations.map(
                      (o) => o.provider_id + "|" + o.source_url,
                    ),
                  ),
                ).map((s) => {
                  const [name, url] = s.split("|");
                  return (
                    <li key={s}>
                      <a href={url} rel="noopener noreferrer" target="_blank">
                        {name} · source record ↗
                      </a>
                    </li>
                  );
                })}
              </ul>
              {prices.data.meta.next_cursor && (
                <p>
                  Chart shows the first 366 observations. Choose a shorter
                  window to inspect a denser history.
                </p>
              )}
            </>
          )
        )}
        <p className="pp-muted">
          Market references describe documented observations, not guaranteed
          sale proceeds. Physical and virtual cards are separate.
        </p>
      </section>
      <section className="pp-stack">
        <h2>More from {card.set_name}</h2>
        <div className="pp-related-cards">
          {related.data?.data.cards
            .filter((c) => c.id !== card.id)
            .map((c) => (
              <Link className="pp-card" key={c.id} href={`/cards/${c.id}`}>
                {c.name} · #{c.number} · {c.language}
              </Link>
            ))}
        </div>
      </section>
    </>
  );
}
