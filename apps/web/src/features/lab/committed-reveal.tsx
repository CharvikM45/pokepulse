"use client";
import { useEffect, useId, useState } from "react";

/** Presentation-only projection from a validated PackOpeningDTO and card catalog.
 * Fetch the persisted opening before mounting. This component never draws or charges.
 */
export interface RevealCard {
  card_variant_id: string;
  slot_index: number;
  name: string;
  number: string;
  finish: string;
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
  // Reset on opening identity changes. Never persist raw private card data in browser storage.
  return <Opening key={props.openingId} {...props} />;
}
function Opening({
  openingId,
  openedAtLabel,
  oddsVersion,
  spentCoins,
  usedFreeOpen,
  cards,
  binderHref = "/collection?mode=virtual",
}: CommittedRevealProps) {
  const [revealed, setRevealed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [animate, setAnimate] = useState(false);
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
  const ordered = [...cards].sort((a, b) => a.slot_index - b.slot_index);
  const complete = revealed >= ordered.length;
  return (
    <section
      className="pp-card pp-stack"
      aria-labelledby={title}
      data-opening-id={openingId}
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
          : `${spentCoins} free-only coins used`}
      </p>
      <div className="pp-row">
        <button
          className="pp-button"
          type="button"
          disabled={paused || complete}
          onClick={() =>
            setRevealed((count) => Math.min(ordered.length, count + 1))
          }
        >
          Reveal next card
        </button>
        <button
          className="pp-button"
          type="button"
          disabled={complete}
          onClick={() => {
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
            onClick={() => setPaused((value) => !value)}
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
            onChange={(event) => setAnimate(event.target.checked)}
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
        <p>
          All cards shown. <a href={binderHref}>View virtual collection</a>
        </p>
      )}
      <p className="pp-muted">
        Reloading never opens another pack. Your persisted opening remains
        available in opening history.
      </p>
    </section>
  );
}
