import { z } from "zod";
import type { serviceDatabase } from "../../../packages/domain/src/workers";
import { priceObservationSchema } from "../../../packages/contracts/src/cards";
/** Independent of stock adapters. Register only a reviewed pricing vendor; no fabricated history. */
export interface SinglesPricingAdapter {
  providerId: string;
  observations(variantId: string, since: string | null): Promise<unknown[]>;
}
export async function ingestSinglesPrices(
  db: ReturnType<typeof serviceDatabase>,
  adapter: SinglesPricingAdapter,
  variantId: string,
  since: string | null,
) {
  z.uuid().parse(variantId);
  const p = await db
    .from("card_provider_permissions")
    .select("enabled,pricing_approved,retention_approved")
    .eq("id", adapter.providerId)
    .single();
  if (
    p.error ||
    !p.data?.enabled ||
    !p.data.pricing_approved ||
    !p.data.retention_approved
  )
    throw new Error("PRICING_NOT_APPROVED");
  const rows = z
    .array(priceObservationSchema.omit({ id: true }))
    .max(1000)
    .parse(await adapter.observations(variantId, since));
  if (
    rows.some(
      (r) =>
        r.provider_id !== adapter.providerId ||
        r.variant_id !== variantId ||
        Date.parse(r.observed_at) > Date.parse(r.captured_at) ||
        Date.parse(r.captured_at) > Date.now(),
    )
  )
    throw new Error("PRICE_PROVENANCE_CONFLICT");
  const result = await db.from("card_price_observations").upsert(rows, {
    onConflict:
      "variant_id,provider_id,condition,grading_company,grade,currency,statistic,observed_at",
    ignoreDuplicates: true,
  });
  if (result.error) throw new Error("PRICE_INGEST_FAILED");
  return rows.length;
}
