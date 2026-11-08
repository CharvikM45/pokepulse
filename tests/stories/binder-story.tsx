import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Binder } from "../../apps/web/src/features/binder/binder";
import type { BinderProps } from "../../apps/web/src/features/binder/binder";
import type {
  InventoryEntry,
  Manifest,
  Mode,
  Variant,
} from "../../packages/domain/src/collections/policies";
const set = "10000000-0000-4000-8000-000000000099";
const variants: Variant[] = Array.from({ length: 1000 }, (_, index) => ({
  id: `20000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
  set_id: set,
  card_number: String(index + 1).padStart(4, "0"),
  card_name: `Original Card ${String(index + 1).padStart(4, "0")}`,
  finish: index % 2 ? "foil" : "standard",
  rarity: index % 5 ? "Everyday" : "Special",
  eligible_for_packs: true,
}));
const manifest: Manifest = {
  set_id: set,
  version: "original-large-1",
  validated: true,
  supported_goals: ["base", "master"],
  requirements: variants.flatMap((variant) => [
    {
      variant_id: variant.id,
      collectible_key: variant.card_number,
      scope: "base" as const,
      rationale: "Original fictional numbered card.",
    },
    {
      variant_id: variant.id,
      collectible_key: variant.id,
      scope: "master" as const,
      rationale: "Original explicitly eligible variant.",
    },
  ]),
};
const real: InventoryEntry[] = [
    { variant_id: variants[0].id, quantity: 3 },
    { variant_id: variants[1].id, quantity: 1 },
  ],
  virtual: InventoryEntry[] = [{ variant_id: variants[2].id, quantity: 1 }];
function Story() {
  const [mode, setMode] = useState<Mode>("real");
  const [snapshot, setSnapshot] = useState<{
    mode: Mode;
    entries: InventoryEntry[];
  }>({ mode: "real", entries: real });
  const [complete, setComplete] = useState(true);
  const [error, setError] = useState(false);
  const [exports, setExports] = useState<
    Parameters<NonNullable<BinderProps["onMissingExport"]>>[0][]
  >([]);
  const failFirst = useRef(true);
  const generation = useRef(0);
  function switchMode(next: Mode) {
    setMode(next);
    const current = ++generation.current;
    setTimeout(() => {
      if (generation.current === current)
        setSnapshot({ mode: next, entries: next === "real" ? real : virtual });
    }, 200);
  }
  return (
    <main className="pp-main">
      <h1>Original fictional binder fixture</h1>
      <p className="pp-banner">
        DEMO DATA — one thousand original test variants, not a real set or claim
        of possession. Export callbacks are test doubles.
      </p>
      <fieldset>
        <legend>Test fixture controls</legend>
        <div className="pp-row">
          <button
            className="pp-button"
            type="button"
            onClick={() => setComplete((value) => !value)}
          >
            {complete ? "Show partial snapshot" : "Complete snapshot"}
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => setError((value) => !value)}
          >
            {error ? "Restore collection read" : "Fail collection read"}
          </button>
        </div>
      </fieldset>
      <Binder
        demo
        manifest={manifest}
        variants={variants}
        mode={mode}
        entriesMode={snapshot.mode}
        entriesComplete={complete}
        entries={snapshot.entries}
        onModeChange={switchMode}
        loadError={error ? "Test-only collection service failure" : undefined}
        onRetryInventory={() => setError(false)}
        onMissingExport={async (request) => {
          setExports((old) => [...old, request]);
          if (failFirst.current) {
            failFirst.current = false;
            throw new Error("Test export failure");
          }
        }}
      />
      <output id="export-requests" style={{ overflowWrap: "anywhere" }}>
        {JSON.stringify(exports)}
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Story />);
