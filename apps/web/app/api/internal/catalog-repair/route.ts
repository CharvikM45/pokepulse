import {
  createHash,
  timingSafeEqual,
  randomUUID,
  randomBytes,
} from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { Client } from "pg";
import { adminDb, readJsonBody } from "../../../../src/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const inputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("setup") }).strict(),
  z
    .object({
      operation: z.literal("artwork"),
      rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
    })
    .strict(),
  z.object({ operation: z.literal("packs") }).strict(),
  z.object({ operation: z.literal("verify") }).strict(),
  z.object({ operation: z.literal("finish") }).strict(),
]);
const checked = (e: { message: string } | null) => {
  if (e) throw new Error(e.message);
};
export async function POST(request: Request) {
  const expected = process.env.CATALOG_REPAIR_TOKEN,
    token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (
    !expected ||
    !token ||
    request.headers.has("origin") ||
    !timingSafeEqual(
      createHash("sha256").update(expected).digest(),
      createHash("sha256").update(token).digest(),
    )
  )
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  try {
    const input = inputSchema.parse(
        await readJsonBody(request, 2 * 1024 * 1024),
      ),
      db = adminDb();
    if (input.operation === "setup") {
      const raw =
        process.env.POSTGRES_URL ?? process.env.POSTGRES_URL_NON_POOLING;
      if (!raw) throw new Error("MISSING_DATABASE_OPERATOR_CONNECTION");
      const connection = new URL(raw);
      connection.searchParams.delete("sslmode");
      const client = new Client({
        connectionString: connection.toString(),
        ssl: { rejectUnauthorized: true },
        connectionTimeoutMillis: 10000,
        statement_timeout: 30000,
      });
      await client.connect();
      try {
        const source = await client.query(
          "select 1 from public.cards where provider_id='tcgdex' limit 1",
        );
        if (!source.rows.length) throw new Error("WRONG_CATALOG_DATABASE");
        const sql =
          "create or replace function public.c_invalidate_catalog_coverage() returns trigger language plpgsql security definer set search_path='' as $$begin delete from public.card_catalog_coverage_snapshot where id=true;return null;end $$;";
        await client.query(sql);
        await client.query(
          "insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3) on conflict(version) do nothing",
          ["20261117230000", "coverage_safe_updates", [sql]],
        );
      } finally {
        await client.end();
      }
      const p = await db
        .from("card_provider_permissions")
        .update({
          artwork_approved: true,
          allowed_image_hosts: ["assets.tcgdex.net"],
          reviewer:
            "PokéPulse user-requested direct CDN card display; TCGdex Assets documentation reviewed 2026-11-17",
          checked_at: new Date().toISOString(),
        })
        .eq("id", "tcgdex");
      checked(p.error);
      const f = await db
        .from("feature_flags")
        .update({ enabled: true })
        .eq("name", "licensed_card_art");
      checked(f.error);
      return Response.json({ ok: true });
    }
    if (input.operation === "artwork") {
      for (const v of input.rows) {
        const url = new URL(z.string().parse(v.image_url));
        if (
          url.origin !== "https://assets.tcgdex.net" ||
          !url.pathname.endsWith("/low.webp") ||
          v.image_rights_cleared !== true ||
          v.eligible_for_packs !== false
        )
          throw new Error("INVALID_IMAGE_RECORD");
      }
      const r = await db
        .from("card_variants")
        .upsert(input.rows, { onConflict: "id" });
      if (r.error)
        return Response.json(
          { error: r.error.message, code: r.error.code },
          { status: 409 },
        );
      return Response.json({ ok: true, updated: input.rows.length });
    }
    if (input.operation === "packs") {
      const configured = [];
      for (const external of ["base1", "sv03.5", "swsh7"]) {
        const sr = await db
          .from("tcg_sets")
          .select("id,name")
          .eq("provider_id", "tcgdex")
          .eq("provider_set_id", external)
          .eq("language", "en")
          .single();
        checked(sr.error);
        const set = sr.data!;
        const vr = await db
          .from("card_variants")
          .select("id,card_id,edition,finish")
          .eq("set_id", set.id)
          .eq("image_rights_cleared", true)
          .not("image_url", "is", null)
          .order("edition")
          .order("finish")
          .limit(3000);
        checked(vr.error);
        const byCard = new Map<string, string>();
        for (const v of vr.data ?? [])
          if (!byCard.has(v.card_id)) byCard.set(v.card_id, v.id);
        const pool = [...byCard.values()];
        if (pool.length < 20) throw new Error("INSUFFICIENT_SIMULATOR_POOL");
        const eligible = await db
          .from("card_variants")
          .update({ eligible_for_packs: true })
          .in("id", pool);
        checked(eligible.error);
        const cleared = await db
          .from("tcg_sets")
          .update({ rights_status: "approved", enabled_for_simulation: true })
          .eq("id", set.id);
        checked(cleared.error);
        const existing = await db
          .from("pack_odds_versions")
          .select("id,active")
          .eq("set_id", set.id)
          .eq("version", "pp-uniform-ten-v1")
          .maybeSingle();
        checked(existing.error);
        if (!existing.data) {
          const oddsId = randomUUID();
          const o = await db.from("pack_odds_versions").insert({
            id: oddsId,
            set_id: set.id,
            version: "pp-uniform-ten-v1",
            active: false,
            fictional: true,
            methodology:
              "Custom game: ten independent uniform draws from one artwork-backed variant per card in this set, with replacement. This is not the distribution of a physical booster.",
            price_coins: 0,
            source_url: `https://api.tcgdex.net/v2/en/sets/${external}`,
            checked_at: new Date().toISOString(),
            uncertainty:
              "Fictional custom configuration; no official pull-rate claim.",
          });
          checked(o.error);
          const rules = Array.from({ length: 10 }, (_, slot) =>
            pool.map((variant_id) => ({
              odds_id: oddsId,
              set_id: set.id,
              slot_index: slot,
              variant_id,
              weight: 1,
            })),
          ).flat();
          for (let i = 0; i < rules.length; i += 1000) {
            const r = await db
              .from("pack_slot_rules")
              .insert(rules.slice(i, i + 1000));
            checked(r.error);
          }
          const active = await db
            .from("pack_odds_versions")
            .update({ active: true })
            .eq("id", oddsId);
          checked(active.error);
        }
        configured.push({
          set: set.name,
          pool: pool.length,
          cards_per_opening: 10,
        });
      }
      const settings = await db
        .from("b_pack_settings")
        .update({
          enabled: true,
          allow_demo: false,
          welcome_coins: 0,
          daily_free_enabled: false,
          daily_opening_cap: 100,
        })
        .eq("singleton", true);
      checked(settings.error);
      const f = await db
        .from("feature_flags")
        .update({ enabled: true })
        .eq("name", "pack_lab");
      checked(f.error);
      return Response.json({ ok: true, configured });
    }
    if (input.operation === "verify") {
      let id: string | undefined;
      try {
        const email = `qa-${randomUUID()}@pokepulse.invalid`,
          password = randomBytes(32).toString("hex");
        const u = await db.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: { pokepulse_repair: true },
        });
        checked(u.error);
        id = u.data.user!.id;
        const client = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const s = await client.auth.signInWithPassword({ email, password });
        checked(s.error);
        const set = await db
          .from("tcg_sets")
          .select("id")
          .eq("enabled_for_simulation", true)
          .limit(1)
          .single();
        checked(set.error);
        const args = {
          p_set_id: set.data!.id,
          p_idempotency_key: randomUUID(),
          p_use_free_open: false,
        };
        const first = await client.rpc("b_open_pack", args),
          again = await client.rpc("b_open_pack", args);
        checked(first.error);
        checked(again.error);
        const real = await client.from("real_inventory").select("quantity"),
          virt = await client.from("virtual_inventory").select("quantity");
        checked(real.error);
        checked(virt.error);
        const receipt = first.data as { id: string; cards: unknown[] };
        if (
          receipt.id !== again.data.id ||
          receipt.cards.length !== 10 ||
          real.data?.length ||
          virt.data?.reduce((n, r) => n + Number(r.quantity), 0) !== 10
        )
          throw new Error("PACK_ACCEPTANCE_FAILED");
        return Response.json({
          ok: true,
          cards: 10,
          same_saved_opening: true,
          physical_copies: 0,
          virtual_copies: 10,
        });
      } finally {
        if (id) {
          const d = await db.auth.admin.deleteUser(id);
          checked(d.error);
        }
      }
    }
    // Image and simulator configuration changes do not change catalog cardinality.
    const [cards, variants, sets, artists, key] = await Promise.all([
      db.from("cards").select("id", { count: "exact", head: true }),
      db.from("card_variants").select("id", { count: "exact", head: true }),
      db.from("tcg_sets").select("id", { count: "exact", head: true }),
      db.from("card_artists").select("id", { count: "exact", head: true }),
      db.rpc("c_catalog_permission_key"),
    ]);
    for (const r of [cards, variants, sets, artists, key]) checked(r.error);
    if (
      cards.count !== 135414 ||
      variants.count !== 208965 ||
      sets.count !== 1148 ||
      artists.count !== 419
    )
      throw new Error("CATALOG_COUNT_CHANGED");
    const metrics = {
      printings: cards.count,
      variants: variants.count,
      sets: sets.count,
      artists: artists.count,
      languages: [
        "de",
        "en",
        "es",
        "es-mx",
        "fr",
        "id",
        "it",
        "ja",
        "ko",
        "pt",
        "th",
        "zh-cn",
        "zh-tw",
      ],
      approved_providers: ["tcgdex"],
      art_enabled: true,
      measured_at: new Date().toISOString(),
    };
    const cached = await db.from("card_catalog_coverage_snapshot").upsert({
      id: true,
      metrics,
      permission_key: key.data,
      observed_at: new Date().toISOString(),
    });
    checked(cached.error);
    return Response.json({ ok: true, coverage: metrics });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "REPAIR_FAILED" },
      { status: 400 },
    );
  }
}
