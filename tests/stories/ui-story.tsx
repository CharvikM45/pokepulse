import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppShell,
  Button,
  Dialog,
  Field,
  Input,
  Pagination,
  SearchCombobox,
  Skeleton,
  StateCard,
  StatusBadge,
  Tabs,
  ToastRegion,
} from "../../packages/ui/src/index";

function Story() {
  const [tab, setTab] = useState("real");
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  return (
    <AppShell
      pathname="/collection"
      sourceNotice="DEMO DATA — React primitive story; no backend connected."
    >
      <h1>Component stories</h1>
      <StatusBadge tone="warning">Demo sample</StatusBadge>
      <SearchCombobox
        label="Choose a finish"
        value={selected}
        onChange={setSelected}
        options={[
          { value: "standard", label: "Standard" },
          { value: "foil", label: "Foil" },
          { value: "etched", label: "Etched" },
        ]}
      />
      <p id="selected">Selected: {selected ?? "none"}</p>
      <Tabs
        label="Collection mode"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "real", label: "Real", content: <p>Real panel content</p> },
          {
            id: "virtual",
            label: "Virtual",
            content: <p>Virtual panel content</p>,
          },
        ]}
      />
      <Button onClick={() => setOpen(true)}>Edit quantity</Button>
      <Dialog
        title="Edit real quantity"
        open={open}
        onClose={() => setOpen(false)}
      >
        <Field
          id="quantity"
          label="Quantity"
          hint="Whole number only"
          error="Enter a whole number."
        >
          {(props) => <Input {...props} type="number" defaultValue="1.5" />}
        </Field>
        <Button
          onClick={() => {
            setOpen(false);
            setToast("Example update acknowledged; no backend write.");
          }}
        >
          Preview save
        </Button>
      </Dialog>
      <StateCard title="No current reports">
        No approved, unexpired community reports.
      </StateCard>
      <Skeleton label="Loading sample placeholder" />
      <Pagination next="?cursor=example" summary="Page 1" />
      <ToastRegion message={toast} dismiss={() => setToast(null)} />
    </AppShell>
  );
}
createRoot(document.getElementById("root")!).render(<Story />);
