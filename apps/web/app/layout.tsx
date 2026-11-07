import "./globals.css";
import type { ReactNode } from "react";
export const metadata = {
  title: "Collector workspace — development",
  description: "Neutral development scaffold. No live inventory.",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
