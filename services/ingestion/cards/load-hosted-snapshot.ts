import {
  createReadStream,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
const [directory] = process.argv.slice(2),
  endpoint = process.env.CATALOG_IMPORT_URL,
  token = process.env.CATALOG_IMPORT_TOKEN;
if (!directory || !endpoint || !token || !endpoint.startsWith("https://"))
  throw new Error("HOSTED_IMPORT_CONFIGURATION_REQUIRED");
const summary = JSON.parse(
  readFileSync(resolve(directory, "summary.json"), "utf8"),
);
const checkpointPath = resolve(directory, "hosted-checkpoint.json");
const progress: Record<string, number> = existsSync(checkpointPath)
  ? JSON.parse(readFileSync(checkpointPath, "utf8"))
  : {};
async function send(body: unknown) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(endpoint!, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(65000),
      });
      const text = await r.text();
      if (r.ok) return JSON.parse(text);
      if (r.status < 500 && r.status !== 429)
        throw new Error(`IMPORT_REJECTED:${r.status}:${text.slice(0, 800)}`);
      if (attempt === 4) throw new Error(`IMPORT_UNAVAILABLE:${r.status}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("IMPORT_REJECTED"))
        throw e;
      if (attempt === 4) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error("IMPORT_UNAVAILABLE");
}
await send({ operation: "check" });
for (const table of [
  "tcg_sets",
  "card_artists",
  "cards",
  "card_variants",
  "card_artist_credits",
]) {
  let done = 0,
    rows: Record<string, unknown>[] = [];
  async function flush() {
    if (!rows.length) return;
    if (done + rows.length > (progress[table] ?? 0)) {
      await send({ operation: "upsert", table, rows });
      progress[table] = done + rows.length;
      writeFileSync(checkpointPath, JSON.stringify(progress));
      console.log(JSON.stringify({ table, imported: progress[table] }));
    }
    done += rows.length;
    rows = [];
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
const result = await send({
  operation: "publish",
  revision: summary.revision,
  cards: summary.cards,
  variants: summary.variants,
  sets: summary.sets,
});
writeFileSync(
  resolve(directory, "published.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ status: "completed", ...result }));
