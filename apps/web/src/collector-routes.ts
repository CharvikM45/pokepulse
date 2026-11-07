import "server-only";
import { z } from "zod";
import { successSchema, errorResponseSchema } from "@pokepulse/contracts";
import {
  adminDb,
  checkOrigin,
  dbError,
  HttpError,
  readJsonBody,
  requireSession,
  requireStaff,
} from "./server";
import * as c from "./collector-contracts";
import {
  allRows,
  cardCatalog,
  flag,
  savedOpening,
  setCatalog,
} from "./collector-repository";
import { missingCsv } from "../../../packages/domain/src/collections/policies";

const pageQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
function cursor<T extends z.ZodType>(
  value: string | undefined,
  schema: T,
): z.infer<T> | null {
  if (!value) return null;
  try {
    return schema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new HttpError("VALIDATION_ERROR", 400, "Invalid cursor.");
  }
}
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
async function rpc(
  db: ReturnType<typeof adminDb>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await db.rpc(name, args);
  if (result.error) {
    const message = result.error.message;
    if (message === "CONFLICT:DELETION_PENDING")
      throw new HttpError(
        "CONFLICT",
        409,
        "Account deletion is pending. New changes are paused.",
      );
    if (message.startsWith("CONFLICT:"))
      throw new HttpError(
        "CONFLICT",
        409,
        message.includes("INSUFFICIENT")
          ? "Insufficient free coins."
          : "Today's free opening is unavailable.",
      );
    if (["INCOMPLETE_MANIFEST", "INCOMPLETE_GOAL"].includes(message))
      throw new HttpError(
        "CONFLICT",
        409,
        "Collection scope is incomplete or unpublished.",
      );
    if (message === "SOURCE_UNAVAILABLE")
      throw new HttpError(
        "SOURCE_UNAVAILABLE",
        503,
        "This source or feature is currently unavailable.",
      );
    dbError(result.error);
  }
  return result.data;
}
async function openingHistory(userId: string, after?: string, limit = 20) {
  let query = adminDb()
    .from("pack_openings")
    .select("id,set_id,opened_at,odds_id")
    .eq("user_id", userId)
    .order("id")
    .limit(limit + 1);
  if (after) query = query.gt("id", c.uuid.parse(after));
  const { data, error } = await query;
  dbError(error);
  const sets = await allRows("tcg_sets", "id,name"),
    odds = await allRows("pack_odds_versions", "id,version");
  const rows = data ?? [];
  return c.historySchema.parse({
    openings: rows.slice(0, limit).map((row) => ({
      id: row.id,
      set_name: sets.find((s) => s.id === row.set_id)?.name,
      opened_at_label: row.opened_at,
      odds_version: odds.find((o) => o.id === row.odds_id)?.version,
    })),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  });
}
export async function collectorRoute(request: Request): Promise<Response> {
  const request_id = crypto.randomUUID();
  let packWriteAttempted = false;
  const ok = <T extends z.ZodType>(
    data: unknown,
    schema: T,
    status = 200,
    next?: string | null,
  ) =>
    Response.json(
      successSchema(schema).parse({
        data,
        meta: {
          request_id,
          ...(next !== undefined ? { next_cursor: next } : {}),
        },
      }),
      { status, headers: { "Cache-Control": "no-store" } },
    );
  try {
    checkOrigin(request);
    const url = new URL(request.url),
      path = url.pathname.slice("/api/v1/".length),
      method = request.method;
    const query = Object.fromEntries(url.searchParams);
    if (method === "GET" && path === "stores/map") {
      z.object({}).strict().parse(query);
      const template = process.env.MAP_TILES_URL_TEMPLATE,
        attribution = process.env.MAP_TILES_ATTRIBUTION,
        host = process.env.MAP_TILES_ALLOWED_HOST;
      let enabled = false;
      if (
        process.env.MAP_TILES_APPROVED === "true" &&
        template &&
        attribution &&
        host &&
        attribution.length <= 500 &&
        !/[<>]/.test(attribution)
      ) {
        try {
          const tile = new URL(template);
          enabled =
            tile.protocol === "https:" &&
            !tile.username &&
            !tile.password &&
            !tile.port &&
            tile.hostname === host &&
            !/^(localhost|127\.|10\.|192\.168\.|\[)/.test(host) &&
            ["{z}", "{x}", "{y}"].every((part) => template.includes(part)) &&
            (await flag("local_radar"));
        } catch {
          enabled = false;
        }
      }
      return ok(
        { enabled, config: enabled ? { template, attribution, host } : null },
        c.mapSchema,
      );
    }
    if (method === "GET" && path === "sets") {
      const q = pageQuery
        .extend({ cursor: c.uuid.optional() })
        .strict()
        .parse(query);
      const result = await setCatalog(q.limit, q.cursor);
      return ok(result, c.setsSchema, 200, result.next_cursor);
    }
    const cardPath = /^sets\/([^/]+)\/cards$/.exec(path);
    if (method === "GET" && cardPath) {
      const q = pageQuery
        .extend({
          cursor: c.uuid.optional(),
          manifest_version: z.string().max(80).optional(),
        })
        .strict()
        .parse(query);
      const catalog = await cardCatalog(
        c.uuid.parse(cardPath[1]),
        q.manifest_version,
      );
      const sorted = [...catalog.variants].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      if (q.cursor && !sorted.some((v) => v.id === q.cursor))
        throw new HttpError("VALIDATION_ERROR", 400, "Unknown card cursor.");
      const rest = sorted.filter((v) => !q.cursor || v.id > q.cursor),
        items = rest.slice(0, q.limit);
      return ok(
        {
          ...catalog,
          variants: items,
          manifest: q.cursor ? null : catalog.manifest,
        },
        c.cardsSchema,
        200,
        rest.length > q.limit ? items.at(-1)!.id : null,
      );
    }
    if (method === "GET" && path === "stores") {
      const q = pageQuery
        .extend({
          zip: z.string().regex(/^\d{5}$/),
          radius_mi: z.coerce.number().int().min(1).max(100),
        })
        .strict()
        .parse(query);
      const after = cursor(
        q.cursor,
        z.object({
          zip: z.literal(q.zip),
          radius: z.literal(q.radius_mi),
          distance: z.number().int().nonnegative(),
          id: c.uuid,
        }),
      );
      const rows = z
        .array(c.storeSchema.extend({ zip: z.string().nullable() }))
        .parse(
          await rpc(adminDb(), "b_nearby_stores", {
            p_zip: q.zip,
            p_radius_mi: q.radius_mi,
            p_limit: q.limit,
            p_after_distance_milli: after?.distance ?? null,
            p_after_id: after?.id ?? null,
          }),
        );
      const last = rows.at(-1),
        next =
          rows.length === q.limit && last
            ? encode({
                zip: q.zip,
                radius: q.radius_mi,
                distance: Math.round((last.distance_mi ?? 0) * 1000),
                id: last.id,
              })
            : null;
      return ok({ stores: rows, next_cursor: next }, c.storesSchema);
    }
    const sightingsPath = /^stores\/([^/]+)\/sightings$/.exec(path);
    if (method === "GET" && sightingsPath) {
      const id = c.uuid.parse(sightingsPath[1]),
        q = pageQuery.strict().parse(query);
      const after = cursor(
        q.cursor,
        z.object({ store: z.literal(id), observed: z.string(), id: c.uuid }),
      );
      const rows = z.array(c.sightingSchema).parse(
        await rpc(adminDb(), "b_public_sightings", {
          p_store_id: id,
          p_limit: q.limit,
          p_before_observed: after?.observed ?? null,
          p_before_id: after?.id ?? null,
        }),
      );
      const last = rows.at(-1);
      return ok(
        rows,
        z.array(c.sightingSchema),
        200,
        rows.length === q.limit && last
          ? encode({ store: id, observed: last.observed_at, id: last.id })
          : null,
      );
    }
    if (method === "GET" && path === "releases") {
      const q = pageQuery
        .extend({
          region: z.string().max(32).optional(),
          event_type: z
            .enum(["release", "preorder", "announcement"])
            .optional(),
        })
        .strict()
        .parse(query);
      const after = cursor(
        q.cursor,
        z.object({
          region: z.literal(q.region ?? ""),
          type: z.literal(q.event_type ?? ""),
          date: z.string().nullable(),
          id: c.uuid,
        }),
      );
      const rows = z.array(c.releaseSchema).parse(
        await rpc(adminDb(), "b_public_releases", {
          p_region: q.region ?? null,
          p_event_type: q.event_type ?? null,
          p_limit: q.limit,
          p_after_date: after?.date ?? null,
          p_after_id: after?.id ?? null,
        }),
      );
      const last = rows.at(-1);
      return ok(
        rows,
        z.array(c.releaseSchema),
        200,
        rows.length === q.limit && last
          ? encode({
              region: q.region ?? "",
              type: q.event_type ?? "",
              date: last.date,
              id: last.id,
            })
          : null,
      );
    }
    const moderatePath = /^admin\/sightings\/([^/]+)\/moderate$/.exec(path);
    if (
      path.startsWith("admin/collector") ||
      path === "admin/sightings" ||
      moderatePath
    ) {
      const { db, user } = await requireStaff();
      if (method === "GET" && path === "admin/collector") {
        z.object({}).strict().parse(query);
        const hosts = await allRows(
          "b_release_source_hosts",
          "host",
          { approved: true },
          "host",
        );
        const products = await allRows("products", "id,name");
        const releases = await allRows(
          "releases",
          "id,product_id,name,release_date,date_precision,event_type,region,source_url,verified_at,is_demo,status,revision",
        );
        return ok(
          {
            authorized: true,
            hosts: hosts.map((h) => h.host),
            products,
            releases: releases.map((r) => ({ ...r, date: r.release_date })),
          },
          z.object({
            authorized: z.literal(true),
            hosts: z.array(z.string()),
            products: z.array(z.object({ id: c.uuid, name: z.string() })),
            releases: z.array(c.editableRelease),
          }),
        );
      }
      if (method === "GET" && path === "admin/sightings") {
        const q = pageQuery
          .extend({
            state: z.enum(["pending", "approved", "rejected", "expired"]),
          })
          .strict()
          .parse(query);
        let request = db
          .from("sightings")
          .select(
            "id,store_id,product_id,reporter_id,report_type,moderation,observed_at,expires_at,private_notes,public_notes,is_demo,revision",
          )
          .eq("moderation", q.state)
          .order("id")
          .limit(q.limit + 1);
        if (q.cursor) request = request.gt("id", c.uuid.parse(q.cursor));
        const { data, error } = await request;
        dbError(error);
        const stores = await allRows("stores", "id,name"),
          products = await allRows("products", "id,name");
        const rows = data ?? [];
        return ok(
          {
            reports: rows.slice(0, q.limit).map((row) => ({
              ...row,
              store_name:
                stores.find((s) => s.id === row.store_id)?.name ??
                "Unknown store",
              product_name:
                products.find((p) => p.id === row.product_id)?.name ?? null,
              submitted_by_current_staff: row.reporter_id === user.id,
            })),
            next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
          },
          z.object({
            reports: z.array(c.reviewSchema),
            next_cursor: z.string().nullable(),
          }),
        );
      }
      const key = c.uuid.parse(request.headers.get("Idempotency-Key"));
      if (method === "POST" && moderatePath) {
        const body = {
          ...c.reviewDraft
            .omit({ sighting_id: true })
            .strict()
            .parse(await readJsonBody(request)),
          sighting_id: c.uuid.parse(moderatePath[1]),
        };
        return ok(
          await rpc(db, "b_moderate_sighting", {
            p_sighting_id: body.sighting_id,
            p_decision: body.decision,
            p_reason: body.reason,
            p_public_notes: body.public_notes,
            p_idempotency_key: key,
            p_expected_revision: body.expected_revision,
          }),
          c.reviewReceipt,
        );
      }
      if (method === "POST" && path === "admin/collector/releases") {
        const body = c.releaseDraft.parse(await readJsonBody(request));
        const receipt = z
          .object({ id: c.uuid })
          .passthrough()
          .parse(
            await rpc(db, "b_curate_release", {
              p_release_id: body.release_id,
              p_expected_revision: body.expected_revision,
              p_input: body.entry,
              p_reason: body.reason,
              p_idempotency_key: key,
            }),
          );
        const { data, error } = await adminDb()
          .from("releases")
          .select("*")
          .eq("id", receipt.id)
          .single();
        dbError(error);
        return ok({ ...data, date: data?.release_date }, c.editableRelease);
      }
      throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
    }
    const { db, user } = await requireSession();
    if (method === "GET" && path === "me/lab") {
      z.object({}).strict().parse(query);
      const wallet = await db
        .from("wallets")
        .select("balance,last_free_date")
        .eq("user_id", user.id)
        .maybeSingle();
      dbError(wallet.error);
      const settings = await adminDb()
        .from("b_pack_settings")
        .select("welcome_coins,daily_free_enabled")
        .single();
      dbError(settings.error);
      const history = await openingHistory(user.id);
      return ok(
        {
          balance: wallet.data?.balance ?? 0,
          welcome_grant_on_first_open: wallet.data
            ? 0
            : (settings.data?.welcome_coins ?? 0),
          free_open_available:
            settings.data?.daily_free_enabled === true &&
            (!wallet.data?.last_free_date ||
              wallet.data.last_free_date <
                new Date().toISOString().slice(0, 10)),
          allowance_note:
            "Optional free opening resets at 00:00 UTC. Coins are free, have no cash value and cannot be purchased.",
          history: history.openings,
          next_cursor: history.next_cursor,
        },
        c.labSchema,
      );
    }
    if (method === "GET" && path === "me/pack-openings") {
      const q = pageQuery.strict().parse(query);
      return ok(
        await openingHistory(user.id, q.cursor, q.limit),
        c.historySchema,
      );
    }
    const openingPath = /^me\/pack-openings\/([^/]+)$/.exec(path);
    if (method === "GET" && openingPath)
      return ok(
        await savedOpening(user.id, c.uuid.parse(openingPath[1])),
        c.openingSchema,
      );
    if (
      method === "GET" &&
      [
        "me/collections",
        "me/collections/progress",
        "me/collections/missing-export",
      ].includes(path)
    ) {
      const q = z
        .object({
          set_id: c.uuid,
          mode: c.modeSchema,
          manifest_version: z.string().max(80).optional(),
          goal: c.goalSchema.optional(),
        })
        .strict()
        .parse(query);
      const catalog = await cardCatalog(q.set_id, q.manifest_version);
      if (!catalog.manifest)
        throw new HttpError("CONFLICT", 409, "Manifest is incomplete.");
      const snapshot = c.inventorySchema.parse(
        await rpc(db, "b_collection_snapshot", {
          p_set_id: q.set_id,
          p_manifest_version: catalog.manifest.version,
          p_mode: q.mode,
        }),
      );
      if (path === "me/collections") return ok(snapshot, c.inventorySchema);
      if (path.endsWith("progress"))
        return ok(snapshot.progress, c.collectionProgressSchema);
      if (!q.goal)
        throw new HttpError(
          "VALIDATION_ERROR",
          400,
          "Choose a collection goal.",
        );
      const text = missingCsv(
        q.goal,
        catalog.manifest,
        catalog.variants,
        snapshot.entries,
        q.mode,
      );
      return new Response(text, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="pokepulse-missing.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }
    const key = c.uuid.parse(request.headers.get("Idempotency-Key"));
    if (method === "POST" && path === "packs/open") {
      const body = z
        .object({ set_id: c.uuid, use_free_open: z.boolean().default(false) })
        .strict()
        .parse(await readJsonBody(request));
      packWriteAttempted = true;
      const result = z
        .object({ id: c.uuid })
        .passthrough()
        .parse(
          await rpc(db, "b_open_pack", {
            p_set_id: body.set_id,
            p_idempotency_key: key,
            p_use_free_open: body.use_free_open,
          }),
        );
      return ok(await savedOpening(user.id, result.id), c.openingSchema);
    }
    if (method === "PATCH" && path === "me/collections/real") {
      const body = z
        .object({
          card_variant_id: c.uuid,
          quantity: z.number().int().min(0).max(9999),
          notes: z.string().max(500).optional(),
        })
        .strict()
        .parse(await readJsonBody(request));
      await rpc(db, "b_save_real_inventory", {
        p_variant_id: body.card_variant_id,
        p_quantity: body.quantity,
        p_notes: body.notes ?? null,
        p_idempotency_key: key,
      });
      return ok({ id: body.card_variant_id }, z.object({ id: c.uuid }));
    }
    if (method === "POST" && path === "sightings") {
      const body = c.reportDraft.parse(await readJsonBody(request));
      return ok(
        await rpc(db, "b_submit_sighting", {
          p_store_id: body.store_id,
          p_product_id: body.product_id,
          p_report_type: body.report_type,
          p_observed_at: body.observed_at,
          p_notes: body.notes,
          p_idempotency_key: key,
        }),
        z
          .object({ id: c.uuid, moderation: z.literal("pending") })
          .passthrough(),
        201,
      );
    }
    if (method === "POST" && path === "sightings/confirm") {
      const body = z
        .object({ id: c.uuid })
        .strict()
        .parse(await readJsonBody(request));
      await rpc(db, "b_confirm_sighting", { p_sighting_id: body.id });
      return ok(body, z.object({ id: c.uuid }));
    }
    throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
  } catch (error) {
    const known =
      error instanceof HttpError
        ? error
        : error instanceof z.ZodError && !packWriteAttempted
          ? new HttpError(
              "VALIDATION_ERROR",
              400,
              "Invalid request fields or response data.",
            )
          : new HttpError(
              "INTERNAL_ERROR",
              500,
              "Request could not be completed. Retry with the same request key if the result is uncertain.",
            );
    return Response.json(
      errorResponseSchema.parse({
        error: { code: known.code, message: known.message, details: {} },
        meta: { request_id },
      }),
      {
        status: known.status,
        headers: {
          "Cache-Control": "no-store",
          ...(known.status === 429 ? { "Retry-After": "60" } : {}),
        },
      },
    );
  }
}
