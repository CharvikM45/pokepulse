import { Suspense } from "react";
import { CardExplorer } from "../../../src/features/cards/card-explorer";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading archive…</p>}>
      <CardExplorer market />
    </Suspense>
  );
}
