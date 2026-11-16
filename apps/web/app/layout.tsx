import "./globals.css";
import type { ReactNode } from "react";
export const metadata = {
  title: "PokéPulse — Your Pokémon collecting companion",
  description:
    "Discover Pokémon TCG sets, track retailer evidence, explore local sightings, and organize your collection.",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
