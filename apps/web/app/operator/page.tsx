import { requireStaff } from "../../src/server";
import { OperatorPanel } from "../../src/features/operator-ui/panel";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    await requireStaff();
  } catch {
    return (
      <main className="p-8">
        <h1>Operator access restricted</h1>
        <p>A verified staff account is required.</p>
      </main>
    );
  }
  return <OperatorPanel />;
}
