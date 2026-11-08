import "./globals.css";
import type { ReactNode } from "react";
export const metadata = {
  title: "PokéPulse — Pokémon TCG collector tools",
  description:
    "Pokémon TCG drops, local reports, and your binder. Built for collectors who check the details.",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/BarlowCondensed-ExtraBold.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
