import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CommittedReveal } from "../../apps/web/src/features/lab/committed-reveal";
import { Binder } from "../../apps/web/src/features/binder/binder";
import { ReportForm } from "../../apps/web/src/features/radar/report-form";
import { ids, variants, manifest } from "../../packages/fixtures/src/b-domain";
import type {
  InventoryEntry,
  Mode,
} from "../../packages/domain/src/collections/policies";
function Story() {
  const [mode, setMode] = useState<Mode>("real");
  const [real, setReal] = useState<InventoryEntry[]>([]);
  const [saved, setSaved] = useState("none");
  const [attempts, setAttempts] = useState<string[]>([]);
  const failFirst = useRef(true);
  return (
    <main className="pp-main">
      <h1>Feature presentation stories</h1>
      <p className="pp-banner">
        DEMO DATA — callbacks are isolated test doubles. No backend or account
        is connected.
      </p>
      <CommittedReveal
        openingId="test-committed-opening"
        openedAtLabel="Example saved time"
        oddsVersion="fictional-1"
        spentCoins={10}
        usedFreeOpen={false}
        cards={[
          {
            card_variant_id: ids.moss,
            slot_index: 0,
            name: "Moss Courier",
            number: "001",
            finish: "standard",
          },
          {
            card_variant_id: ids.mossFoil,
            slot_index: 1,
            name: "Moss Courier",
            number: "001",
            finish: "foil",
          },
        ]}
      />
      <h2>Collection test double</h2>
      <Binder
        demo
        manifest={manifest}
        variants={variants}
        mode={mode}
        entriesMode={mode}
        entriesComplete
        entries={
          mode === "real" ? real : [{ variant_id: ids.cloud, quantity: 1 }]
        }
        onModeChange={setMode}
        onSaveReal={async (edit) => {
          if (edit.quantity === 99) throw new Error("Example failure");
          setSaved(JSON.stringify(edit));
          setReal((entries) => [
            ...entries.filter((e) => e.variant_id !== edit.card_variant_id),
            { variant_id: edit.card_variant_id, quantity: edit.quantity },
          ]);
        }}
      />
      <output id="saved-real">{saved}</output>
      <h2>Report submission test double</h2>
      <ReportForm
        authenticated
        storeId={ids.store}
        onSignIn={() => {}}
        onSubmit={async (draft, key) => {
          setAttempts((list) => [...list, JSON.stringify({ draft, key })]);
          if (failFirst.current) {
            failFirst.current = false;
            throw new Error("Example lost response");
          }
        }}
      />
      <output id="report-attempts">{JSON.stringify(attempts)}</output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Story />);
