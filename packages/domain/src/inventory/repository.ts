import type { SupabaseClient } from "@supabase/supabase-js";
import { productRecordSchema, type ProductRecord } from "@pokepulse/contracts";
import { canonicalIdentity, mappingDecision, normalizeGtin } from "./catalog";
/** Server-only repository. Call with an authorized service client, never a browser client. */
export class CatalogRepository {
  constructor(private readonly db: SupabaseClient) {}
  async reviewMapping(
    sourceId: string,
    sourceItemId: string,
    candidate: ProductRecord,
  ) {
    const product = productRecordSchema.parse(candidate);
    const { data, error } = await this.db
      .from("products")
      .select("*")
      .eq("identity_key", canonicalIdentity(product));
    if (error) throw new Error("CATALOG_READ_FAILED");
    const known = (data ?? []).map((row) => productRecordSchema.parse(row));
    const decision = mappingDecision(product, known);
    if (decision.kind === "match") return decision;
    const review = await this.db.from("mapping_reviews").insert({
      source_id: sourceId,
      source_item_id: sourceItemId,
      candidates: known.map((p) => p.id),
      reason: decision.reason,
    });
    if (review.error) throw new Error("MAPPING_REVIEW_FAILED");
    return decision;
  }
  async addGtinAlias(productId: string, gtin: string, reviewerId: string) {
    const result = await this.db.from("product_equivalences").insert({
      product_id: productId,
      gtin: normalizeGtin(gtin),
      reviewed_by: reviewerId,
    });
    if (result.error) throw new Error("ALIAS_CONFLICT");
  }
}
