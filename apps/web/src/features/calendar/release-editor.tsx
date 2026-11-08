"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { releaseDateLabel } from "../../../../../packages/domain/src/calendar/dates";
import { uuidValue } from "../../../../../packages/domain/src/radar/policies";
import {
  SearchCombobox,
  StateCard,
  StatusBadge,
} from "../../../../../packages/ui/src/primitives";
import type { CalendarRelease } from "./release-calendar";

export interface CuratedReleaseInput {
  name: string;
  product_id: string | null;
  date: string | null;
  date_precision: CalendarRelease["date_precision"];
  event_type: CalendarRelease["event_type"];
  region: string | null;
  source_url: string;
  verified_at: string;
  is_demo: boolean;
  status: "published" | "withdrawn";
}
export interface ReleaseEditDraft {
  release_id: string | null;
  expected_revision: number;
  entry: CuratedReleaseInput;
  reason: string;
}
export interface EditableRelease extends CuratedReleaseInput {
  id: string;
  revision: number;
}
export interface ReleaseEditorProps {
  authorized: boolean;
  initial?: EditableRelease;
  demo?: boolean;
  approvedSourceHosts: readonly string[];
  products: readonly { id: string; name: string }[];
  save: (draft: ReleaseEditDraft, key: string) => Promise<EditableRelease>;
  onSaved?: (release: EditableRelease) => void;
}
export function ReleaseEditor(props: ReleaseEditorProps) {
  return props.authorized ? (
    <Editor
      key={
        props.initial ? `${props.initial.id}:${props.initial.revision}` : "new"
      }
      {...props}
    />
  ) : (
    <StateCard title="Staff access required">
      Release curation requires trusted staff access. No editorial draft is
      shown.
    </StateCard>
  );
}
function Editor({
  initial,
  demo = true,
  approvedSourceHosts,
  products,
  save,
  onSaved,
}: ReleaseEditorProps) {
  const id = useId();
  const [releaseId, setReleaseId] = useState(initial?.id ?? null);
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const [name, setName] = useState(initial?.name ?? "");
  const [product, setProduct] = useState<string | null>(
    initial?.product_id ?? null,
  );
  const [precision, setPrecision] = useState<
    CuratedReleaseInput["date_precision"]
  >(initial?.date_precision ?? "unconfirmed");
  const [day, setDay] = useState(initial?.date ?? "");
  const [month, setMonth] = useState(initial?.date?.slice(0, 7) ?? "");
  const [kind, setKind] = useState<CuratedReleaseInput["event_type"]>(
    initial?.event_type ?? "release",
  );
  const [region, setRegion] = useState(initial?.region ?? "");
  const [source, setSource] = useState(initial?.source_url ?? "");
  const [verified, setVerified] = useState(initial?.verified_at ?? "");
  const [status, setStatus] = useState<CuratedReleaseInput["status"]>(
    initial?.status ?? "published",
  );
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const lock = useRef(false);
  const request = useRef<{ body: string; key: string } | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const fingerprint = JSON.stringify({
    name,
    product,
    precision,
    day,
    month,
    kind,
    region,
    source,
    verified,
    status,
  });
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(
    initial ? fingerprint : null,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || savedFingerprint === fingerprint) return;
    let entry: CuratedReleaseInput;
    try {
      if (
        !name.trim() ||
        name.trim().length > 160 ||
        !reason.trim() ||
        reason.trim().length > 500 ||
        region.trim().length > 32 ||
        (product !== null && !uuidValue(product)) ||
        !Number.isInteger(revision) ||
        revision < 0 ||
        (releaseId !== null && !uuidValue(releaseId))
      )
        throw new Error();
      let date: string | null = null;
      if (precision === "day") {
        releaseDateLabel(day, "day");
        date = day;
      }
      if (precision === "month") {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error();
        releaseDateLabel(`${month}-01`, "month");
        date = `${month}-01`;
      }
      const url = new URL(source);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !approvedSourceHosts.some(
          (host) => host.toLowerCase() === url.hostname.toLowerCase(),
        )
      )
        throw new Error();
      const instant = Date.parse(verified);
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(verified) ||
        !Number.isFinite(instant) ||
        instant > Date.now() ||
        new Date(instant).toISOString().slice(0, 19) !== verified.slice(0, 19)
      )
        throw new Error();
      entry = {
        name: name.trim(),
        product_id: product,
        date,
        date_precision: precision,
        event_type: kind,
        region: region.trim() || null,
        source_url: url.href,
        verified_at: verified,
        is_demo: initial?.is_demo ?? demo,
        status,
      };
    } catch {
      setError(
        "Use a name up to 160 characters, a valid date or unconfirmed precision, an approved HTTPS source, a nonfuture UTC verification timestamp, and an audit reason up to 500 characters.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    const draft: ReleaseEditDraft = {
      release_id: releaseId,
      expected_revision: revision,
      entry,
      reason: reason.trim(),
    };
    const body = JSON.stringify(draft);
    if (request.current?.body !== body)
      request.current = { body, key: crypto.randomUUID() };
    lock.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const receipt = await save(draft, request.current.key);
      if (!active.current) return;
      if (
        !uuidValue(receipt.id) ||
        (releaseId !== null && receipt.id !== releaseId) ||
        receipt.revision !== revision + 1
      )
        throw new Error();
      setSavedFingerprint(fingerprint);
      setReleaseId(receipt.id);
      setRevision(receipt.revision);
      request.current = null;
      setNotice(
        `Editorial release saved at revision ${receipt.revision}. Its source and date precision remain visible to readers.`,
      );
      try {
        onSaved?.(receipt);
      } catch {
        setNotice(
          "Editorial release saved. Refresh the release list to see its latest revision.",
        );
      }
    } catch {
      if (active.current) {
        setError(
          "The edit could not be acknowledged. Retry the unchanged draft with its saved request key. If another editor changed the release, refresh its current revision before editing again.",
        );
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }
  const options = products.map((item) => ({
    value: item.id,
    label: item.name,
  }));
  if (product !== null && !options.some((item) => item.value === product))
    options.push({
      value: product,
      label: "Linked product metadata unavailable",
    });
  return (
    <section className="pp-stack" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`}>Curate a release</h1>
      {(initial?.is_demo ?? demo) && (
        <StatusBadge tone="warning">DEMO DATA</StatusBadge>
      )}
      <p>
        Use an attributable announcement. A release or preorder date is not
        evidence of retailer stock. Record when you checked the source; no
        current verification time is filled in automatically.
      </p>
      {!approvedSourceHosts.length && (
        <p className="pp-banner">
          No source hosts are approved. Saving remains disabled.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={submit} className="pp-card pp-stack" aria-busy={pending}>
        {error && (
          <p className="pp-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        <fieldset disabled={pending}>
          <legend>Announcement details</legend>
          <div className="pp-field">
            <label htmlFor={`${id}-name`}>Release name</label>
            <input
              className="pp-input"
              id={`${id}-name`}
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <SearchCombobox
            label="Linked canonical product (optional)"
            value={product}
            onChange={setProduct}
            options={options}
          />
          <button
            className="pp-button"
            data-variant="secondary"
            type="button"
            onClick={() => setProduct(null)}
          >
            No linked product
          </button>
          <div className="pp-field">
            <label htmlFor={`${id}-precision`}>Date precision</label>
            <select
              className="pp-input"
              id={`${id}-precision`}
              value={precision}
              onChange={(e) =>
                setPrecision(
                  e.target.value as CuratedReleaseInput["date_precision"],
                )
              }
            >
              <option value="unconfirmed">Date unconfirmed</option>
              <option value="month">Month announced; exact day unknown</option>
              <option value="day">Exact day announced</option>
            </select>
          </div>
          {precision === "day" && (
            <div className="pp-field">
              <label htmlFor={`${id}-day`}>Announced day</label>
              <input
                className="pp-input"
                type="date"
                id={`${id}-day`}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
          )}
          {precision === "month" && (
            <div className="pp-field">
              <label htmlFor={`${id}-month`}>Announced month</label>
              <input
                className="pp-input"
                type="month"
                id={`${id}-month`}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
          )}
          {precision === "unconfirmed" && (
            <p>No placeholder date will be published.</p>
          )}
          <div className="pp-field">
            <label htmlFor={`${id}-kind`}>Event type</label>
            <select
              className="pp-input"
              id={`${id}-kind`}
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as CuratedReleaseInput["event_type"])
              }
            >
              <option value="release">Release</option>
              <option value="preorder">Preorder</option>
              <option value="announcement">Announcement</option>
            </select>
          </div>
          <div className="pp-field">
            <label htmlFor={`${id}-region`}>Region (optional)</label>
            <input
              className="pp-input"
              id={`${id}-region`}
              maxLength={32}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            />
          </div>
          <div className="pp-field">
            <label htmlFor={`${id}-source`}>Approved announcement URL</label>
            <input
              className="pp-input"
              id={`${id}-source`}
              type="url"
              maxLength={2048}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <div className="pp-field">
            <label htmlFor={`${id}-verified`}>
              Source verified at (ISO UTC)
            </label>
            <input
              className="pp-input"
              id={`${id}-verified`}
              placeholder="YYYY-MM-DDTHH:mm:ssZ"
              value={verified}
              onChange={(e) => setVerified(e.target.value)}
            />
          </div>
          <div className="pp-field">
            <label htmlFor={`${id}-status`}>Publication status</label>
            <select
              className="pp-input"
              id={`${id}-status`}
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as CuratedReleaseInput["status"])
              }
            >
              <option value="published">Publish sourced announcement</option>
              <option value="withdrawn">Withdraw announcement</option>
            </select>
          </div>
          <div className="pp-field">
            <label htmlFor={`${id}-reason`}>Audit reason</label>
            <textarea
              className="pp-input"
              id={`${id}-reason`}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </fieldset>
        <p>
          Current editorial revision: {revision}. Published history is retained
          when dates are corrected.
        </p>
        <button
          className="pp-button"
          type="submit"
          disabled={
            pending ||
            !approvedSourceHosts.length ||
            savedFingerprint === fingerprint
          }
        >
          {pending ? "Saving editorial update…" : "Save sourced release"}
        </button>
      </form>
    </section>
  );
}
