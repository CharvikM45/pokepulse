import { Suspense } from "react";
import { Discovery } from "../../../src/features/consumer/discovery";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading catalog…</p>}>
      <Discovery mode="drops" />
    </Suspense>
  );
}
