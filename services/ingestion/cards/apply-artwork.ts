import {
  createReadStream,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
const [directory] = process.argv.slice(2),
  token = process.env.CATALOG_REPAIR_TOKEN;
if (!directory || !token) throw new Error("REPAIR_CONFIGURATION_REQUIRED");
const endpoint =
  "https://web-plum-alpha-64.vercel.app/api/internal/catalog-repair";
async function send(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(endpoint, {
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
      const rows = body.rows as unknown[] | undefined;
      if (
        r.status === 409 &&
        text.includes('"code":"57014"') &&
        rows &&
        rows.length > 50
      ) {
        const split = Math.floor(rows.length / 2);
        await send({ ...body, rows: rows.slice(0, split) });
        await send({ ...body, rows: rows.slice(split) });
        return { ok: true };
      }
      if (r.status < 500 && r.status !== 429)
        throw new Error(`REPAIR_REJECTED:${r.status}:${text.slice(0, 500)}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("REPAIR_REJECTED"))
        throw e;
      if (attempt === 4) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error("REPAIR_UNAVAILABLE");
}
await send({ operation: "setup" });
const cp = resolve(directory, "artwork-checkpoint.json"),
  saved = existsSync(cp) ? JSON.parse(readFileSync(cp, "utf8")).done : 0;
let done = 0,
  bytes = 0,
  rows: unknown[] = [];
async function flush() {
  if (!rows.length) return;
  if (done + rows.length > saved) {
    await send({ operation: "artwork", rows });
    writeFileSync(cp, JSON.stringify({ done: done + rows.length }));
    console.log(JSON.stringify({ artwork: done + rows.length }));
  }
  done += rows.length;
  rows = [];
  bytes = 0;
}
for await (const line of createInterface({
  input: createReadStream(resolve(directory, "artwork.jsonl")),
  crlfDelay: Infinity,
})) {
  const size = Buffer.byteLength(line);
  if (rows.length && bytes + size > 1800000) await flush();
  rows.push(JSON.parse(line));
  bytes += size;
  if (rows.length === 2000) await flush();
}
await flush();
try {
  const packs = await send({ operation: "packs" });
  console.log(JSON.stringify({ packs }));
  const verified = await send({ operation: "verify" });
  console.log(JSON.stringify({ verified }));
  writeFileSync(
    resolve(directory, "repair-acceptance.json"),
    JSON.stringify(verified, null, 2),
  );
} finally {
  const coverage = await send({ operation: "finish" });
  console.log(JSON.stringify({ coverage }));
}
