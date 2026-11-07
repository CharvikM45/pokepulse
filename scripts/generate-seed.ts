import { writeFileSync } from "node:fs";
import { demoCatalog, demoOffers } from "../packages/fixtures/src";
import { canonicalIdentity } from "../packages/domain/src/inventory/catalog";
const quote = (v: unknown) =>
  v === null || v === undefined
    ? "null"
    : typeof v === "number"
      ? String(v)
      : typeof v === "boolean"
        ? String(v)
        : `'${String(v).replaceAll("'", "''")}'`;
let sql = `-- Local development only. Every seeded record is explicitly demo. Never load into production.\nbegin;\ninsert into public.retailers(id,name,website,is_demo) values ('${demoOffers[0].retailer_id}','Demo retailer','https://example.com/demo',true) on conflict do nothing;\ninsert into public.source_permissions(id,retailer_id,status,enabled,is_demo,allowed_hosts) values ('demo','${demoOffers[0].retailer_id}','candidate',false,true,array['example.com']) on conflict do nothing;\n`;
for (const p of demoCatalog) {
  const row = { ...p, identity_key: canonicalIdentity(p) };
  sql += `insert into public.products(${Object.keys(row).join(",")}) values (${Object.values(row).map(quote).join(",")}) on conflict do nothing;\n`;
}
for (const l of demoOffers) {
  const row = {
    id: l.id,
    product_id: l.product_id,
    retailer_id: l.retailer_id,
    source_id: "demo",
    source_item_id: l.id,
    retailer_url: l.retailer_url,
    seller_type: l.seller_type,
    seller_id:
      l.seller_type === "third_party" ? "demo-marketplace" : "demo-retailer",
    channel: l.channel,
    region_code: l.region_code,
    price_minor: l.price_minor,
    currency: l.currency,
    is_demo: true,
  };
  sql += `insert into public.listings(${Object.keys(row).join(",")}) values (${Object.values(row).map(quote).join(",")}) on conflict do nothing;\n`;
}
writeFileSync("supabase/seed.sql", sql + "commit;\n");
