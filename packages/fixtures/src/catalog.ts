import { products as baseProducts, in_stock_fresh } from "./stock";
import type { ProductRecord, ListingDTO } from "@pokepulse/contracts";
const sets = [
  "Prismatic Evolutions",
  "Surging Sparks",
  "Twilight Masquerade",
  "Paldean Fates",
  "Scarlet & Violet—151",
  "Crown Zenith",
  "Obsidian Flames",
  "Temporal Forces",
  "Paradox Rift",
  "Stellar Crown",
];
export const demoCatalog: ProductRecord[] = Array.from(
  { length: 50 },
  (_, i) => ({
    ...baseProducts[0],
    id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    slug: `demo-starlight-${i + 1}`,
    name: `${sets[Math.floor(i / 5)]} ${i % 2 ? "Booster Box" : "Booster Bundle"}`,
    set_name: sets[Math.floor(i / 5)],
    product_type: i % 2 ? "booster_box" : "multi_pack",
    edition: `Pokémon TCG · illustrative catalog variant ${(i % 5) + 1}`,
    pack_count: i % 2 ? 36 : 6,
  }),
);
export const demoOffers: ListingDTO[] = demoCatalog.flatMap((p, i) =>
  Array.from({ length: i === 0 ? 2 : 1 }, (_, j) => ({
    ...in_stock_fresh,
    id: `20000000-0000-4000-8000-${String(i * 2 + j + 1).padStart(12, "0")}`,
    product_id: p.id,
    price_minor: i % 7 === 0 ? null : 1999 + i * 100,
    seller_type: j ? ("third_party" as const) : ("retailer" as const),
    evidence_summary: "DEMO DATA — synthetic source; no retailer verification.",
  })),
);
