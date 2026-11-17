import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { adminDb, readJsonBody } from "../../../../src/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const revision = "4218f64dcbf3de6e7b7548530f938fb0b9ebbe2a";
const tables = [
  "tcg_sets",
  "card_artists",
  "cards",
  "card_variants",
  "card_artist_credits",
] as const;
const bodySchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("check") }).strict(),
  z
    .object({
      operation: z.literal("upsert"),
      table: z.enum(tables),
      rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
    })
    .strict(),
  z
    .object({
      operation: z.literal("publish"),
      revision: z.literal(revision),
      cards: z.literal(135414),
      variants: z.literal(208965),
      sets: z.literal(1148),
    })
    .strict(),
]);
export async function POST(request: Request) {
  // An absent token closes this operational endpoint. Browser sessions never authorize imports.
  const expected = process.env.CATALOG_IMPORT_TOKEN,
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
    const input = bodySchema.parse(
      await readJsonBody(request, 2 * 1024 * 1024),
    );
    const db = adminDb();
    const permission = await db
      .from("card_provider_permissions")
      .select("enabled,metadata_approved,retention_approved")
      .eq("id", "tcgdex")
      .single();
    if (
      permission.error ||
      !permission.data?.enabled ||
      !permission.data.metadata_approved ||
      !permission.data.retention_approved
    )
      return Response.json({ error: "PROVIDER_NOT_APPROVED" }, { status: 403 });
    if (input.operation === "check")
      return Response.json({ ok: true, revision });
    if (input.operation === "publish") {
      const r = await db.rpc("c_publish_catalog_snapshot", {
        p_revision: input.revision,
        p_cards: input.cards,
        p_variants: input.variants,
        p_sets: input.sets,
      });
      if (r.error) throw r.error;
      return Response.json({ ok: true, coverage: r.data });
    }
    for (const row of input.rows) {
      if (
        input.table === "tcg_sets" &&
        (row.provider_id !== "tcgdex" ||
          row.metadata_source !== `TCGdex metadata source ${revision}` ||
          row.public_metadata_allowed !== false ||
          row.is_demo !== false ||
          row.enabled_for_simulation !== false ||
          row.rights_status !== "metadata_only")
      )
        throw new Error("INVALID_SET_SOURCE");
      if (
        input.table === "cards" &&
        (row.provider_id !== "tcgdex" ||
          z
            .object({ source_revision: z.literal(revision) })
            .safeParse(row.metadata).success === false)
      )
        throw new Error("INVALID_CARD_SOURCE");
      if (
        input.table === "card_variants" &&
        (row.eligible_for_packs !== false ||
          row.image_url !== null ||
          row.image_rights_cleared !== false)
      )
        throw new Error("INVALID_VARIANT_SOURCE");
    }
    const result = await db
      .from(input.table)
      .upsert(input.rows, {
        onConflict:
          input.table === "card_artist_credits" ? "card_id,artist_id" : "id",
      });
    if (result.error)
      return Response.json(
        {
          error: "IMPORT_FAILED",
          code: result.error.code,
          message: result.error.message,
        },
        { status: 409 },
      );
    return Response.json({ ok: true, imported: input.rows.length });
  } catch (e) {
    return Response.json(
      {
        error: "IMPORT_FAILED",
        message: e instanceof Error ? e.message : "Database import rejected",
      },
      { status: 400 },
    );
  }
}
