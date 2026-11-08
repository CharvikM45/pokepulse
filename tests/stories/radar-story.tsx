import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalRadar } from "../../apps/web/src/features/radar/local-radar";
import type {
  RadarService,
  RadarStore,
  RadarSighting,
} from "../../apps/web/src/features/radar/local-radar";
import { ModerationQueue } from "../../apps/web/src/features/radar/moderation-queue";
import type {
  ReviewReport,
  ReviewService,
  ReviewDraft,
} from "../../apps/web/src/features/radar/moderation-queue";
const now = Date.now();
const storeId = "30000000-0000-4000-8000-000000000001";
const store: RadarStore = {
  id: storeId,
  name: "Example Hobby Store",
  address: null,
  region: "Demo region",
  distance_mi: 1.2,
  latitude: null,
  longitude: null,
  directory_source: "Original fictional fixture",
  is_demo: true,
};
const store2: RadarStore = {
  ...store,
  id: "30000000-0000-4000-8000-000000000002",
  name: "Example Binder Shop",
  distance_mi: null,
};
let notify: () => void = () => {};
const metrics = {
  storeCalls: 0,
  slowDone: false,
  reportCalls: 0,
  queueCalls: 0,
  queueDone: 0,
  reviews: [] as { draft: ReviewDraft; key: string }[],
};
let failReports = false,
  failQueue = false,
  queueDelay = false;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const radar: RadarService = {
  stores: async (query) => {
    metrics.storeCalls++;
    notify();
    if (query.zip === "11111") {
      await delay(200);
      metrics.slowDone = true;
      notify();
      return {
        stores: [{ ...store, name: "Slow stale store" }],
        next_cursor: null,
      };
    }
    if (query.zip === "22222") {
      await delay(10);
      return {
        stores: [{ ...store, name: "Fast current store" }],
        next_cursor: null,
      };
    }
    if (query.zip === "00000") throw new Error("Test directory failure");
    return {
      stores: query.cursor ? [store, store2] : [store],
      next_cursor: query.cursor ? null : "second-demo-page",
    };
  },
  sightings: async () => {
    metrics.reportCalls++;
    notify();
    if (failReports) {
      failReports = false;
      throw new Error("Test report service unavailable");
    }
    const common = {
      store_id: storeId,
      product_id: null,
      observed_at: new Date(Date.now() - 60000).toISOString(),
      moderation: "approved" as const,
      expires_at: new Date(Date.now() + 600000).toISOString(),
      independent_confirmations: 1,
      conflict_count: metrics.reportCalls === 1 ? 1 : 0,
      public_notes: null,
      is_demo: true,
    };
    const shelf: RadarSighting = {
      ...common,
      id: "50000000-0000-4000-8000-000000000002",
      report_type: "shelf_empty",
    };
    if (metrics.reportCalls > 1) return [shelf];
    return [
      {
        ...common,
        id: "50000000-0000-4000-8000-000000000001",
        report_type: "found_stock",
        expires_at: new Date(Date.now() + 2000).toISOString(),
        public_notes: "Reviewed public note",
        reporter_id: "PRIVATE_AUTHOR_MUST_NOT_APPEAR",
      },
      shelf,
      {
        ...common,
        id: "50000000-0000-4000-8000-000000000003",
        report_type: "found_stock",
        moderation: "pending",
        public_notes: "PENDING_NOTE_MUST_NOT_APPEAR",
      },
      {
        ...common,
        id: "50000000-0000-4000-8000-000000000004",
        report_type: "found_stock",
        expires_at: new Date(Date.now() - 1).toISOString(),
        public_notes: "EXPIRED_NOTE_MUST_NOT_APPEAR",
      },
    ] as RadarSighting[];
  },
};
const reviews: ReviewReport[] = [
  {
    id: "50000000-0000-4000-8000-000000000011",
    store_name: "Reviewable demo store",
    product_name: null,
    report_type: "found_stock",
    moderation: "pending",
    observed_at: new Date(now - 60000).toISOString(),
    expires_at: new Date(now + 3600000).toISOString(),
    private_notes: "PRIVATE_STAFF_NOTE <script>untrusted text</script>",
    public_notes: null,
    is_demo: true,
    submitted_by_current_staff: false,
    revision: 0,
  },
  {
    id: "50000000-0000-4000-8000-000000000012",
    store_name: "Own demo report",
    product_name: null,
    report_type: "shelf_empty",
    moderation: "pending",
    observed_at: new Date(now - 60000).toISOString(),
    expires_at: new Date(now + 3600000).toISOString(),
    private_notes: "Another staff member must review this.",
    public_notes: null,
    is_demo: true,
    submitted_by_current_staff: true,
    revision: 0,
  },
];
const receipts = new Map<
  string,
  {
    body: string;
    receipt: {
      id: string;
      moderation: "approved" | "rejected";
      revision: number;
    };
  }
>();
let loseFirstReview = true;
const queue: ReviewService = {
  load: async (query) => {
    metrics.queueCalls++;
    notify();
    if (failQueue) {
      failQueue = false;
      throw new Error("Test private queue failure");
    }
    if (queueDelay) {
      await delay(200);
      queueDelay = false;
    }
    metrics.queueDone++;
    notify();
    return {
      reports: reviews
        .filter((r) => r.moderation === query.state)
        .map((row) => ({ ...row })),
      next_cursor: null,
    };
  },
  moderate: async (draft, key) => {
    metrics.reviews.push({ draft, key });
    notify();
    const body = JSON.stringify(draft),
      prior = receipts.get(key);
    if (prior) {
      if (prior.body !== body) throw new Error("CONFLICT");
      return prior.receipt;
    }
    const row = reviews.find((r) => r.id === draft.sighting_id);
    if (!row || row.submitted_by_current_staff) throw new Error("FORBIDDEN");
    if (row.revision !== draft.expected_revision) throw new Error("CONFLICT");
    row.moderation = draft.decision;
    row.public_notes = draft.public_notes;
    row.revision++;
    const receipt = {
      id: row.id,
      moderation: draft.decision,
      revision: row.revision,
    };
    receipts.set(key, { body, receipt });
    if (loseFirstReview) {
      loseFirstReview = false;
      throw new Error("Test lost response after commit");
    }
    return receipt;
  },
};
function Story() {
  const [, refresh] = useState(0);
  useEffect(() => {
    notify = () => refresh((value) => value + 1);
    return () => {
      notify = () => {};
    };
  }, []);
  const [view, setView] = useState<"radar" | "queue">("radar");
  const [staff, setStaff] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [action, setAction] = useState("");
  return (
    <main className="pp-main">
      <p className="pp-banner">
        DEMO DATA — fictional presentation fixtures and service test doubles; no
        live directory, login or moderation API.
      </p>
      <fieldset>
        <legend>Test fixture controls</legend>
        <div className="pp-row">
          <button
            className="pp-button"
            type="button"
            onClick={() => setView("radar")}
          >
            Show Radar story
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => setView("queue")}
          >
            Show queue story
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => setStaff((value) => !value)}
          >
            {staff ? "Revoke test staff" : "Grant test staff"}
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => setSignedIn((value) => !value)}
          >
            {signedIn ? "Sign out test user" : "Sign in test user"}
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => {
              failReports = true;
            }}
          >
            Fail next report read
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => {
              queueDelay = true;
            }}
          >
            Delay next queue read
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => {
              failQueue = true;
            }}
          >
            Fail next queue read
          </button>
        </div>
      </fieldset>
      <p role="status">{action}</p>
      {view === "radar" ? (
        <LocalRadar
          service={radar}
          authenticated={signedIn}
          onSignIn={() => setAction("Sign-in requested; no report saved.")}
          onReportStore={(value) =>
            setAction(`Report form requested for ${value.name}`)
          }
          formatTimestamp={(value) => new Date(value).toISOString()}
        />
      ) : (
        <ModerationQueue
          authorized={staff}
          service={queue}
          formatTimestamp={(value) => new Date(value).toISOString()}
        />
      )}
      <output id="metrics" style={{ overflowWrap: "anywhere" }}>
        {JSON.stringify(metrics)}
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Story />);
