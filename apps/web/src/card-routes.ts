import "server-only";
import { z } from "zod";
import * as c from "@pokepulse/contracts";
import {
  adminDb,
  checkOrigin,
  configured,
  dbError,
  HttpError,
  readJsonBody,
  requireSession,
  requireStaff,
} from "./server";
import {
  cardRpc,
  searchCards,
  getCard,
  catalogCoverage,
  catalogIndex,
  encodeCardCursor,
  decodeCardCursor,
} from "./card-catalog-repository";
import { csvCell } from "../../../packages/domain/src/cards/pricing";
const indexQuery = z
  .object({
    q: z.string().max(100).default(""),
    cursor: z.string().max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(24),
  })
  .strict();
const moneyQuery = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
    statistic: z.enum(["market", "median", "low"]).default("market"),
  })
  .strict();
export async function cardRoute(request: Request) {
  const request_id = crypto.randomUUID();
  const ok = <T extends z.ZodType>(
    data: unknown,
    schema: T,
    next?: string | null,
  ) =>
    Response.json(
      c.successSchema(schema).parse({
        data,
        meta: {
          request_id,
          ...(next !== undefined ? { next_cursor: next } : {}),
        },
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  try {
    checkOrigin(request);
    const url = new URL(request.url),
      path = url.pathname.slice(8),
      method = request.method,
      query = Object.fromEntries(url.searchParams);
    if (method === "GET" && path === "cards/coverage") {
      z.object({}).strict().parse(query);
      return ok(await catalogCoverage(), c.coverageSchema);
    }
    if (method === "GET" && path === "cards") {
      const q = c.cardSearchQuery.parse(query);
      const db =
        q.ownership !== "all" ? (await requireSession()).db : undefined;
      const result = await searchCards(q, db);
      return ok(result, c.cardSearchResult, result.next_cursor);
    }
    if (method === "GET" && (path === "card-sets" || path === "artists")) {
      const q = indexQuery.parse(query);
      const result = await catalogIndex(
        path === "artists" ? "artists" : "sets",
        q.q,
        q.limit,
        q.cursor,
      );
      return ok(result, c.cardIndexResult, result.next_cursor);
    }
    const indexDetail = /^(card-sets|artists)\/([^/]+)$/.exec(path);
    if (method === "GET" && indexDetail) {
      const id = z.uuid().parse(indexDetail[2]);
      const q = c.cardSearchQuery.parse(query);
      if (indexDetail[1] === "card-sets") {
        const result = await searchCards({ ...q, set_id: id });
        return ok(
          { ...result, title: result.cards[0]?.set_name },
          c.cardSearchResult,
          result.next_cursor,
        );
      }
      if (!configured())
        throw new HttpError("NOT_FOUND", 404, "Artist not indexed.");
      const artist = await adminDb()
        .from("card_artists")
        .select("name")
        .eq("id", id)
        .maybeSingle();
      dbError(artist.error);
      if (!artist.data)
        throw new HttpError("NOT_FOUND", 404, "Artist not indexed.");
      const result = await searchCards({ ...q, artist: [artist.data.name] });
      return ok(
        {
          ...result,
          title: result.cards.length ? artist.data.name : undefined,
        },
        c.cardSearchResult,
        result.next_cursor,
      );
    }
    const detail = /^cards\/([^/]+)$/.exec(path);
    if (method === "GET" && detail) {
      z.object({}).strict().parse(query);
      return ok(await getCard(detail[1]), c.singleCardSchema);
    }
    const prices = /^cards\/([^/]+)\/prices$/.exec(path);
    if (method === "GET" && prices) {
      const q = z
        .object({
          variant: z.uuid(),
          range: z.enum(["7D", "30D", "90D", "1Y", "ALL"]).default("30D"),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .default("USD"),
          statistic: z.enum(["market", "median", "low"]).default("market"),
          condition: z.enum(c.cardConditions).default("unknown"),
          grading_company: z.string().max(40).default(""),
          grade: z.string().max(20).default(""),
          provider: z.string().max(40).optional(),
          cursor: z.string().max(4096).optional(),
          limit: z.coerce.number().int().min(1).max(366).default(100),
        })
        .strict()
        .parse(query);
      const card = await getCard(prices[1]);
      if (!card.variants.some((v) => v.id === q.variant))
        throw new HttpError(
          "NOT_FOUND",
          404,
          "Printing and variant do not match.",
        );
      const { cursor, ...identity } = q;
      const after = decodeCardCursor(
        cursor,
        z.object({
          time: z.string(),
          id: z.uuid(),
          query: z.literal(JSON.stringify(identity)),
        }),
      );
      const days = { "7D": 7, "30D": 30, "90D": 90, "1Y": 365, ALL: 36500 }[
        q.range
      ];
      const result = c.pricesSchema
        .extend({
          next: z.object({ time: z.string(), id: z.uuid() }).nullable(),
        })
        .parse(
          await cardRpc(adminDb(), "c_price_history", {
            p_variant: q.variant,
            p_currency: q.currency,
            p_statistic: q.statistic,
            p_condition: q.condition,
            p_company: q.grading_company,
            p_grade: q.grade,
            p_provider: q.provider ?? null,
            p_since: new Date(Date.now() - days * 86400000).toISOString(),
            p_limit: q.limit,
            p_after: after ? { time: after.time, id: after.id } : null,
          }),
        );
      const next = result.next
        ? encodeCardCursor({ ...result.next, query: JSON.stringify(identity) })
        : null;
      return ok({ ...result, next_cursor: next }, c.pricesSchema, next);
    }
    if (path === "admin/card-catalog") {
      await requireStaff();
      if (method !== "GET")
        throw new HttpError("NOT_FOUND", 404, "Route not found.");
      z.object({}).strict().parse(query);
      const [providers, runs, coverage] = await Promise.all([
        adminDb()
          .from("card_provider_permissions")
          .select(
            "id,enabled,metadata_approved,artwork_approved,pricing_approved,retention_approved,evidence_url,reviewer,checked_at",
          ),
        adminDb()
          .from("card_sync_runs")
          .select(
            "id,provider_id,language,status,checkpoint,added,updated,skipped,errors,started_at,finished_at",
          )
          .order("started_at", { ascending: false })
          .limit(20),
        catalogCoverage(),
      ]);
      dbError(providers.error);
      dbError(runs.error);
      return ok(
        { providers: providers.data, runs: runs.data, coverage },
        z.object({
          providers: z.array(z.record(z.string(), z.unknown())),
          runs: z.array(z.record(z.string(), z.unknown())),
          coverage: c.coverageSchema,
        }),
      );
    }
    const { db, user } = await requireSession();
    if (method === "GET" && path === "me/card-holdings") {
      const q = z.object({ card_id: z.uuid() }).strict().parse(query);
      const variants = await adminDb()
        .from("card_variants")
        .select("id")
        .eq("card_id", q.card_id)
        .order("id")
        .limit(101);
      dbError(variants.error);
      if ((variants.data?.length ?? 0) > 100)
        throw new HttpError(
          "SOURCE_UNAVAILABLE",
          503,
          "Too many variants for the holdings view.",
        );
      const ids = (variants.data ?? []).map((v) => v.id);
      if (!ids.length)
        return ok(
          { physical: [], virtual: [], lots: [] },
          z.object({
            physical: z.array(
              z.object({ card_variant_id: z.uuid(), quantity: z.number() }),
            ),
            virtual: z.array(
              z.object({ card_variant_id: z.uuid(), quantity: z.number() }),
            ),
            lots: z.array(c.lotSchema),
          }),
        );
      const [real, virtual, lots] = await Promise.all([
        db
          .from("real_inventory")
          .select("card_variant_id,quantity")
          .eq("user_id", user.id)
          .in("card_variant_id", ids),
        db
          .from("virtual_inventory")
          .select("card_variant_id,quantity")
          .eq("user_id", user.id)
          .in("card_variant_id", ids),
        db
          .from("physical_copy_lots")
          .select("*")
          .eq("user_id", user.id)
          .in("variant_id", ids)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      dbError(real.error);
      dbError(virtual.error);
      dbError(lots.error);
      return ok(
        {
          physical: real.data ?? [],
          virtual: virtual.data ?? [],
          lots: lots.data ?? [],
        },
        z.object({
          physical: z.array(
            z.object({ card_variant_id: z.uuid(), quantity: z.number() }),
          ),
          virtual: z.array(
            z.object({ card_variant_id: z.uuid(), quantity: z.number() }),
          ),
          lots: z.array(c.lotSchema),
        }),
      );
    }
    if (method === "GET" && path === "me/portfolio") {
      const q = moneyQuery.parse(query);
      return ok(
        await cardRpc(db, "c_portfolio", {
          p_currency: q.currency,
          p_statistic: q.statistic,
        }),
        c.portfolioSchema,
      );
    }
    if (method === "GET" && path === "me/card-actions") {
      const q = z.object({ card_id: z.uuid() }).strict().parse(query);
      const result = await db
        .from("card_actions")
        .select("card_id,kind")
        .eq("user_id", user.id)
        .eq("card_id", q.card_id);
      dbError(result.error);
      return ok(
        result.data ?? [],
        z.array(
          z.object({
            card_id: z.uuid(),
            kind: z.enum(["favorite", "wishlist"]),
          }),
        ),
      );
    }
    if (method === "GET" && path === "me/collection-lots") {
      const q = z
        .object({
          cursor: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .strict()
        .parse(query);
      let sql = db
        .from("physical_copy_lots")
        .select("*")
        .eq("user_id", user.id)
        .order("id")
        .limit(q.limit + 1);
      if (q.cursor) sql = sql.gt("id", q.cursor);
      const result = await sql;
      dbError(result.error);
      const rows = z.array(c.lotSchema).parse(result.data ?? []);
      return ok(
        rows.slice(0, q.limit),
        z.array(c.lotSchema),
        rows.length > q.limit ? rows[q.limit - 1].id : null,
      );
    }
    if (method === "GET" && path === "me/collection-export") {
      z.object({}).strict().parse(query);
      const header = [
        "id",
        "variant_id",
        "quantity",
        "condition",
        "grading_company",
        "grade",
        "acquired_on",
        "cost_minor",
        "currency",
        "notes",
        "binder",
        "page",
        "position",
      ] as const;
      const rows = [header.map(csvCell).join(",")];
      let after: string | undefined;
      for (let page = 0; page < 1000; page++) {
        let sql = db
          .from("physical_copy_lots")
          .select("*")
          .eq("user_id", user.id)
          .order("id")
          .limit(100);
        if (after) sql = sql.gt("id", after);
        const result = await sql;
        dbError(result.error);
        const data = z.array(c.lotSchema).parse(result.data ?? []);
        rows.push(
          ...data.map((row) => header.map((k) => csvCell(row[k])).join(",")),
        );
        if (data.length < 100) break;
        after = data.at(-1)!.id;
        if (page === 999)
          throw new HttpError(
            "SOURCE_UNAVAILABLE",
            503,
            "Export exceeds synchronous limit; use your account data export.",
          );
      }
      return new Response(rows.join("\r\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            "attachment; filename=physical-collection-lots.csv",
          "Cache-Control": "private, no-store",
        },
      });
    }
    const key = z.uuid().parse(request.headers.get("Idempotency-Key"));
    if (method === "POST" && path === "me/portfolio/snapshots") {
      const q = moneyQuery.parse(await readJsonBody(request));
      return ok(
        await cardRpc(db, "c_capture_portfolio", {
          p_key: key,
          p_currency: q.currency,
          p_statistic: q.statistic,
        }),
        z.object({ id: z.uuid() }),
      );
    }
    const action = /^me\/card-actions\/(favorite|wishlist)$/.exec(path);
    if (method === "POST" && action) {
      const body = c.actionInputSchema.parse(await readJsonBody(request));
      return ok(
        await cardRpc(db, "c_collection_write", {
          p_operation: action[1],
          p_key: key,
          p_input: body,
        }),
        z.object({ id: z.uuid() }),
      );
    }
    if (path === "me/collection-lots" && method === "POST") {
      const body = c.lotInputSchema.parse(await readJsonBody(request));
      return ok(
        await cardRpc(db, "c_collection_write", {
          p_operation: "lot_add",
          p_key: key,
          p_input: body,
        }),
        z.object({ id: z.uuid() }),
      );
    }
    const lot = /^me\/collection-lots\/([^/]+)$/.exec(path);
    if (lot && (method === "PATCH" || method === "DELETE")) {
      const id = z.uuid().parse(lot[1]);
      const body =
        method === "DELETE"
          ? { id }
          : { ...c.lotInputSchema.parse(await readJsonBody(request)), id };
      return ok(
        await cardRpc(db, "c_collection_write", {
          p_operation: method === "DELETE" ? "lot_delete" : "lot_update",
          p_key: key,
          p_input: body,
        }),
        z.object({ id: z.uuid() }),
      );
    }
    if (path === "me/collection-import" && method === "POST") {
      const raw = z
        .object({
          mode: z.enum(["add", "update"]).default("add"),
          lots: z.array(z.unknown()).min(1).max(100),
        })
        .strict()
        .parse(await readJsonBody(request, 32000));
      const lots = raw.lots.map((l) =>
        raw.mode === "update"
          ? c.lotInputSchema.safeExtend({ id: z.uuid() }).parse(l)
          : c.lotInputSchema.parse(l),
      );
      return ok(
        await cardRpc(db, "c_collection_write", {
          p_operation: raw.mode === "update" ? "bulk_update" : "bulk_add",
          p_key: key,
          p_input: { lots },
        }),
        z.object({ id: z.uuid() }),
      );
    }
    throw new HttpError("NOT_FOUND", 404, "Route not found.");
  } catch (error) {
    const known = error instanceof HttpError;
    const validation = error instanceof z.ZodError;
    const status = known ? error.status : validation ? 400 : 500;
    return Response.json(
      c.errorResponseSchema.parse({
        error: {
          code: known
            ? error.code
            : validation
              ? "VALIDATION_ERROR"
              : "INTERNAL_ERROR",
          message: known
            ? error.message
            : validation
              ? "Invalid card request."
              : "Card request could not be completed.",
          details: {},
        },
        meta: { request_id },
      }),
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
