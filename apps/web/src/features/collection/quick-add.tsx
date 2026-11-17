"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Dialog } from "@pokepulse/ui";
import {
  lotInputSchema,
  type SingleCard,
  type PhysicalLotInput,
} from "@pokepulse/contracts";
import { cardRequest, receipt } from "../cards/api";
export function LotForm({
  variants,
  initial,
  lotId,
  onSaved,
}: {
  variants: { id: string; label: string }[];
  initial?: PhysicalLotInput;
  lotId?: string;
  onSaved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const pending = useRef<{ body: string; key: string } | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const f = new FormData(event.currentTarget);
      const optional = (k: string) => String(f.get(k) ?? "").trim() || null;
      const currency = optional("currency");
      const scale = currency === "JPY" ? 1 : 100;
      const paid = optional("paid");
      const body = lotInputSchema.parse({
        variant_id: f.get("variant_id"),
        quantity: Number(f.get("quantity")),
        condition: f.get("condition"),
        grading_company: String(f.get("grading_company") ?? ""),
        grade: String(f.get("grade") ?? ""),
        acquired_on: optional("acquired_on"),
        cost_minor: paid === null ? null : Math.round(Number(paid) * scale),
        currency: paid === null ? null : currency,
        notes: String(f.get("notes") ?? ""),
        binder: String(f.get("binder") ?? ""),
        page: optional("page") ? Number(f.get("page")) : null,
        position: optional("position") ? Number(f.get("position")) : null,
      });
      const serialized = JSON.stringify(body);
      if (pending.current?.body !== serialized)
        pending.current = { body: serialized, key: crypto.randomUUID() };
      await cardRequest(
        lotId ? `me/collection-lots/${lotId}` : "me/collection-lots",
        receipt,
        { method: lotId ? "PATCH" : "POST", body, key: pending.current.key },
      );
      pending.current = null;
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save this copy lot.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="pp-copy-form" onSubmit={save}>
      <label>
        Card variant
        <select
          name="variant_id"
          className="pp-input"
          defaultValue={initial?.variant_id ?? variants[0]?.id}
          required
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <div className="pp-filters">
        <label>
          Quantity
          <input
            className="pp-input"
            name="quantity"
            type="number"
            min="1"
            max="9999"
            required
            defaultValue={initial?.quantity ?? 1}
          />
        </label>
        <label>
          Condition
          <select
            className="pp-input"
            name="condition"
            defaultValue={initial?.condition ?? "unknown"}
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
          Currency
          <select
            className="pp-input"
            name="currency"
            defaultValue={initial?.currency ?? "USD"}
          >
            <option>USD</option>
            <option>EUR</option>
            <option>JPY</option>
            <option>GBP</option>
          </select>
        </label>
        <label>
          Total paid for this lot
          <input
            className="pp-input"
            name="paid"
            type="number"
            min="0"
            step="0.01"
            defaultValue={
              initial?.cost_minor == null
                ? ""
                : initial.cost_minor / (initial.currency === "JPY" ? 1 : 100)
            }
          />
        </label>
        <label>
          Acquired on
          <input
            className="pp-input"
            name="acquired_on"
            type="date"
            defaultValue={initial?.acquired_on ?? ""}
          />
        </label>
        <label>
          Grading company (graded only)
          <input
            className="pp-input"
            name="grading_company"
            maxLength={40}
            defaultValue={initial?.grading_company ?? ""}
          />
        </label>
        <label>
          Grade (graded only)
          <input
            className="pp-input"
            name="grade"
            maxLength={20}
            defaultValue={initial?.grade ?? ""}
          />
        </label>
        <label>
          Binder / organization
          <input
            className="pp-input"
            name="binder"
            maxLength={100}
            defaultValue={initial?.binder ?? ""}
          />
        </label>
        <label>
          Binder page
          <input
            className="pp-input"
            name="page"
            type="number"
            min="1"
            max="1000"
            defaultValue={initial?.page ?? ""}
          />
        </label>
        <label>
          Position
          <input
            className="pp-input"
            name="position"
            type="number"
            min="1"
            max="100"
            defaultValue={initial?.position ?? ""}
          />
        </label>
      </div>
      <label>
        Private notes
        <textarea
          className="pp-input"
          name="notes"
          maxLength={500}
          defaultValue={initial?.notes ?? ""}
        />
      </label>
      <p className="pp-muted">
        Physical copies only. Leave cost or grade blank when unknown. Graded and
        raw copies are valued separately.
      </p>
      {error && (
        <p role="alert" className="pp-error">
          {error} <Link href="/dashboard">Sign in if needed</Link>
        </p>
      )}
      <button className="pp-button" disabled={busy}>
        {busy
          ? "Saving copies…"
          : lotId
            ? "Update physical copies"
            : "Save physical copies"}
      </button>
      {lotId && (
        <button
          className="pp-button"
          data-variant="danger"
          type="button"
          disabled={busy}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            try {
              const body = "delete:" + lotId;
              if (pending.current?.body !== body)
                pending.current = { body, key: crypto.randomUUID() };
              await cardRequest(`me/collection-lots/${lotId}`, receipt, {
                method: "DELETE",
                key: pending.current.key,
              });
              pending.current = null;
              onSaved();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not remove this lot.",
              );
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          Remove this physical copy lot
        </button>
      )}
    </form>
  );
}
export function QuickAdd({ card }: { card: SingleCard }) {
  const [open, setOpen] = useState(false),
    [saved, setSaved] = useState(false);
  return (
    <>
      <button
        className="pp-button"
        onClick={() => setOpen(true)}
        disabled={!card.variants.length}
      >
        Add physical copy
      </button>
      {saved && <span role="status">Physical collection updated.</span>}
      {open && (
        <Dialog
          open
          title={`Add ${card.name} to your physical collection`}
          onClose={() => setOpen(false)}
        >
          <LotForm
            variants={card.variants.map((v) => ({
              id: v.id,
              label: `${v.finish}${v.edition ? " · " + v.edition : ""} · ${v.rarity ?? "Rarity unavailable"}`,
            }))}
            onSaved={() => {
              setSaved(true);
              setOpen(false);
            }}
          />
        </Dialog>
      )}
    </>
  );
}
