import { Workspace } from "../../src/features/consumer/workspace";
import type { ReactNode } from "react";
export default function Layout({ children }: { children: ReactNode }) {
  return <Workspace>{children}</Workspace>;
}
