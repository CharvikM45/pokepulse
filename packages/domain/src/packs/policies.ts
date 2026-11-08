import type { Variant } from "../collections/policies";
export interface SlotRule {
  slot_index: number;
  pool: readonly { variant_id: string; weight: number }[];
}
export interface PackConfig {
  set_id: string;
  odds_version: string;
  rights_status: "approved" | "metadata_only" | "disabled";
  enabled: boolean;
  fictional: boolean;
  price_coins: number;
  slots: readonly SlotRule[];
}
export function validateConfig(
  config: PackConfig,
  variants: readonly Variant[],
): void {
  if (!config.enabled || config.rights_status !== "approved")
    throw new Error("RIGHTS_DISABLED");
  if (
    !config.odds_version ||
    !Number.isSafeInteger(config.price_coins) ||
    config.price_coins < 0
  )
    throw new Error("INVALID_CONFIG");
  if (!config.slots.length || config.slots.length > 100)
    throw new Error("INVALID_CONFIG");
  const indices = config.slots.map((s) => s.slot_index).sort((a, b) => a - b);
  if (indices.some((n, index) => n !== index)) throw new Error("INVALID_SLOTS");
  const indexed = new Map(variants.map((v) => [v.id, v]));
  for (const slot of config.slots) {
    if (
      !slot.pool.length ||
      new Set(slot.pool.map((p) => p.variant_id)).size !== slot.pool.length
    )
      throw new Error("INVALID_POOL");
    let total = 0;
    for (const candidate of slot.pool) {
      const variant = indexed.get(candidate.variant_id);
      if (
        !variant ||
        variant.set_id !== config.set_id ||
        !variant.eligible_for_packs
      )
        throw new Error("UNSUPPORTED_VARIANT");
      if (!Number.isSafeInteger(candidate.weight) || candidate.weight <= 0)
        throw new Error("INVALID_WEIGHT");
      total += candidate.weight;
    }
    if (!Number.isSafeInteger(total) || total > 0xffffffff)
      throw new Error("INVALID_WEIGHT");
  }
}
/** Internal server policy only. Production boundedInt must use a cryptographic RNG.
 * It must never be wired to a user-provided seed. This function does not debit a wallet.
 */
export function drawSlots(
  config: PackConfig,
  variants: readonly Variant[],
  boundedInt: (maxExclusive: number) => number,
) {
  validateConfig(config, variants);
  return [...config.slots]
    .sort((a, b) => a.slot_index - b.slot_index)
    .map((slot) => {
      const total = slot.pool.reduce(
        (sum, candidate) => sum + candidate.weight,
        0,
      );
      const sample = boundedInt(total);
      if (!Number.isInteger(sample) || sample < 0 || sample >= total)
        throw new Error("INVALID_RNG");
      let cumulative = 0;
      for (const candidate of slot.pool) {
        cumulative += candidate.weight;
        if (sample < cumulative)
          return {
            card_variant_id: candidate.variant_id,
            slot_index: slot.slot_index,
          };
      }
      throw new Error("INVALID_POOL");
    });
}
/** Daily allowance policy proposal: UTC day, one opening, no accumulation or streak penalty. */
export function allowanceAvailable(
  lastFreeOpenAt: string | null,
  now: number,
): boolean {
  if (!Number.isFinite(now)) throw new Error("INVALID_TIME");
  if (lastFreeOpenAt === null) return true;
  const previous = Date.parse(lastFreeOpenAt);
  if (!Number.isFinite(previous)) throw new Error("INVALID_TIME");
  return (
    new Date(previous).toISOString().slice(0, 10) <
    new Date(now).toISOString().slice(0, 10)
  );
}
