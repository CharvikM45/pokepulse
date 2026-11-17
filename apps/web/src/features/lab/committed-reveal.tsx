"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CardSurface } from "../cards/card-surface";
import { normalizedRarity } from "../../../../../packages/domain/src/cards/rarity";
/** Presentation of an immutable server receipt. No fetching, randomness, inventory writes or debits. */
export interface RevealCard {
  card_variant_id: string;
  slot_index: number;
  name: string;
  number: string;
  finish: string;
  set_id?: string;
  presentation?: {
    id: string;
    set_id: string;
    card_name: string;
    card_number: string;
    finish: string;
    rarity?: string | null;
    image_url?: string | null;
    image_rights_cleared?: boolean;
    eligible_for_packs: boolean;
    card_id?: string;
  };
}
export interface CommittedRevealProps {
  openingId: string;
  openedAtLabel: string;
  oddsVersion: string;
  spentCoins: number;
  usedFreeOpen: boolean;
  cards: readonly RevealCard[];
  binderHref?: string;
}
export function CommittedReveal(props: CommittedRevealProps) {
  return <Opening key={props.openingId} {...props} />;
}
function Opening({
  openingId,
  openedAtLabel,
  oddsVersion,
  spentCoins,
  usedFreeOpen,
  cards,
  binderHref = "/lab#opening-history",
}: CommittedRevealProps) {
  const [revealed, setRevealed] = useState(0),
    [paused, setPaused] = useState(false),
    [reducedMotion, setReducedMotion] = useState(false),
    [animate, setAnimate] = useState(true),
    [opened, setOpened] = useState(false),
    [tearing, setTearing] = useState(false);
  const pointer = useRef<number | null>(null);
  const title = useId();
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(query.matches);
      if (query.matches) setAnimate(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!tearing) return;
    const timer = setTimeout(() => {
      setOpened(true);
      setTearing(false);
    }, 320);
    return () => clearTimeout(timer);
  }, [tearing]);
  function tear() {
    if (paused || tearing) return;
    if (animate && !reducedMotion) setTearing(true);
    else setOpened(true);
  }
  const ordered = [...cards].sort((a, b) => a.slot_index - b.slot_index),
    complete = revealed >= ordered.length;
  const active = ordered[revealed - 1];
  const rarity = active?.presentation?.rarity
    ? normalizedRarity(active.presentation.rarity)
    : null;
  function advance() {
    if (paused || complete) return;
    setTearing(false);
    setOpened(true);
    setRevealed((v) => Math.min(ordered.length, v + 1));
  }
  const counts = new Map<string, number>();
  for (const c of ordered)
    counts.set(
      c.presentation?.rarity ?? "Rarity not documented",
      (counts.get(c.presentation?.rarity ?? "Rarity not documented") ?? 0) + 1,
    );
  return (
    <section
      className="pp-card pp-stack pp-cinematic-opening"
      aria-labelledby={title}
      data-opening-id={openingId}
      data-phase={complete ? "results" : opened ? "revealing" : "sealed"}
      data-motion={animate && !reducedMotion ? "on" : "off"}
    >
      <h2 id={title}>Saved simulated opening</h2>
      <p className="pp-banner">
        Free simulation · no physical ownership, cash value or prizes. The
        server has already saved this result.
      </p>
      <p>
        {openedAtLabel} · Odds version {oddsVersion} ·{" "}
        {usedFreeOpen
          ? "Free opening allowance used"
          : spentCoins === 0
            ? "Free opening"
            : `${spentCoins} free-only coins used`}
      </p>
      <div className="pp-opening-theater" data-rarity={rarity ?? "unknown"}>
        {!opened && !complete ? (
          <button
            type="button"
            className="pp-original-pack"
            data-tearing={tearing}
            disabled={paused || tearing}
            onPointerDown={(e) => {
              pointer.current = e.clientX;
            }}
            onPointerUp={(e) => {
              if (
                pointer.current !== null &&
                Math.abs(e.clientX - pointer.current) > 60
              )
                tear();
              pointer.current = null;
            }}
            onClick={tear}
            aria-label="Tear open saved pack"
          >
            <span className="pp-pack-tear" aria-hidden="true">
              TEAR HERE →
            </span>
            <span className="pp-pack-brand">POKÉPULSE</span>
            <span className="pp-pack-star" aria-hidden="true">
              ✦
            </span>
            <strong>The discovery pack</strong>
            <small>ORIGINAL WRAPPER / FREE SIMULATION</small>
            <span className="pp-pack-bottom">
              {ordered.length} saved cards inside
            </span>
          </button>
        ) : (
          <div
            className="pp-card-stage"
            onTouchStart={(e) => {
              pointer.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (
                pointer.current !== null &&
                Math.abs(e.changedTouches[0].clientX - pointer.current) > 45
              )
                advance();
              pointer.current = null;
            }}
          >
            <div className="pp-stack-shadow" aria-hidden="true" />
            <div
              className="pp-stack-shadow pp-stack-shadow-two"
              aria-hidden="true"
            />
            {active ? (
              <div
                key={active.slot_index}
                className={
                  animate && !reducedMotion
                    ? "pp-stage-card pp-flip-in"
                    : "pp-stage-card"
                }
              >
                {active.presentation ? (
                  <CardSurface variant={active.presentation} rarity={rarity} />
                ) : (
                  <div className="pp-original-card-face">
                    <span>#{active.number}</span>
                    <h3>{active.name}</h3>
                    <p>{active.finish}</p>
                    <small>Artwork unavailable · saved result preserved</small>
                  </div>
                )}
              </div>
            ) : (
              <button
                className="pp-card-back"
                onClick={advance}
                disabled={paused}
                aria-label="Reveal first saved card"
              >
                <span aria-hidden="true">✦</span>
                <strong>Your next discovery</strong>
                <small>Reveal a saved card</small>
              </button>
            )}
          </div>
        )}
      </div>
      {active && (
        <div className="pp-active-card-label">
          <strong>{active.name}</strong>
          <span>
            #{active.number} · {active.finish} ·{" "}
            {active.presentation?.rarity ?? "Rarity not documented"}
          </span>
          {active.presentation?.card_id && (
            <a href={`/cards/${active.presentation.card_id}`}>Card details →</a>
          )}
        </div>
      )}
      <div className="pp-row">
        <button
          className="pp-button"
          type="button"
          disabled={paused || complete}
          onClick={advance}
        >
          Reveal next card
        </button>
        <button
          className="pp-button"
          type="button"
          disabled={complete}
          onClick={() => {
            setTearing(false);
            setOpened(true);
            setRevealed(ordered.length);
            setPaused(false);
          }}
        >
          Reveal all
        </button>
        {!complete && (
          <button
            className="pp-button"
            data-variant="secondary"
            type="button"
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? "Resume reveal" : "Pause reveal"}
          </button>
        )}
      </div>
      {!reducedMotion && (
        <label className="pp-check">
          <input
            type="checkbox"
            checked={animate}
            onChange={(e) => setAnimate(e.target.checked)}
          />
          <span>Use subtle reveal transitions</span>
        </label>
      )}
      <p role="status" aria-live="polite" aria-atomic="true">
        {revealed} of {ordered.length} cards revealed{paused ? " · paused" : ""}
        .
      </p>
      <ol className="pp-reveal-list">
        {ordered.slice(0, revealed).map((card) => (
          <li
            key={card.slot_index}
            className={
              animate ? "pp-reveal-card pp-reveal-motion" : "pp-reveal-card"
            }
          >
            <span aria-hidden="true">◇ </span>
            <strong>{card.name}</strong> · {card.number} · {card.finish}
          </li>
        ))}
      </ol>
      {complete && (
        <section className="pp-opening-results">
          <h3>Your saved discoveries</h3>
          <p>
            {ordered.length} cards ·{" "}
            {new Set(ordered.map((c) => c.card_variant_id)).size} distinct
            variants. Duplicate pulls remain in your virtual collection.
          </p>
          <ul>
            {[...counts].map(([name, count]) => (
              <li key={name}>
                {name}: {count}
              </li>
            ))}
          </ul>
          <p>
            All cards shown. <a href={binderHref}>View saved openings</a>
          </p>
        </section>
      )}
      <p className="pp-muted">
        Reloading never opens another pack. Your persisted opening remains
        available in opening history. Animation playback cannot change these
        cards.
      </p>
    </section>
  );
}
