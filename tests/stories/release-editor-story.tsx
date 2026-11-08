import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ReleaseEditor } from "../../apps/web/src/features/calendar/release-editor";
import type {
  EditableRelease,
  ReleaseEditDraft,
} from "../../apps/web/src/features/calendar/release-editor";
const attempts: { draft: ReleaseEditDraft; key: string }[] = [];
const receipts = new Map<string, { body: string; result: EditableRelease }>();
let loseFirst = true;
function Story() {
  const [staff, setStaff] = useState(false);
  const [approved, setApproved] = useState(true);
  const [saved, setSaved] = useState<EditableRelease | null>(null);
  const [, refresh] = useState(0);
  return (
    <main className="pp-main">
      <p className="pp-banner">
        DEMO DATA — original fictional editor fields and test callbacks. No
        announcement is published externally.
      </p>
      <fieldset>
        <legend>Test fixture controls</legend>
        <div className="pp-row">
          <button
            className="pp-button"
            type="button"
            onClick={() => setStaff((value) => !value)}
          >
            {staff ? "Revoke test editor" : "Grant test editor"}
          </button>
          <button
            className="pp-button"
            type="button"
            onClick={() => setApproved((value) => !value)}
          >
            {approved ? "Disable test source" : "Approve test source"}
          </button>
        </div>
      </fieldset>
      <ReleaseEditor
        authorized={staff}
        demo
        approvedSourceHosts={approved ? ["calendar.example.test"] : []}
        products={[]}
        save={async (draft, key) => {
          attempts.push({ draft, key });
          refresh((value) => value + 1);
          const body = JSON.stringify(draft),
            prior = receipts.get(key);
          if (prior) {
            if (prior.body !== body) throw new Error("CONFLICT");
            return prior.result;
          }
          const result: EditableRelease = {
            ...draft.entry,
            id: draft.release_id ?? "70000000-0000-4000-8000-000000000001",
            revision: draft.expected_revision + 1,
          };
          receipts.set(key, { body, result });
          if (loseFirst) {
            loseFirst = false;
            throw new Error("Test response lost after commit");
          }
          return result;
        }}
        onSaved={setSaved}
      />
      <output id="editor-attempts" style={{ overflowWrap: "anywhere" }}>
        {JSON.stringify(attempts)}
      </output>
      <output id="editor-saved" style={{ overflowWrap: "anywhere" }}>
        {JSON.stringify(saved)}
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Story />);
