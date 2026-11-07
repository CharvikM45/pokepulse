import "./globals.css";
import type { ReactNode } from "react";
export const metadata = {
  title: "PokéPulse — collector workspace",
  description:
    "Explore source-aware retailer offers, community reports and your collection.",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
