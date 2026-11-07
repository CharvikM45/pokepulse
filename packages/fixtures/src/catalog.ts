import { products as baseProducts, in_stock_fresh } from "./stock";
import type { ProductRecord, ListingDTO } from "@pokepulse/contracts";
export const demoCatalog: ProductRecord[] = Array.from(
  { length: 50 },
  (_, i) => ({
    ...baseProducts[0],
    id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    slug: `demo-starlight-${i + 1}`,
    name: `Demo Starlight ${i + 1}`,
    set_name: `Original Demo Set ${Math.floor(i / 10) + 1}`,
    product_type: i % 2 ? "booster_box" : "multi_pack",
    edition: `${i % 3 === 0 ? "exclusive" : "standard"} variant ${i + 1}`,
    pack_count: i % 2 ? 12 : 3,
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
