"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import Link from "next/link";
import {
  portfolioSchema,
  lotInputSchema,
  lotSchema,
} from "@pokepulse/contracts";
import { Dialog, Skeleton, StateCard } from "@pokepulse/ui";
import { useResource } from "../consumer/workspace";
import { cardRequest, receipt, queryString } from "../cards/api";
import { PriceChart, currencyValue } from "./price-chart";
import { LotForm } from "./quick-add";
import { parseCopyCsv } from "../../../../../packages/domain/src/cards/csv";
export function PortfolioDashboard() {
  const [currency, setCurrency] = useState("USD"),
    [text, setText] = useState(""),
    [preview, setPreview] = useState<
      | (import("@pokepulse/contracts").PhysicalLotInput & { id?: string })[]
      | null
    >(null),
    [importMode, setImportMode] = useState("add"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<
      import("zod").z.infer<typeof lotSchema> | null
    >(null);
  const pending = useRef<{ body: string; key: string } | null>(null);
  const resource = useResource(
    (signal) =>
      cardRequest(
        `me/portfolio?${queryString({ currency })}`,
        portfolioSchema,
        { signal },
      ),
    currency,
  );
  async function write(path: string, body: unknown) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    const serialized = JSON.stringify([path, body]);
    if (pending.current?.body !== serialized)
      pending.current = { body: serialized, key: crypto.randomUUID() };
    try {
      await cardRequest(path, receipt, {
        method: "POST",
        body,
        key: pending.current.key,
      });
      pending.current = null;
      setNotice("Saved.");
      setPreview(null);
      resource.retry();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const data = resource.data?.data;
  return (
    <>
      <header className="pp-dex-hero">
        <p className="pp-eyebrow">YOUR PHYSICAL COLLECTION</p>
        <h1>The collection you’re building.</h1>
        <p>
          Your copies, your history, and the references behind every estimate.
        </p>
        <div className="pp-row">
          <Link href="/cards">Add cards from Pokédex →</Link>
        </div>
      </header>
      <label>
        Valuation currency
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
      {resource.loading ? (
        <Skeleton label="Calculating physical collection metrics" />
      ) : resource.error ? (
        <StateCard
          error
          title="Sign in to see your portfolio"
          retry={resource.retry}
        >
          {resource.error}
          <p>
            <Link href="/dashboard">Sign in to your workspace</Link>
          </p>
        </StateCard>
      ) : (
        data && (
          <>
            <div className="pp-portfolio-metrics">
              <article className="pp-card">
                <span>Physical copies</span>
                <strong>{data.copies}</strong>
                <small>
                  {data.unique_printings} printings · {data.unique_variants}{" "}
                  variants
                </small>
              </article>
              <article className="pp-card">
                <span>Observed reference value</span>
                <strong>{currencyValue(data.value_minor, currency)}</strong>
                <small>
                  {data.valued_copies} valued · {data.unpriced_copies} unpriced
                  copies
                </small>
              </article>
              <article className="pp-card">
                <span>Recorded acquisition costs</span>
                <strong>{currencyValue(data.cost_minor, currency)}</strong>
                <small>
                  {data.cost_coverage_copies} copies have cost records in{" "}
                  {currency}
                </small>
              </article>
              <article className="pp-card">
                <span>Estimated change on comparable lots</span>
                <strong>{currencyValue(data.gain_minor, currency)}</strong>
                <small>
                  Compared cost:{" "}
                  {currencyValue(data.comparable_cost_minor, currency)}
                </small>
              </article>
            </div>
            <p className="pp-banner">
              Physical inventory only. Virtual cards are excluded. Exact
              variant, condition, grade, metric, and currency must match; no
              currency conversion is assumed. {data.untracked_copies} copies
              have no detailed lot record. {data.stale_copies} copies have only
              stale references.
            </p>
            <details className="pp-card">
              <summary>Reference sources behind this estimate</summary>
              <p>
                Up to 50 recent matching references; unpriced copies are
                excluded.
              </p>
              <ul>
                {data.references.map((r, i) => (
                  <li key={r.variant_id + r.observed_at + i}>
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {r.provider_id}
                    </a>{" "}
                    · {currencyValue(r.amount_minor, r.currency)} ·{" "}
                    {r.condition.replaceAll("_", " ")} · {r.grade || "raw"} ·{" "}
                    {new Date(r.observed_at).toLocaleString()}
                  </li>
                ))}
              </ul>
            </details>
            <section className="pp-card pp-stack">
              <h2>Observed portfolio history</h2>
              <PriceChart
                points={data.history.map((p) => ({
                  time: p.captured_at,
                  value: p.value_minor,
                }))}
                currency={currency}
                label="Observed physical collection snapshots"
              />
              <p>
                Snapshots reflect holdings and price coverage at capture time.
                Adding copies changes totals; this chart is not a return index.
              </p>
              <button
                className="pp-button"
                disabled={busy}
                onClick={() =>
                  void write("me/portfolio/snapshots", {
                    currency,
                    statistic: "market",
                  })
                }
              >
                Capture current observation
              </button>
            </section>
            <div className="pp-grid">
              <section className="pp-card">
                <h2>Your top sets</h2>
                {data.sets.length ? (
                  <ul>
                    {data.sets.map((s) => (
                      <li key={s.id}>
                        <Link href={`/collection?set_id=${s.id}`}>
                          {s.name}
                        </Link>{" "}
                        · {s.copies} copies · {s.variants} variants
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No physical cards recorded yet.</p>
                )}
              </section>
              <section className="pp-card">
                <h2>Most valuable priced holdings</h2>
                {data.top_cards.length ? (
                  <ul>
                    {data.top_cards.map((c, i) => (
                      <li key={c.name + i}>
                        {c.name} · {c.quantity} copies ·{" "}
                        {currencyValue(c.value_minor, currency)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No current comparable price references.</p>
                )}
              </section>
            </div>
            <section className="pp-card">
              <h2>What makes up your collection</h2>
              <p>
                Shares count copies with recorded metadata. Multiple illustrator
                or species credits may overlap.
              </p>
              <div className="pp-grid">
                {Object.entries(data.breakdowns).map(([key, groups]) => (
                  <div key={key}>
                    <h3>{key === "pokemon" ? "Pokédex numbers" : key}</h3>
                    <ul>
                      {groups.map((g) => (
                        <li key={g.label}>
                          {g.label.replaceAll("_", " ")}: {g.copies} copies
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
            <section className="pp-card">
              <h2>Favorites & wishlist</h2>
              {data.actions.length ? (
                <ul>
                  {data.actions.map((a) => (
                    <li key={a.card_id + a.kind}>
                      <Link href={`/cards/${a.card_id}`}>{a.name}</Link> ·{" "}
                      {a.kind}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Save favorites and wishlist cards from the Pokédex.</p>
              )}
            </section>
            <section className="pp-card">
              <h2>Recent physical copy lots</h2>
              <p>
                Most recent 50 acquisition lots. Legacy binder edits remain
                supported; reducing a total reconciles its most recent lot
                details.
              </p>
              {data.lots.length ? (
                <div className="pp-stack">
                  {data.lots.map((l) => (
                    <article className="pp-copy-lot" key={l.id}>
                      <strong>
                        {l.card_name ?? "Recorded printing"} · {l.quantity}{" "}
                        copies · {l.condition.replaceAll("_", " ")}
                      </strong>
                      <p>
                        {l.grading_company
                          ? `${l.grading_company} ${l.grade}`
                          : "Raw / ungraded"}{" "}
                        · {l.acquired_on ?? "Acquisition date unknown"} ·{" "}
                        {currencyValue(l.cost_minor, l.currency ?? currency)}
                      </p>
                      <p>
                        {l.binder
                          ? `Binder: ${l.binder} · Page ${l.page ?? "—"}, position ${l.position ?? "—"}`
                          : "No binder arrangement"}
                      </p>
                      <p className="pp-muted">{l.notes}</p>
                      <button
                        className="pp-button"
                        data-variant="secondary"
                        onClick={() => setEditing(l)}
                      >
                        Edit copy lot
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p>Add your first physical copy from a card’s detail page.</p>
              )}
            </section>
            <section className="pp-card pp-stack">
              <h2>Import & export physical copy details</h2>
              <a
                className="pp-button"
                href="/api/v1/me/collection-export"
                download
              >
                Download copy-lot CSV
              </a>
              <p>
                CSV columns (include id for bulk updates): variant_id, quantity,
                condition, grading_company, grade, acquired_on, cost_minor,
                currency, notes, binder, page, position. Costs are totals in
                currency minor units. Repeated variants are allowed for distinct
                acquisition lots; review duplicates before saving.
              </p>
              <label>
                Import action
                <select
                  className="pp-input"
                  value={importMode}
                  onChange={(e) => {
                    setImportMode(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="add">Add reviewed acquisition lots</option>
                  <option value="update">Update existing lots by ID</option>
                </select>
              </label>
              <label>
                Paste copy-lot CSV
                <textarea
                  className="pp-input"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setPreview(null);
                  }}
                  maxLength={32000}
                  rows={5}
                />
              </label>
              <button
                className="pp-button"
                data-variant="secondary"
                onClick={() => {
                  try {
                    const rows = parseCopyCsv(text).map((row) =>
                      importMode === "update"
                        ? lotInputSchema.safeExtend({ id: z.uuid() }).parse(row)
                        : lotInputSchema.parse(row),
                    );
                    setPreview(rows);
                    setNotice("");
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : "Invalid CSV.");
                  }
                }}
              >
                Review import
              </button>
              {preview && (
                <>
                  <h3>
                    {preview.length} lots ·{" "}
                    {preview.reduce((n, l) => n + l.quantity, 0)} physical
                    copies
                  </h3>
                  <ul>
                    {preview.map((l, i) => (
                      <li key={i}>
                        {l.variant_id} · {l.quantity} · {l.condition}
                      </li>
                    ))}
                  </ul>
                  <button
                    className="pp-button"
                    disabled={busy || !preview.length}
                    onClick={() =>
                      void write("me/collection-import", {
                        mode: importMode,
                        lots: preview,
                      })
                    }
                  >
                    Confirm reviewed import
                  </button>
                </>
              )}
            </section>
          </>
        )
      )}
      {notice && (
        <p role="status" className="pp-banner">
          {notice}
        </p>
      )}
      {editing && (
        <Dialog
          open
          title="Edit physical copy lot"
          onClose={() => setEditing(null)}
        >
          <LotForm
            lotId={editing.id}
            initial={editing}
            variants={[
              { id: editing.variant_id, label: "Existing printing / finish" },
            ]}
            onSaved={() => {
              setEditing(null);
              resource.retry();
            }}
          />
        </Dialog>
      )}
    </>
  );
}
