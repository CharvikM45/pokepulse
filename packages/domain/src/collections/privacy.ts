import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrivacyParticipant } from "../workers";

export function collectorPrivacy(db: SupabaseClient): PrivacyParticipant[] {
  async function rows(table: string, column: string, userId: string) {
    const output: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      const order =
        table === "b_real_edit_requests"
          ? "idempotency_key"
          : table === "wallets"
            ? "user_id"
            : table.endsWith("inventory")
              ? "card_variant_id"
              : table === "sighting_confirmations"
                ? "sighting_id"
                : "id";
      const { data, error } = await db
        .from(table)
        .select("*")
        .eq(column, userId)
        .order(order)
        .range(offset, offset + 999);
      if (error) throw new Error("B_EXPORT_FAILED");
      output.push(...(data ?? []));
      if (!data || data.length < 1000) return output;
    }
  }
  const erase = async (userId: string) => {
    const { error } = await db.rpc("b_erase_private", { p_user: userId });
    if (error) throw new Error("B_ERASE_FAILED");
  };
  return [
    {
      name: "radar",
      export: async (userId) => ({
        reports: await rows("sightings", "reporter_id", userId),
        confirmations: await rows("sighting_confirmations", "user_id", userId),
        moderation_actions: await rows(
          "sighting_moderation_actions",
          "actor_id",
          userId,
        ),
        release_edits: await rows("release_edit_history", "actor_id", userId),
        manifest_actions: await rows("b_manifest_actions", "actor_id", userId),
      }),
      erase,
    },
    {
      name: "binder",
      export: async (userId) => ({
        real: await rows("real_inventory", "user_id", userId),
        virtual: await rows("virtual_inventory", "user_id", userId),
        edit_requests: await rows("b_real_edit_requests", "user_id", userId),
      }),
      erase,
    },
    {
      name: "packs",
      export: async (userId) => {
        const openings = await rows("pack_openings", "user_id", userId);
        const cards: unknown[] = [];
        for (const opening of openings) {
          const id = (opening as { id: string }).id;
          const { data, error } = await db
            .from("opening_cards")
            .select("*")
            .eq("opening_id", id)
            .order("slot_index");
          if (error) throw new Error("B_EXPORT_FAILED");
          cards.push(...(data ?? []));
        }
        return {
          wallet: await rows("wallets", "user_id", userId),
          ledger: await rows("coin_ledger", "user_id", userId),
          openings,
          cards,
        };
      },
      erase,
    },
  ];
}
