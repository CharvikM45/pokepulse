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
const specialSets = new Set([0, 3, 4]);
const format = (i: number) =>
  Math.floor(i / 5) === 5
    ? "elite_trainer_box"
    : i % 2
      ? specialSets.has(Math.floor(i / 5))
        ? "elite_trainer_box"
        : "booster_box"
      : specialSets.has(Math.floor(i / 5))
        ? "multi_pack"
        : "elite_trainer_box";
const formatLabel = {
  booster_box: "Booster Box",
  multi_pack: "Booster Bundle",
  elite_trainer_box: "Elite Trainer Box",
};
export const demoCatalog: ProductRecord[] = Array.from(
  { length: 50 },
  (_, i) => ({
    ...baseProducts[0],
    id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    slug: `demo-starlight-${i + 1}`,
    name: `${sets[Math.floor(i / 5)]} ${formatLabel[format(i)]}`,
    set_name: sets[Math.floor(i / 5)],
    product_type: format(i),
    edition: `Pokémon TCG · illustrative catalog variant ${(i % 5) + 1}`,
    pack_count:
      format(i) === "booster_box"
        ? 36
        : format(i) === "multi_pack"
          ? 6
          : Math.floor(i / 5) === 5
            ? 10
            : 9,
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
