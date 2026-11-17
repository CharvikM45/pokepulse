import { Suspense } from "react";
import { CatalogIndex } from "../../../src/features/cards/catalog-index";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading archive…</p>}>
      <CatalogIndex kind="artists" />
    </Suspense>
  );
}
