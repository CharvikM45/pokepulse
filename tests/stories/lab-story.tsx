import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PackLab } from "../../apps/web/src/features/lab/pack-lab";
import type {
  LabService,
  LabState,
  OpeningSummary,
  SavedOpening,
  SimulationSet,
} from "../../apps/web/src/features/lab/pack-lab";
const setId = "10000000-0000-4000-8000-000000000001";
const sets: SimulationSet[] = [
  {
    id: setId,
    name: "Lumen Grove",
    rights_status: "approved",
    enabled: true,
    is_demo: true,
    coin_cost: 10,
    odds: {
      version: "fictional-1",
      model: "fictional",
      methodology:
        "Original two-slot test configuration; no physical pull estimates.",
      sample_size: null,
      source_url: null,
      checked_label: null,
      uncertainty: null,
      slots: [
        {
          label: "Slot 1",
          outcomes: [
            { label: "Moss Courier standard", probability: "50%" },
            { label: "Harbor Lantern standard", probability: "50%" },
          ],
        },
        {
          label: "Slot 2",
          outcomes: [
            { label: "Moss Courier standard", probability: "70%" },
            { label: "Moss Courier foil", probability: "25%" },
            { label: "Cloud Archivist foil", probability: "5%" },
          ],
        },
      ],
    },
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Metadata-only fixture",
    rights_status: "metadata_only",
    enabled: false,
    is_demo: true,
    coin_cost: null,
    odds: null,
  },
];
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/qa-test/lab/${path}`, { signal });
  if (!response.ok) throw new Error("Test service unavailable");
  return ((await response.json()) as { data: T }).data;
}
const service: LabService = {
  state: (signal) => get<LabState>("state", signal),
  history: (cursor, signal) =>
    get<{ openings: OpeningSummary[]; next_cursor: string | null }>(
      `history?cursor=${encodeURIComponent(cursor)}`,
      signal,
    ),
  opening: (id, signal) =>
    get<SavedOpening>(`opening/${encodeURIComponent(id)}`, signal),
  open: async (body, key, signal) => {
    const response = await fetch("/qa-test/lab/open", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
      signal,
    });
    const value = (await response.json()) as {
      data?: SavedOpening;
      error?: { message: string };
    };
    if (response.status >= 500)
      throw new Error("Ambiguous test server response");
    if (!response.ok)
      return {
        status: "rejected",
        message: value.error?.message ?? "Test opening rejected.",
      };
    if (!value.data) throw new Error("Missing test result");
    return { status: "committed", opening: value.data };
  },
};
function Story() {
  const [scope, setScope] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void get<{ user_id: string | null }>("test-session").then((value) =>
      setScope(value.user_id),
    );
  }, []);
  async function user(who: string) {
    const response = await fetch("/qa-test/lab/test-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who }),
    });
    setScope(
      ((await response.json()) as { data: { user_id: string | null } }).data
        .user_id,
    );
  }
  return (
    <main className="pp-main">
      <p className="pp-banner">
        DEMO DATA — original fictional Pack Lab presentation. All server
        responses are supplied by the browser test harness; no real account or
        API is connected.
      </p>
      <fieldset>
        <legend>Test fixture controls</legend>
        <div className="pp-row">
          <button
            className="pp-button"
            type="button"
            onClick={() => void user("A")}
          >
            Test account A
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => void user("B")}
          >
            Test account B
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => void user("none")}
          >
            Test sign out
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => setEnabled((value) => !value)}
          >
            {enabled ? "Disable test simulation" : "Enable test simulation"}
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => setEmpty((value) => !value)}
          >
            {empty ? "Restore test catalog" : "Show empty test catalog"}
          </button>
        </div>
      </fieldset>
      <p role="status">{notice}</p>
      <PackLab
        enabled={enabled}
        sets={empty ? [] : sets}
        userScope={scope}
        service={service}
        onSignIn={() => setNotice("Sign-in requested; no opening submitted.")}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Story />);
