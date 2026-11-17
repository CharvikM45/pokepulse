"use client";
import { z } from "zod";
import { StateCard, Skeleton } from "@pokepulse/ui";
import { coverageSchema } from "@pokepulse/contracts";
import { useResource } from "../consumer/workspace";
import { cardRequest } from "./api";
const schema = z.object({
  providers: z.array(z.record(z.string(), z.unknown())),
  runs: z.array(z.record(z.string(), z.unknown())),
  coverage: coverageSchema,
});
export function CatalogAdmin() {
  const r = useResource(
    (signal) => cardRequest("admin/card-catalog", schema, { signal }),
    "catalog-admin",
  );
  return (
    <>
      <h1>Card catalog operations</h1>
      <p>
        Provider approval, measured coverage, and resumable ingestion status.
        Credentials are never displayed.
      </p>
      {r.loading ? (
        <Skeleton label="Loading catalog operations" />
      ) : r.error ? (
        <StateCard error title="Staff access required" retry={r.retry}>
          {r.error}
        </StateCard>
      ) : (
        r.data && (
          <>
            <p>
              {r.data.data.coverage.printings} indexed printings ·{" "}
              {r.data.data.coverage.sets} sets · {r.data.data.coverage.variants}{" "}
              variants
            </p>
            <h2>Provider permissions</h2>
            <div className="pp-grid">
              {r.data.data.providers.map((p) => (
                <article className="pp-card" key={String(p.id)}>
                  <h3>{String(p.id)}</h3>
                  <dl>
                    {[
                      "enabled",
                      "metadata_approved",
                      "artwork_approved",
                      "pricing_approved",
                      "retention_approved",
                      "reviewer",
                      "checked_at",
                    ].map((k) => (
                      <div key={k}>
                        <dt>{k.replaceAll("_", " ")}</dt>
                        <dd>{String(p[k] ?? "Not recorded")}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
            <h2>Latest sync runs</h2>
            {r.data.data.runs.length ? (
              r.data.data.runs.map((run) => (
                <article className="pp-card" key={String(run.id)}>
                  <h3>
                    {String(run.provider_id)} / {String(run.language)}
                  </h3>
                  <p>
                    {String(run.status)} · {String(run.added)} added ·{" "}
                    {String(run.updated)} updated · {String(run.skipped)}{" "}
                    skipped
                  </p>
                  <p>
                    Started {String(run.started_at)} · Finished{" "}
                    {String(run.finished_at ?? "In progress")}
                  </p>
                  <details>
                    <summary>Checkpoint and data quality</summary>
                    <pre className="pp-metadata">
                      {JSON.stringify(
                        { checkpoint: run.checkpoint, errors: run.errors },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </article>
              ))
            ) : (
              <p>
                No synchronization has run. Approved worker jobs resume from a
                durable checkpoint.
              </p>
            )}
          </>
        )
      )}
    </>
  );
}
