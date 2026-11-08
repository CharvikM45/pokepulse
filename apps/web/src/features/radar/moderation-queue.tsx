"use client";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { validateReportNotes } from "../../../../../packages/domain/src/radar/policies";
import {
  Dialog,
  Skeleton,
  StateCard,
  StatusBadge,
  useNow,
} from "../../../../../packages/ui/src/primitives";

export interface ReviewReport {
  id: string;
  store_name: string;
  product_name: string | null;
  report_type: "found_stock" | "shelf_empty";
  moderation: "pending" | "approved" | "rejected" | "expired";
  observed_at: string;
  expires_at: string;
  private_notes: string;
  public_notes: string | null;
  is_demo: boolean;
  submitted_by_current_staff: boolean;
  revision: number;
}
export interface ReviewDraft {
  sighting_id: string;
  decision: "approved" | "rejected";
  reason: string;
  public_notes: string | null;
  expected_revision: number;
}
export interface ReviewService {
  load: (
    query: { state: ReviewReport["moderation"]; cursor: string | null },
    signal: AbortSignal,
  ) => Promise<{
    reports: readonly ReviewReport[];
    next_cursor: string | null;
  }>;
  moderate: (
    draft: ReviewDraft,
    key: string,
  ) => Promise<{
    id: string;
    moderation: "approved" | "rejected";
    revision: number;
  }>;
}
export function ModerationQueue({
  authorized,
  service,
  formatTimestamp,
}: {
  /** Presentation only; the API/database must independently verify trusted staff. */
  authorized: boolean;
  service: ReviewService;
  formatTimestamp: (iso: string) => string;
}) {
  const now = useNow();
  const id = useId();
  const [state, setState] = useState<ReviewReport["moderation"]>("pending");
  const [rows, setRows] = useState<readonly ReviewReport[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<ReviewReport | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const generation = useRef(0);
  const authEpoch = useRef(0);
  const request = useRef<{ body: string; key: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  async function load(nextCursor: string | null = null) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const current = ++generation.current;
    setPhase("loading");
    if (nextCursor === null) {
      setRows([]);
      setCursor(null);
    }
    try {
      const result = await service.load(
        { state, cursor: nextCursor },
        controller.signal,
      );
      if (controller.signal.aborted || generation.current !== current) return;
      setRows((old) =>
        nextCursor === null
          ? result.reports
          : [
              ...old,
              ...result.reports.filter(
                (report) => !old.some((row) => row.id === report.id),
              ),
            ],
      );
      setCursor(result.next_cursor);
      setPhase("ready");
    } catch {
      if (!controller.signal.aborted && generation.current === current)
        setPhase("error");
    }
  }
  const beginLoad = useEffectEvent(() => {
    authEpoch.current++;
    setSelected(null);
    setError("");
    setNotice("");
    setPendingId(null);
    request.current = null;
    if (!authorized) {
      abort.current?.abort();
      setRows([]);
      setCursor(null);
      return;
    }
    void load();
  });
  useEffect(() => {
    const timer = setTimeout(() => beginLoad(), 0);
    const requestAbort = abort;
    return () => {
      clearTimeout(timer);
      requestAbort.current?.abort();
    };
  }, [authorized, state, reload, service]);
  function choose(report: ReviewReport) {
    setSelected(report);
    setDecision(report.moderation === "approved" ? "rejected" : "approved");
    setReason("");
    setNotes("");
    setError("");
    request.current = null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || pendingId || !authorized) return;
    let draft: ReviewDraft;
    try {
      if (
        selected.submitted_by_current_staff ||
        !reason.trim() ||
        reason.trim().length > 500 ||
        (decision === "approved" &&
          Date.parse(selected.expires_at) <= Date.now())
      )
        throw new Error();
      draft = {
        sighting_id: selected.id,
        decision,
        reason: reason.trim(),
        public_notes:
          decision === "approved" ? validateReportNotes(notes) || null : null,
        expected_revision: selected.revision,
      };
    } catch {
      setError(
        "Independent staff review is required. Enter a reason up to 500 characters; public notes must be reviewed, under 280 characters and contain no contact details or markup. Expired reports cannot be approved.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    const body = JSON.stringify(draft);
    if (request.current?.body !== body)
      request.current = { body, key: crypto.randomUUID() };
    const epoch = authEpoch.current;
    setPendingId(selected.id);
    setError("");
    setNotice("");
    try {
      const receipt = await service.moderate(draft, request.current.key);
      if (authEpoch.current !== epoch) return;
      if (
        receipt.id !== draft.sighting_id ||
        receipt.moderation !== draft.decision ||
        receipt.revision !== draft.expected_revision + 1
      )
        throw new Error();
      setRows((old) => old.filter((row) => row.id !== receipt.id));
      setSelected(null);
      setNotice(
        `Review saved: ${receipt.moderation}. The server controls public visibility and expiry.`,
      );
      request.current = null;
    } catch {
      if (authEpoch.current === epoch) {
        setError(
          "The review could not be acknowledged. Retry the unchanged review to reuse its request key, or refresh the queue if another reviewer changed it.",
        );
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    } finally {
      if (authEpoch.current === epoch) setPendingId(null);
    }
  }
  if (!authorized)
    return (
      <StateCard title="Staff access required">
        This queue requires a trusted staff session. No private reports are
        loaded.
      </StateCard>
    );
  return (
    <section className="pp-stack" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`}>Sighting moderation</h1>
      <p>
        Review independently. Public notes are written separately; submitted
        notes are never copied automatically.
      </p>
      <div className="pp-row">
        <div className="pp-field">
          <label htmlFor={`${id}-state`}>Report state</label>
          <select
            id={`${id}-state`}
            className="pp-input"
            value={state}
            disabled={Boolean(pendingId)}
            onChange={(e) =>
              setState(e.target.value as ReviewReport["moderation"])
            }
          >
            {["pending", "approved", "rejected", "expired"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <button
          className="pp-button"
          type="button"
          disabled={Boolean(pendingId)}
          onClick={() => setReload((value) => value + 1)}
        >
          Refresh queue
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {pendingId && (
        <p role="status">
          Review request pending. Closing the dialog does not cancel a submitted
          server review.
        </p>
      )}
      {error && !selected && (
        <p className="pp-error" role="alert" ref={errorRef} tabIndex={-1}>
          {error}
        </p>
      )}
      {phase === "loading" && (
        <Skeleton label="Loading private moderation queue" />
      )}
      {phase === "error" && (
        <StateCard
          title="Review queue unavailable"
          error
          retry={() => setReload((value) => value + 1)}
        >
          The private queue could not be loaded.
        </StateCard>
      )}
      {phase === "ready" && !rows.length && (
        <StateCard title="No reports in this queue">
          There are no reports matching this state.
        </StateCard>
      )}
      <div className="pp-grid">
        {rows.map((report) => {
          const expired =
            (now > 0 && Date.parse(report.expires_at) <= now) ||
            report.moderation === "expired";
          return (
            <article className="pp-card" key={report.id}>
              {report.is_demo && (
                <StatusBadge tone="warning">DEMO DATA</StatusBadge>
              )}
              <h2>{report.store_name}</h2>
              <p>
                {report.product_name ?? "Product not specified"} ·{" "}
                {report.report_type === "found_stock"
                  ? "Found stock reported"
                  : "Shelf empty reported"}
              </p>
              <p>State: {expired ? "expired" : report.moderation}</p>
              <p>
                Observed {formatTimestamp(report.observed_at)} · expires{" "}
                {formatTimestamp(report.expires_at)}
              </p>
              <p>
                <strong>Submitted note (staff only):</strong>{" "}
                {report.private_notes || "No note submitted."}
              </p>
              {report.submitted_by_current_staff && (
                <p>
                  You submitted this report; another staff member must review
                  it.
                </p>
              )}
              {!expired && (
                <button
                  className="pp-button"
                  type="button"
                  aria-label={`Review report at ${report.store_name}`}
                  disabled={
                    Boolean(pendingId) || report.submitted_by_current_staff
                  }
                  onClick={() => choose(report)}
                >
                  {report.moderation === "approved"
                    ? "Review or withdraw approval"
                    : "Review report"}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {phase === "ready" && cursor && (
        <button
          className="pp-button"
          type="button"
          disabled={Boolean(pendingId)}
          onClick={() => void load(cursor)}
        >
          Load more reports
        </button>
      )}
      <Dialog
        open={selected !== null}
        title="Independent report review"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <form
            onSubmit={submit}
            className="pp-stack"
            aria-busy={Boolean(pendingId)}
          >
            <p>
              {selected.store_name} · {selected.report_type}
            </p>
            {error && (
              <p className="pp-error" role="alert" ref={errorRef} tabIndex={-1}>
                {error}
              </p>
            )}
            <div className="pp-field">
              <label htmlFor={`${id}-decision`}>Decision</label>
              <select
                id={`${id}-decision`}
                className="pp-input"
                value={decision}
                disabled={Boolean(pendingId)}
                onChange={(e) =>
                  setDecision(e.target.value as ReviewDraft["decision"])
                }
              >
                <option
                  value="approved"
                  disabled={selected.moderation === "approved"}
                >
                  Approve community report
                </option>
                <option
                  value="rejected"
                  disabled={selected.moderation === "rejected"}
                >
                  Reject or withdraw approval
                </option>
              </select>
            </div>
            <div className="pp-field">
              <label htmlFor={`${id}-reason`}>Audit reason</label>
              <textarea
                id={`${id}-reason`}
                className="pp-input"
                maxLength={500}
                value={reason}
                disabled={Boolean(pendingId)}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            {decision === "approved" && (
              <div className="pp-field">
                <label htmlFor={`${id}-public`}>
                  Public note (optional; reviewed text only)
                </label>
                <textarea
                  id={`${id}-public`}
                  className="pp-input"
                  maxLength={280}
                  value={notes}
                  disabled={Boolean(pendingId)}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            )}
            <p>
              Approval produces moderated community evidence, never official
              retailer stock. Withdrawal invalidates current signal eligibility
              through the server.
            </p>
            <button
              className="pp-button"
              type="submit"
              disabled={Boolean(pendingId)}
            >
              {pendingId ? "Saving review…" : "Save review"}
            </button>
          </form>
        )}
      </Dialog>
    </section>
  );
}
