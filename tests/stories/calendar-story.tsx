import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ReleaseCalendar } from "../../apps/web/src/features/calendar/release-calendar";
import type { CalendarRelease } from "../../apps/web/src/features/calendar/release-calendar";
const common = {
  product_id: null,
  region: "US",
  source_url: "https://calendar.example.test/fictional-fixture",
  verified_at: "2026-11-06T18:00:00Z",
  is_demo: true,
};
const entries: CalendarRelease[] = [
  {
    ...common,
    id: "70000000-0000-4000-8000-000000000001",
    name: "Fictional day release",
    date: "2027-02-06",
    date_precision: "day",
    event_type: "release",
    product_id: "80000000-0000-4000-8000-000000000001",
  },
  {
    ...common,
    id: "70000000-0000-4000-8000-000000000002",
    name: "Fictional month preorder",
    date: "2027-02-01",
    date_precision: "month",
    event_type: "preorder",
  },
  {
    ...common,
    id: "70000000-0000-4000-8000-000000000003",
    name: "Fictional unknown announcement",
    date: null,
    date_precision: "unconfirmed",
    event_type: "announcement",
    region: "JP",
    source_url: "javascript:alert(1)",
  },
];
function Story() {
  const [state, setState] = useState<"ready" | "empty" | "loading" | "error">(
    "ready",
  );
  const [filters, setFilters] = useState({
    region: "",
    event_type: "",
    set_name: "",
  });
  return (
    <main className="pp-main">
      <p className="pp-banner">
        DEMO DATA — original fictional calendar test cases, not actual releases.
      </p>
      <div className="pp-row">
        {(["ready", "empty", "loading", "error"] as const).map((value) => (
          <button
            className="pp-button"
            key={value}
            type="button"
            onClick={() => setState(value)}
          >
            Show {value}
          </button>
        ))}
      </div>
      <ReleaseCalendar
        entries={state === "empty" ? [] : entries}
        productSetNames={{
          "80000000-0000-4000-8000-000000000001": "Lumen Grove",
        }}
        initialMonth="2027-02"
        formatVerifiedAt={(value) =>
          `${new Date(value).toISOString()} (UTC test formatter)`
        }
        filters={filters}
        onFiltersChange={setFilters}
        loading={state === "loading"}
        error={state === "error" ? "Test-only service failure" : undefined}
        onRetry={() => setState("ready")}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Story />);
