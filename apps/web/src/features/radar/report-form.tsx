"use client";
import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  observationTime,
  uuidValue,
  validateReportNotes,
} from "../../../../../packages/domain/src/radar/policies";

export interface ReportDraft {
  store_id: string;
  product_id: string | null;
  report_type: "found_stock" | "shelf_empty";
  observed_at: string;
  notes: string;
}
/** A's parent auth boundary renders sign-in before exposing authenticated submit.
 * Server still repeats validation, ignores body identity/status, and applies rate limits.
 */
export function ReportForm({
  storeId,
  productId = null,
  onSubmit,
  onSignIn,
  authenticated,
}: {
  storeId: string;
  productId?: string | null;
  authenticated: boolean;
  onSignIn: () => void;
  onSubmit: (draft: ReportDraft, idempotencyKey: string) => Promise<void>;
}) {
  const id = useId();
  const [kind, setKind] = useState<"found_stock" | "shelf_empty">(
    "found_stock",
  );
  const [observedAt, setObservedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  // Retain the same key+normalized body on network retry. Edited drafts get a new key.
  const request = useRef<{ serialized: string; key: string } | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    let draft: ReportDraft;
    try {
      if (!uuidValue(storeId) || (productId !== null && !uuidValue(productId)))
        throw new Error();
      const instant = new Date(observedAt);
      if (!Number.isFinite(instant.getTime())) throw new Error();
      draft = {
        store_id: storeId,
        product_id: productId,
        report_type: kind,
        observed_at: observationTime(instant.toISOString(), Date.now()),
        notes: validateReportNotes(notes),
      };
    } catch {
      setError(
        "Choose a time within the last 24 hours, no later than now. Keep notes under 280 characters without links, contact details or markup.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    const serialized = JSON.stringify(draft);
    if (request.current?.serialized !== serialized)
      request.current = { serialized, key: crypto.randomUUID() };
    setPending(true);
    try {
      await onSubmit(draft, request.current.key);
      setSubmitted(true);
    } catch {
      setError(
        "Your report could not be acknowledged. Retry with the same draft to reuse its request key.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setPending(false);
    }
  }
  if (!authenticated)
    return (
      <section className="pp-card">
        <h2>Report a sighting</h2>
        <p>
          Sign in to submit a report for independent moderation. Public store
          browsing stays available.
        </p>
        <button className="pp-button" type="button" onClick={onSignIn}>
          Sign in to report
        </button>
      </section>
    );
  if (submitted)
    return (
      <section className="pp-card" role="status">
        <h2>Report received for moderation</h2>
        <p>
          Your report is pending. It is not public or store verified. It can
          appear only after independent staff approval and before expiry.
        </p>
      </section>
    );
  return (
    <form onSubmit={submit} className="pp-card pp-stack" aria-busy={pending}>
      <h2>Report a sighting</h2>
      <p>
        Community reports are not store verification. Do not include personal
        contact details, people’s names or private locations. Photos are
        disabled.
      </p>
      {error && (
        <p role="alert" className="pp-error" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      <label className="pp-field" htmlFor={`${id}-kind`}>
        What did you see?
        <select
          className="pp-input"
          id={`${id}-kind`}
          value={kind}
          disabled={pending}
          onChange={(e) =>
            setKind(e.target.value as ReportDraft["report_type"])
          }
        >
          <option value="found_stock">Found stock</option>
          <option value="shelf_empty">Shelf empty</option>
        </select>
      </label>
      <label className="pp-field" htmlFor={`${id}-time`}>
        Observed time (your local time)
        <input
          className="pp-input"
          type="datetime-local"
          id={`${id}-time`}
          required
          value={observedAt}
          disabled={pending}
          onChange={(e) => setObservedAt(e.target.value)}
        />
      </label>
      <label className="pp-field" htmlFor={`${id}-notes`}>
        Optional notes
        <textarea
          className="pp-input"
          id={`${id}-notes`}
          maxLength={280}
          value={notes}
          disabled={pending}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <button className="pp-button" type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit for moderation"}
      </button>
    </form>
  );
}
