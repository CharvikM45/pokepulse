import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { z } from "zod";
import { metadataOnlyRow } from "./preserve-configuration";
import { serviceDatabase } from "../../../packages/domain/src/workers";
import { assertCatalogPermission, type CatalogPermission } from "./tcgdex";
const [directory] = process.argv.slice(2);
if (!directory || process.env.CARD_CATALOG_SYNC_ENABLED !== "true")
  throw new Error("SNAPSHOT_IMPORT_DISABLED");
const summary = z
  .object({
    revision: z.string().regex(/^[0-9a-f]{40}$/),
    cards: z.number().int(),
    variants: z.number().int(),
    sets: z.number().int(),
    counts: z.record(z.string(), z.number()),
    errors: z.array(z.unknown()).length(0),
  })
  .parse(JSON.parse(readFileSync(resolve(directory, "summary.json"), "utf8")));
const db = serviceDatabase();
async function checkPermission() {
  const p = await db
    .from("card_provider_permissions")
    .select("*")
    .eq("id", "tcgdex")
    .single();
  if (p.error) throw new Error("PROVIDER_PERMISSION_UNAVAILABLE");
  assertCatalogPermission(p.data as CatalogPermission);
}
await checkPermission();
const existingSets = new Set<string>();
for (let offset = 0; ; offset += 1000) {
  const r = await db
    .from("tcg_sets")
    .select("id")
    .eq("provider_id", "tcgdex")
    .order("id")
    .range(offset, offset + 999);
  if (r.error) throw new Error("CATALOG_SET_LOOKUP_FAILED");
  for (const row of r.data ?? []) existingSets.add(row.id);
  if ((r.data?.length ?? 0) < 1000) break;
}
for (const table of [
  "tcg_sets",
  "card_artists",
  "cards",
  "card_variants",
  "card_artist_credits",
]) {
  let rows: Record<string, unknown>[] = [],
    done = 0;
  async function flush() {
    if (!rows.length) return;
    await checkPermission();
    const groups =
      table === "tcg_sets"
        ? [
            rows.filter((r) => existingSets.has(String(r.id))),
            rows.filter((r) => !existingSets.has(String(r.id))),
          ]
        : [rows];
    for (const group of groups) {
      if (!group.length) continue;
      const r = await db.from(table).upsert(
        group.map((row) =>
          metadataOnlyRow(table, row, existingSets.has(String(row.id))),
        ),
        {
          onConflict:
            table === "card_artist_credits" ? "card_id,artist_id" : "id",
        },
      );
      if (r.error)
        throw new Error(
          `SNAPSHOT_${table.toUpperCase()}_${r.error.code}:${r.error.message}`,
        );
    }
    done += rows.length;
    rows = [];
    console.log(JSON.stringify({ table, imported: done }));
  }
  for await (const line of createInterface({
    input: createReadStream(resolve(directory, `${table}.jsonl`)),
    crlfDelay: Infinity,
  })) {
    if (line.trim()) rows.push(JSON.parse(line));
    if (rows.length === 500) await flush();
  }
  await flush();
}
// Publish only sets belonging to this verified source revision, after all cards and variants exist.
const published = await db
  .from("tcg_sets")
  .update({ public_metadata_allowed: true })
  .eq("provider_id", "tcgdex")
  .eq("metadata_source", `TCGdex metadata source ${summary.revision}`);
if (published.error) throw new Error("SNAPSHOT_PUBLICATION_FAILED");
const coverage = await db.rpc("c_catalog_coverage");
if (coverage.error) throw new Error("COVERAGE_VERIFICATION_FAILED");
console.log(
  JSON.stringify({
    revision: summary.revision,
    expected: summary.cards,
    coverage: coverage.data,
    status: "completed",
  }),
);
