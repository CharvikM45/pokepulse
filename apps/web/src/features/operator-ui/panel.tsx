"use client";
import { useCallback, useEffect, useState } from "react";
type Source = { id: string; status: string; enabled: boolean };
export function OperatorPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [metrics, setMetrics] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState("Loading source health…");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/admin/sources");
      if (!r.ok) throw new Error();
      const b = await r.json();
      setSources(b.data.source_permissions);
      setMetrics(b.data);
      setMessage(
        "Source controls are audited. Approval requires a separate reviewed rights decision.",
      );
    } catch {
      setMessage("Source health unavailable or access denied.");
    }
  }, []);
  useEffect(() => {
    const task = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(task);
  }, [load]);
  async function pause(id: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/v1/admin/sources", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ id, enabled: false, status: "suspended" }),
      });
      if (!r.ok) throw new Error();
      await load();
    } catch {
      setMessage("Source change failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-3xl">Source operations</h1>
      <p role="status">{message}</p>
      <ul>
        {sources.map((s) => (
          <li key={s.id} className="my-4 flex flex-wrap gap-4">
            <span>
              {s.id}: {s.status} / {s.enabled ? "enabled" : "paused"}
            </span>
            <button
              disabled={busy}
              className="rounded border px-3 py-1"
              onClick={() => void pause(s.id)}
            >
              Suspend {s.id}
            </button>
          </li>
        ))}
      </ul>
      <details>
        <summary>Health, quotas, mapping review and queue metrics</summary>
        <pre className="overflow-auto text-sm">
          {JSON.stringify(metrics, null, 2)}
        </pre>
      </details>
    </main>
  );
}
