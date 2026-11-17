import { Suspense } from "react";
import { PortfolioDashboard } from "../../../../src/features/collection/portfolio-dashboard";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading archive…</p>}>
      <PortfolioDashboard />
    </Suspense>
  );
}
