import { z } from "zod";
import { serviceDatabase } from "../../../packages/domain/src/workers";
import { providerIdentity } from "../../../packages/domain/src/cards/normalization";
import {
  TcgdexAdapter,
  normalizeCard,
  assertCatalogPermission,
  type CatalogPermission,
} from "./tcgdex";
if (process.env.CARD_CATALOG_SYNC_ENABLED !== "true")
  throw new Error("CARD_CATALOG_SYNC_DISABLED");
const language = z
  .enum(["en", "ja"])
  .parse(process.env.CARD_CATALOG_LANGUAGE ?? "en");
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(200)
  .parse(process.env.CARD_CATALOG_BATCH_SIZE ?? 20);
const db = serviceDatabase();
function check(e: { message: string } | null) {
  if (e) throw new Error("CATALOG_DATABASE_OPERATION_FAILED");
}
const permission = await db
  .from("card_provider_permissions")
  .select("*")
  .eq("id", "tcgdex")
  .single();
check(permission.error);
const rights = permission.data as CatalogPermission;
assertCatalogPermission(rights);
const claimed = await db.rpc("c_claim_card_sync", {
  p_provider: "tcgdex",
  p_language: language,
});
check(claimed.error);
const run = z
  .object({
    id: z.uuid(),
    lease_token: z.uuid(),
    checkpoint: z
      .object({ set: z.string().optional(), card: z.string().optional() })
      .passthrough(),
    added: z.number(),
    updated: z.number(),
    skipped: z.number(),
  })
  .parse(claimed.data);
const adapter = new TcgdexAdapter(rights);
let checkpoint = { ...run.checkpoint };
let processed = 0,
  added = run.added,
  updated = run.updated;
let done = true;
async function save(status: string, error?: string) {
  const r = await db
    .from("card_sync_runs")
    .update({
      status,
      checkpoint,
      added,
      updated,
      errors: error ? [{ code: error, at: new Date().toISOString() }] : [],
      updated_at: new Date().toISOString(),
      lease_until:
        status === "running"
          ? new Date(Date.now() + 300000).toISOString()
          : null,
      finished_at: status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", run.id)
    .eq("lease_token", run.lease_token)
    .select("id");
  check(r.error);
  if (r.data?.length !== 1) throw new Error("SYNC_LEASE_LOST");
}
try {
  const sets = await adapter.sets(language);
  outer: for (const brief of sets) {
    if (checkpoint.set && brief.id < checkpoint.set) continue;
    const data = await adapter.set(language, brief.id),
      setId = providerIdentity("tcgdex", language, "set", brief.id);
    const existing = await db
      .from("tcg_sets")
      .select("id")
      .eq("id", setId)
      .maybeSingle();
    check(existing.error);
    const setRow = {
      id: setId,
      name: data.name,
      provider_id: "tcgdex",
      provider_set_id: brief.id,
      language,
      region: null,
      series: data.serie?.name ?? null,
      release_date: data.releaseDate ?? null,
      release_precision: data.releaseDate ? "day" : "unknown",
      metadata_source: `TCGdex REST v2 (${language})`,
      metadata_permission_evidence_url: rights.evidence_url,
      metadata_permission_checked_at: rights.checked_at,
      source_url: `https://api.tcgdex.net/v2/${language}/sets/${encodeURIComponent(brief.id)}`,
      synchronized_at: new Date().toISOString(),
    };
    const upsert = existing.data
      ? await db.from("tcg_sets").upsert(setRow)
      : await db.from("tcg_sets").upsert({
          ...setRow,
          rights_status: "metadata_only",
          enabled_for_simulation: false,
          is_demo: false,
          public_metadata_allowed: false,
        });
    check(upsert.error);
    for (const card of [...data.cards].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (
        checkpoint.set === brief.id &&
        checkpoint.card &&
        card.id <= checkpoint.card
      )
        continue;
      if (processed >= limit) {
        done = false;
        break outer;
      }
      // Recheck revocation before each outbound card fetch and write.
      const nowRights = await db
        .from("card_provider_permissions")
        .select("*")
        .eq("id", "tcgdex")
        .single();
      check(nowRights.error);
      assertCatalogPermission(nowRights.data as CatalogPermission);
      const normalized = normalizeCard(
        await adapter.card(language, card.id),
        language,
        brief.id,
        nowRights.data as CatalogPermission,
      );
      const before = await db
        .from("cards")
        .select("id")
        .eq("id", normalized.card.id)
        .maybeSingle();
      check(before.error);
      for (const [kind, external_id, entity_id] of [
        ["set", brief.id, setId],
        ["card", card.id, normalized.card.id],
      ]) {
        const alias = await db
          .from("card_provider_aliases")
          .select("entity_id")
          .eq("provider_id", "tcgdex")
          .eq("language", language)
          .eq("entity_kind", kind)
          .eq("external_id", external_id)
          .maybeSingle();
        check(alias.error);
        if (alias.data && alias.data.entity_id !== entity_id)
          throw new Error("PROVIDER_ALIAS_CONFLICT");
        const saved = await db.from("card_provider_aliases").upsert({
          provider_id: "tcgdex",
          language,
          entity_kind: kind,
          external_id,
          entity_id,
        });
        check(saved.error);
      }
      const c = await db.from("cards").upsert(normalized.card);
      check(c.error);
      const v = await db.from("card_variants").upsert(normalized.variants);
      check(v.error);
      for (const name of normalized.card.artists) {
        const id = providerIdentity("tcgdex", language, "artist", name);
        const a = await db
          .from("card_artists")
          .upsert({ name }, { onConflict: "name" })
          .select("id")
          .single();
        check(a.error);
        const credit = await db
          .from("card_artist_credits")
          .upsert({ card_id: normalized.card.id, artist_id: a.data?.id ?? id });
        check(credit.error);
      }
      if (before.data) updated++;
      else added++;
      processed++;
      checkpoint = { set: brief.id, card: card.id };
      await save("running");
    }
    const publish = await db
      .from("tcg_sets")
      .update({ public_metadata_allowed: true })
      .eq("id", setId);
    check(publish.error);
    checkpoint = { set: brief.id, card: checkpoint.card };
  }
  await save(done ? "completed" : "running");
  if (!done) {
    const released = await db
      .from("card_sync_runs")
      .update({ lease_until: new Date().toISOString() })
      .eq("id", run.id)
      .eq("lease_token", run.lease_token);
    check(released.error);
  }
  console.log(
    JSON.stringify({
      run_id: run.id,
      processed,
      added,
      updated,
      status: done ? "completed" : "running",
    }),
  );
} catch (error) {
  await save("failed", error instanceof Error ? error.message : "SYNC_FAILED");
  throw new Error("CATALOG_SYNC_FAILED; inspect administrative sync status");
}
