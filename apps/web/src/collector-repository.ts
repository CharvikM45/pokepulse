import "server-only";
import { z } from "zod";
import { adminDb, configured, dbError, HttpError } from "./server";
import {
  ids,
  variants as demoVariants,
  manifest as demoManifest,
} from "../../../packages/fixtures/src/b-domain";
import {
  cardsSchema,
  openingSchema,
  setsSchema,
  uuid,
} from "./collector-contracts";

export async function allRows(
  table: string,
  fields: string,
  filters: Record<string, string | boolean> = {},
  order = "id",
) {
  const output: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = adminDb()
      .from(table)
      .select(fields)
      .order(order)
      .range(offset, offset + 999);
    if (table === "pack_slot_rules") query = query.order("variant_id");
    if (table === "master_set_requirements") query = query.order("scope");
    for (const [key, value] of Object.entries(filters))
      query = query.eq(key, value);
    const { data, error } = await query;
    dbError(error);
    const page = z.array(z.record(z.string(), z.unknown())).parse(data ?? []);
    output.push(...page);
    if (page.length < 1000) return output;
    if (output.length >= 50000)
      throw new HttpError(
        "SOURCE_UNAVAILABLE",
        503,
        "Catalog is too large for this view. Try a narrower set.",
      );
  }
}
export async function flag(name: string) {
  if (!configured()) return false;
  const { data, error } = await adminDb()
    .from("feature_flags")
    .select("enabled")
    .eq("name", name)
    .single();
  dbError(error);
  return data?.enabled === true;
}
export async function setCatalog(limit = 20, after?: string) {
  if (!configured() && after) {
    if (after !== ids.set)
      throw new HttpError("VALIDATION_ERROR", 400, "Unknown set cursor.");
    return { enabled: false, sets: [], next_cursor: null };
  }
  if (!configured())
    return {
      ...setsSchema.parse({
        enabled: false,
        sets: [
          {
            id: ids.set,
            name: "Lumen Grove",
            metadata_source: "Original fictional PokéPulse demo",
            metadata_permission_checked_at: null,
            release_date: null,
            manifest_version: "fictional-1",
            odds_version: "fictional-1",
            enabled_for_simulation: false,
            rights_status: "approved",
            enabled: false,
            is_demo: true,
            coin_cost: 10,
            odds: {
              version: "fictional-1",
              model: "fictional",
              methodology:
                "Original fictional two-slot model, unrelated to physical card packs.",
              sample_size: null,
              source_url: null,
              checked_label: null,
              uncertainty: null,
              slots: [
                {
                  label: "Slot 1",
                  outcomes: [
                    { label: "Moss Courier", probability: "50%" },
                    { label: "Harbor Lantern", probability: "50%" },
                  ],
                },
                {
                  label: "Slot 2",
                  outcomes: [
                    { label: "Moss Courier standard", probability: "70%" },
                    { label: "Moss Courier foil", probability: "25%" },
                    { label: "Cloud Archivist", probability: "5%" },
                  ],
                },
              ],
            },
          },
        ],
      }),
      next_cursor: null,
    };
  const enabled = await flag("pack_lab");
  const { data: settings, error } = await adminDb()
    .from("b_pack_settings")
    .select("enabled,allow_demo")
    .single();
  dbError(error);
  let query = adminDb()
    .from("tcg_sets")
    .select(
      "id,name,metadata_source,metadata_permission_checked_at,release_date,rights_status,enabled_for_simulation,is_demo",
    )
    .eq("public_metadata_allowed", true)
    .neq("rights_status", "disabled")
    .order("id")
    .limit(limit + 1);
  if (after) query = query.gt("id", uuid.parse(after));
  const page = await query;
  dbError(page.error);
  const availableSets = page.data ?? [];
  const sets = availableSets.slice(0, limit);
  const output = [];
  for (const set of sets) {
    if (set.rights_status === "disabled") continue;
    const odds = await allRows("pack_odds_versions", "*", {
      set_id: String(set.id),
      active: true,
    });
    const oddsRow = odds[0];
    let model = null;
    if (oddsRow) {
      const rules = await allRows(
        "pack_slot_rules",
        "*",
        { odds_id: String(oddsRow.id) },
        "slot_index",
      );
      const cards = await cardCatalog(String(set.id));
      const slots = [...new Set(rules.map((r) => Number(r.slot_index)))]
        .sort((a, b) => a - b)
        .map((index) => {
          const pool = rules.filter((r) => Number(r.slot_index) === index),
            total = pool.reduce((sum, r) => sum + Number(r.weight), 0);
          return {
            label: `Slot ${index + 1}`,
            outcomes: pool.map((rule) => {
              const card = cards.variants.find((v) => v.id === rule.variant_id);
              return {
                label: card
                  ? `${card.card_name} · ${card.finish}`
                  : "Unknown variant",
                probability: `${((100 * Number(rule.weight)) / total).toFixed(2)}%`,
              };
            }),
          };
        });
      model = {
        version: oddsRow.version,
        model: oddsRow.fictional ? "fictional" : "estimated",
        methodology: oddsRow.methodology,
        sample_size: oddsRow.sample_size,
        source_url: oddsRow.source_url,
        checked_label: oddsRow.checked_at,
        uncertainty: oddsRow.uncertainty,
        slots,
      };
    }
    const published = await cardCatalog(String(set.id));
    const available =
      enabled &&
      settings?.enabled === true &&
      set.enabled_for_simulation === true &&
      (!set.is_demo || settings?.allow_demo === true);
    output.push({
      id: set.id,
      name: set.name,
      metadata_source: set.metadata_source,
      metadata_permission_checked_at: set.metadata_permission_checked_at,
      release_date: set.release_date,
      manifest_version: published.manifest?.version ?? null,
      odds_version: oddsRow?.version ?? null,
      enabled_for_simulation: available,
      rights_status: set.rights_status,
      is_demo: set.is_demo,
      enabled:
        enabled &&
        settings?.enabled === true &&
        set.enabled_for_simulation === true &&
        (!set.is_demo || settings?.allow_demo === true),
      coin_cost: oddsRow?.price_coins ?? null,
      odds: model,
    });
  }
  return {
    ...setsSchema.parse({
      enabled: enabled && settings?.enabled === true,
      sets: output,
    }),
    next_cursor: availableSets.length > limit ? sets.at(-1)!.id : null,
  };
}
export async function cardCatalog(setId: string, version?: string) {
  uuid.parse(setId);
  if (!configured()) {
    if (setId !== ids.set || (version && version !== demoManifest.version))
      throw new HttpError("NOT_FOUND", 404, "Set or manifest not found.");
    return cardsSchema.parse({
      variants: demoVariants,
      manifest: demoManifest,
      is_demo: true,
      metadata_source: "Original fictional PokéPulse demo",
    });
  }
  const { data: set, error } = await adminDb()
    .from("tcg_sets")
    .select("rights_status,public_metadata_allowed,is_demo,metadata_source")
    .eq("id", setId)
    .maybeSingle();
  dbError(error);
  if (!set || set.rights_status === "disabled" || !set.public_metadata_allowed)
    throw new HttpError("RIGHTS_DISABLED", 403, "Set metadata is unavailable.");
  const cards = await allRows("cards", "id,card_name,card_number", {
    set_id: setId,
  });
  const variants = (
    await allRows(
      "card_variants",
      "id,set_id,card_id,rarity,finish,eligible_for_packs",
      { set_id: setId },
    )
  ).map((v) => {
    const card = cards.find((c) => c.id === v.card_id);
    return { ...v, card_name: card?.card_name, card_number: card?.card_number };
  });
  let query = adminDb()
    .from("master_set_manifests")
    .select("id,version,supported_goals")
    .eq("set_id", setId)
    .eq("validated", true)
    .is("withdrawn_at", null)
    .order("published_at", { ascending: false })
    .limit(1);
  if (version) query = query.eq("version", version);
  const result = await query;
  dbError(result.error);
  const manifest = result.data?.[0];
  if (version && !manifest)
    throw new HttpError("NOT_FOUND", 404, "Published manifest not found.");
  const requirements = manifest
    ? await allRows(
        "master_set_requirements",
        "variant_id,collectible_key,scope,rationale",
        { manifest_id: manifest.id },
        "variant_id",
      )
    : [];
  return cardsSchema.parse({
    variants,
    is_demo: set.is_demo,
    metadata_source: set.metadata_source,
    manifest: manifest
      ? {
          set_id: setId,
          version: manifest.version,
          supported_goals: manifest.supported_goals,
          validated: true,
          requirements,
        }
      : null,
  });
}

export async function savedOpening(userId: string, id: string) {
  const db = adminDb();
  const { data, error } = await db
    .from("pack_openings")
    .select("id,set_id,opened_at,spent_coins,used_free_open,odds_id")
    .eq("user_id", userId)
    .eq("id", uuid.parse(id))
    .maybeSingle();
  dbError(error);
  if (!data) throw new HttpError("NOT_FOUND", 404, "Opening not found.");
  // Saved ownership remains recoverable even after a set is disabled or an odds version retired.
  const set = await db
    .from("tcg_sets")
    .select("name")
    .eq("id", data.set_id)
    .single();
  dbError(set.error);
  const odds = await db
    .from("pack_odds_versions")
    .select("version")
    .eq("id", data.odds_id)
    .single();
  dbError(odds.error);
  const cards = await allRows(
    "opening_cards",
    "card_variant_id,slot_index",
    { opening_id: data.id },
    "slot_index",
  );
  const variants = await allRows("card_variants", "id,card_id,finish", {
    set_id: data.set_id,
  });
  const names = await allRows("cards", "id,card_name,card_number", {
    set_id: data.set_id,
  });
  return openingSchema.parse({
    id: data.id,
    set_id: data.set_id,
    set_name: set.data?.name,
    opened_at: data.opened_at,
    spent_coins: data.spent_coins,
    used_free_open: data.used_free_open,
    odds_version: odds.data?.version,
    opening_status: "committed",
    cards: cards.map((c) => {
      const v = variants.find((v) => v.id === c.card_variant_id);
      const name = names.find((n) => n.id === v?.card_id);
      return {
        ...c,
        card_name: name?.card_name,
        card_number: name?.card_number,
        finish: v?.finish,
      };
    }),
  });
}
