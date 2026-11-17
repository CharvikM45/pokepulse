import {
  readFileSync,
  createReadStream,
  createWriteStream,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
const [directory, inventoryPath] = process.argv.slice(2);
if (!directory || !inventoryPath)
  throw new Error("SNAPSHOT_AND_ASSET_INVENTORY_REQUIRED");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")),
  images = new Map<string, string>();
for (const [language, series] of Object.entries(inventory))
  for (const [serie, sets] of Object.entries(series as Record<string, unknown>))
    for (const [set, cards] of Object.entries(sets as Record<string, unknown>))
      for (const [number, hash] of Object.entries(
        cards as Record<string, unknown>,
      )) {
        if (typeof hash !== "string" || ["logo", "symbol"].includes(number))
          continue;
        images.set(
          `${language}:${set}-${number}`,
          `https://assets.tcgdex.net/${[language, serie, set, number].map(encodeURIComponent).join("/")}/low.webp`,
        );
      }
const byId = new Map<string, string>();
let cards = 0,
  variants = 0;
for await (const line of createInterface({
  input: createReadStream(resolve(directory, "cards.jsonl")),
  crlfDelay: Infinity,
})) {
  const c = JSON.parse(line);
  const image = images.get(`${c.language}:${c.provider_card_id}`);
  if (image) {
    byId.set(c.id, image);
    cards++;
  }
}
const stream = createWriteStream(resolve(directory, "artwork.jsonl"));
for await (const line of createInterface({
  input: createReadStream(resolve(directory, "card_variants.jsonl")),
  crlfDelay: Infinity,
})) {
  const v = JSON.parse(line),
    url = byId.get(v.card_id);
  if (!url) continue;
  const row =
    JSON.stringify({ ...v, image_url: url, image_rights_cleared: true }) + "\n";
  if (!stream.write(row))
    await new Promise<void>((r) => stream.once("drain", r));
  variants++;
}
await new Promise<void>((r) => stream.end(r));
writeFileSync(
  resolve(directory, "artwork-summary.json"),
  JSON.stringify(
    {
      cards,
      variants,
      provider: "tcgdex",
      host: "assets.tcgdex.net",
      checked_at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ cards, variants }));
