"use client";
import { useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Dialog,
  Skeleton,
  StateCard,
} from "../../../../../packages/ui/src/primitives";
import type {
  Goal,
  InventoryEntry,
  Manifest,
  Mode,
  Variant,
} from "../../../../../packages/domain/src/collections/policies";
import {
  collectionProgress,
  inventoryQuantities,
  validateRealEdit,
} from "../../../../../packages/domain/src/collections/policies";

export interface BinderProps {
  manifest: Manifest;
  variants: readonly Variant[];
  mode: Mode;
  entriesMode: Mode;
  entriesComplete: boolean;
  entries: readonly InventoryEntry[];
  loading?: boolean;
  loadError?: string;
  onRetryInventory?: () => void;
  demo?: boolean;
  /** Parent fetches the selected private mode from the authenticated API. */
  onModeChange: (mode: Mode) => void;
  /** Required only for real mode. Caller supplies verified-session API, never userId. */
  onSaveReal?: (edit: {
    card_variant_id: string;
    quantity: number;
    notes?: string;
  }) => Promise<void>;
  realNotes?: Readonly<Record<string, string>>;
  /** Caller retrieves a private, mode/version-bound CSV from the backend. */
  onMissingExport?: (request: {
    set_id: string;
    manifest_version: string;
    mode: Mode;
    goal: Goal;
  }) => Promise<void> | void;
}
export function Binder(props: BinderProps) {
  return (
    <BinderSet key={`${props.manifest.set_id}:${props.mode}`} {...props} />
  );
}
function BinderSet({
  manifest,
  variants,
  mode,
  entriesMode,
  entriesComplete,
  entries,
  realNotes,
  onModeChange,
  onSaveReal,
  onMissingExport,
  onRetryInventory,
  loading = false,
  loadError,
  demo = false,
}: BinderProps) {
  const [search, setSearch] = useState("");
  const [ownership, setOwnership] = useState("all");
  const [finish, setFinish] = useState("");
  const [rarity, setRarity] = useState("");
  const [goal, setGoal] = useState<Goal>("base");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const realControl = useRef<HTMLButtonElement>(null);
  const [savingVariant, setSavingVariant] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const exportLock = useRef(false);
  const [sort, setSort] = useState("number");
  const [list, setList] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Variant | null>(null);
  const id = useId();
  const waiting = loading || entriesMode !== mode || !entriesComplete;
  const quantities = useMemo(() => {
    try {
      return waiting
        ? new Map<string, number>()
        : inventoryQuantities(entries, variants);
    } catch {
      return null;
    }
  }, [entries, variants, waiting]);
  const progress = useMemo(() => {
    try {
      return waiting
        ? null
        : collectionProgress(mode, manifest, variants, entries);
    } catch {
      return null;
    }
  }, [mode, manifest, variants, entries, waiting]);
  const controls = (
    <div
      key="collection-mode"
      className="pp-row"
      role="group"
      aria-label="Collection mode"
    >
      <button
        ref={realControl}
        type="button"
        className="pp-button"
        aria-pressed={mode === "real"}
        onClick={() => {
          setPage(0);
          setEditing(null);
          onModeChange("real");
        }}
      >
        Real collection
      </button>
      <button
        type="button"
        className="pp-button"
        aria-pressed={mode === "virtual"}
        onClick={() => {
          setPage(0);
          setEditing(null);
          onModeChange("virtual");
        }}
      >
        Virtual collection
      </button>
    </div>
  );
  if (loadError)
    return (
      <section className="pp-stack" aria-label={`${mode} collection`}>
        {controls}
        <StateCard
          error
          title="Collection unavailable"
          retry={onRetryInventory}
        >
          {loadError}
        </StateCard>
      </section>
    );
  if (waiting)
    return (
      <section className="pp-stack" aria-label={`${mode} collection`}>
        {controls}
        <Skeleton
          label={`Loading ${mode} collection; incomplete or previous mode quantities are hidden`}
        />
      </section>
    );
  if (quantities === null)
    return (
      <section className="pp-stack" aria-label={`${mode} collection`}>
        {controls}
        <StateCard
          error
          title="Collection data unavailable"
          retry={onRetryInventory}
        >
          The quantities could not be matched to this catalog. Refresh the
          collection before editing.
        </StateCard>
      </section>
    );
  const eligible = variants.filter(
    (variant) => variant.set_id === manifest.set_id,
  );
  const filtered = eligible
    .filter((variant) => {
      const quantity = quantities.get(variant.id) ?? 0;
      return (
        `${variant.card_name} ${variant.card_number}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()) &&
        (!finish || finish === variant.finish) &&
        (!rarity ||
          (rarity === ":unknown"
            ? !variant.rarity
            : variant.rarity === rarity)) &&
        (ownership === "all" ||
          (ownership === "owned" && quantity > 0) ||
          (ownership === "missing" && quantity === 0) ||
          (ownership === "duplicates" && quantity > 1))
      );
    })
    .sort(
      (a, b) =>
        (sort === "name"
          ? a.card_name.localeCompare(b.card_name)
          : a.card_number.localeCompare(b.card_number, "en", {
              numeric: true,
            })) ||
        a.finish.localeCompare(b.finish) ||
        a.id.localeCompare(b.id),
    );
  const lastPage = Math.max(0, Math.ceil(filtered.length / 9) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * 9, currentPage * 9 + 9);
  const label = (goal: "base" | "master" | "extended") =>
    progress?.[goal]
      ? `${progress[goal].collected}/${progress[goal].required}`
      : "Incomplete manifest";
  async function saveReal(
    edit: Parameters<NonNullable<BinderProps["onSaveReal"]>>[0],
  ) {
    if (!onSaveReal || mutationLock.current) throw new Error("UPDATE_PENDING");
    mutationLock.current = true;
    setSavingVariant(edit.card_variant_id);
    try {
      await onSaveReal(edit);
    } finally {
      mutationLock.current = false;
      setSavingVariant(null);
    }
  }
  async function exportMissing() {
    if (!onMissingExport || !progress?.[goal] || exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    setExportError("");
    setExportNotice("");
    try {
      await onMissingExport({
        set_id: manifest.set_id,
        manifest_version: manifest.version,
        mode,
        goal,
      });
      setExportNotice(
        `Missing ${mode} ${goal} checklist prepared for manifest ${manifest.version}.`,
      );
    } catch {
      setExportError(
        "The missing checklist could not be exported. Try again; collection quantities were not changed.",
      );
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  }
  return (
    <section
      className="pp-stack"
      aria-label={`${mode === "real" ? "Real" : "Virtual"} collection`}
    >
      {demo && (
        <p className="pp-banner">
          DEMO SAMPLE — no claim of real or virtual possession.
        </p>
      )}
      {controls}
      <p>
        {mode === "real"
          ? "Physical cards you manually record."
          : "Simulated cards from saved server openings only."}{" "}
        Manifest {manifest.version}.
      </p>
      <dl className="pp-row">
        <div>
          <dt>Base</dt>
          <dd>{label("base")}</dd>
        </div>
        <div>
          <dt>Master</dt>
          <dd>{label("master")}</dd>
        </div>
        <div>
          <dt>Extended</dt>
          <dd>{label("extended")}</dd>
        </div>
      </dl>
      <details>
        <summary>Why do these goals differ?</summary>
        <p>
          Base counts each numbered card once across explicitly eligible
          variants. Master requires the exact published in-set variants.
          Extended uses its own published special-edition scope. Unvalidated or
          unknown scopes stay incomplete.
        </p>
      </details>
      <div className="pp-grid">
        <label className="pp-field" htmlFor={`${id}-search`}>
          Name or card number
          <input
            className="pp-input"
            id={`${id}-search`}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="pp-field">
          <label htmlFor={`${id}-finish`}>Finish</label>
          <select
            id={`${id}-finish`}
            className="pp-input"
            value={finish}
            onChange={(event) => {
              setFinish(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All finishes</option>
            {[...new Set(eligible.map((v) => v.finish))].sort().map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="pp-field">
          <label htmlFor={`${id}-rarity`}>Rarity</label>
          <select
            id={`${id}-rarity`}
            className="pp-input"
            value={rarity}
            onChange={(event) => {
              setRarity(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All rarities</option>
            {eligible.some((v) => !v.rarity) && (
              <option value=":unknown">Unknown rarity</option>
            )}
            {[...new Set(eligible.flatMap((v) => (v.rarity ? [v.rarity] : [])))]
              .sort()
              .map((value) => (
                <option key={value}>{value}</option>
              ))}
          </select>
        </div>
        <div className="pp-field">
          <label htmlFor={`${id}-ownership`}>Show</label>
          <select
            id={`${id}-ownership`}
            className="pp-input"
            value={ownership}
            onChange={(event) => {
              setOwnership(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All</option>
            <option value="owned">Owned</option>
            <option value="missing">Missing</option>
            <option value="duplicates">Duplicates</option>
          </select>
        </div>
        <div className="pp-field">
          <label htmlFor={`${id}-sort`}>Sort</label>
          <select
            id={`${id}-sort`}
            className="pp-input"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(0);
            }}
          >
            <option value="number">Card number</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>
      <button
        type="button"
        className="pp-button"
        data-variant="secondary"
        aria-pressed={list}
        onClick={() => setList((value) => !value)}
      >
        Compact list
      </button>
      <p role="status">
        {filtered.length} variants · Page {currentPage + 1} of {lastPage + 1}
      </p>
      {!filtered.length ? (
        <p>No variants match. Change your filters to see more.</p>
      ) : (
        <ul className={list ? "pp-binder-list" : "pp-binder-grid"}>
          {visible.map((variant) => (
            <li key={variant.id} className="pp-card">
              <span className="pp-binder-placeholder" aria-hidden="true">
                ◇
              </span>
              <h3>{variant.card_name}</h3>
              <p>
                {variant.card_number} · {variant.finish} ·{" "}
                {variant.rarity || "Rarity unknown"}
              </p>
              <p>
                {(quantities.get(variant.id) ?? 0) > 0
                  ? `Owned: ${quantities.get(variant.id)}`
                  : "Missing"}
              </p>
              {mode === "real" && onSaveReal && (
                <button
                  className="pp-button"
                  data-variant="secondary"
                  type="button"
                  disabled={savingVariant !== null}
                  onClick={() => setEditing(variant)}
                >
                  Edit {variant.card_number} {variant.finish}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav className="pp-row" aria-label="Binder pages">
        <button
          className="pp-button"
          type="button"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous page
        </button>
        <button
          className="pp-button"
          type="button"
          disabled={currentPage === lastPage}
          onClick={() => setPage(currentPage + 1)}
        >
          Next page
        </button>
      </nav>
      {onMissingExport && (
        <div className="pp-stack">
          <div className="pp-field">
            <label htmlFor={`${id}-goal`}>Missing checklist goal</label>
            <select
              className="pp-input"
              id={`${id}-goal`}
              value={goal}
              disabled={exporting}
              onChange={(event) => setGoal(event.target.value as Goal)}
            >
              <option value="base">Base</option>
              <option value="master">Master</option>
              <option value="extended">Extended</option>
            </select>
          </div>
          <button
            className="pp-button"
            type="button"
            disabled={exporting || !progress?.[goal]}
            onClick={() => void exportMissing()}
          >
            {exporting ? "Preparing checklist…" : "Export missing checklist"}
          </button>
          {!progress?.[goal] && (
            <p>
              This goal has no validated manifest scope; its checklist is
              unavailable.
            </p>
          )}
          {exportError && (
            <p role="alert" className="pp-error">
              {exportError}
            </p>
          )}
          {exportNotice && <p role="status">{exportNotice}</p>}
        </div>
      )}
      {editing && mode === "real" && onSaveReal && (
        <RealEdit
          key={editing.id}
          variant={editing}
          quantity={quantities.get(editing.id) ?? 0}
          variants={variants}
          initialNotes={realNotes?.[editing.id]}
          onClose={() => setEditing(null)}
          onSave={saveReal}
          savedFocusTarget={() => realControl.current}
        />
      )}
    </section>
  );
}

function RealEdit({
  variant,
  quantity,
  variants,
  initialNotes,
  onClose,
  onSave,
  savedFocusTarget,
}: {
  variant: Variant;
  quantity: number;
  variants: readonly Variant[];
  onClose: () => void;
  initialNotes?: string;
  onSave: NonNullable<BinderProps["onSaveReal"]>;
  savedFocusTarget: () => HTMLElement | null;
}) {
  const [count, setCount] = useState(String(quantity));
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [notesEdited, setNotesEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const savedFocus = useRef<HTMLElement | null>(null);
  const id = useId();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    let edit;
    try {
      if (!/^\d+$/.test(count)) throw new Error();
      edit = validateRealEdit(variant.id, Number(count), notes, variants);
    } catch {
      setError(
        "Enter a whole quantity from 0 to 9999 and notes up to 500 characters.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setPending(true);
    setError("");
    // PATCH adapter must preserve omitted notes; changing quantity cannot clear unloaded notes.
    const payload = {
      card_variant_id: edit.card_variant_id,
      quantity: edit.quantity,
      ...(initialNotes !== undefined || notesEdited
        ? { notes: edit.notes }
        : {}),
    };
    try {
      await onSave(payload);
      savedFocus.current = savedFocusTarget();
      onClose();
    } catch {
      setError(
        "The update could not be saved. Your draft is preserved; try again.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      title={`Edit ${variant.card_name} — ${variant.finish}`}
      onClose={onClose}
      restoreFocusTo={savedFocus}
    >
      <form onSubmit={submit} aria-busy={pending}>
        <p>
          Only your real collection will change. Quantity 0 removes this
          variant.
        </p>
        {pending && (
          <p role="status">
            Saving. Closing this dialog does not cancel a server update already
            submitted.
          </p>
        )}
        {error && (
          <p className="pp-error" ref={errorRef} tabIndex={-1} role="alert">
            {error}
          </p>
        )}
        <label className="pp-field" htmlFor={`${id}-quantity`}>
          Quantity
          <input
            className="pp-input"
            id={`${id}-quantity`}
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            disabled={pending}
          />
        </label>
        {initialNotes === undefined && (
          <p>
            Existing notes have not been loaded. Leave this field untouched to
            preserve them.
          </p>
        )}
        <label className="pp-field" htmlFor={`${id}-notes`}>
          Private notes
          <textarea
            className="pp-input"
            id={`${id}-notes`}
            maxLength={500}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesEdited(true);
            }}
            disabled={pending}
          />
        </label>
        <button className="pp-button" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save real quantity"}
        </button>
      </form>
    </Dialog>
  );
}
