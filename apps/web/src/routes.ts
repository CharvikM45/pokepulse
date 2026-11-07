import "server-only";
import { z } from "zod";
import {
  catalogQuerySchema,
  catalogQuerySchema as querySchema,
  productRecordSchema,
  listingSchema,
  retailerSchema,
  detailSchema,
  successSchema,
  errorResponseSchema,
  watchInputSchema,
  watchSchema,
  ruleInputSchema,
  ruleSchema,
  notificationSchema,
  preferencesPatchSchema,
  preferencesSchema,
  pushSubscriptionSchema,
  privacyJobSchema,
} from "@pokepulse/contracts";
import {
  catalogFilter,
  listingMatches,
  safeSourceUrl,
} from "@pokepulse/domain";
import { catalogSnapshot } from "./catalog-repository";
import {
  HttpError,
  checkOrigin,
  requireSession,
  requireStaff,
  dbError,
  adminDb,
  readJsonBody,
} from "./server";
const uuid = z.uuid();
function page<T extends { id: string }>(
  values: T[],
  query: z.infer<typeof querySchema>,
) {
  const sorted = values.sort((a, b) => a.id.localeCompare(b.id));
  if (query.cursor && !sorted.some((v) => v.id === query.cursor))
    throw new HttpError("VALIDATION_ERROR", 400, "Unknown cursor.");
  const rest = sorted.filter((v) => !query.cursor || v.id > query.cursor);
  const data = rest.slice(0, query.limit);
  return { data, next: rest.length > data.length ? data.at(-1)!.id : null };
}
export async function route(request: Request): Promise<Response> {
  const request_id = crypto.randomUUID();
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
    const url = new URL(request.url);
    const path = url.pathname.slice("/api/v1/".length);
    const method = request.method;
    if (method === "GET" && ["products", "drops", "retailers"].includes(path)) {
      const q = catalogQuerySchema.parse(Object.fromEntries(url.searchParams));
      const snapshot = await catalogSnapshot();
      const products = catalogFilter(snapshot.products, snapshot.offers, q);
      if (path === "products") {
        const p = page(products, q);
        return ok(p.data, z.array(productRecordSchema), 200, p.next);
      }
      if (path === "drops") {
        const p = page(
          snapshot.offers.filter(
            (l) =>
              products.some((v) => v.id === l.product_id) &&
              listingMatches(l, q),
          ),
          q,
        );
        return ok(p.data, z.array(listingSchema), 200, p.next);
      }
      const p = page(snapshot.retailers, q);
      return ok(p.data, z.array(retailerSchema), 200, p.next);
    }
    if (method === "GET" && path.startsWith("products/")) {
      const id = uuid.parse(path.slice(9));
      const s = await catalogSnapshot();
      const product = s.products.find((p) => p.id === id);
      if (!product) throw new HttpError("NOT_FOUND", 404, "Product not found.");
      const offers = s.offers.filter((l) => l.product_id === id);
      return ok(
        {
          product,
          offers,
          history: s.history.filter((e) =>
            offers.some((l) => l.id === e.listing_id),
          ),
        },
        detailSchema,
      );
    }
    if (path.startsWith("admin/")) {
      const { db } = await requireStaff();
      if (method === "GET" && path === "admin/sources") {
        const service = adminDb();
        const tables = [
          "source_permissions",
          "source_health",
          "source_check_jobs",
          "mapping_reviews",
          "notification_deliveries",
          "feature_flags",
        ];
        const metrics = await db.rpc("operator_metrics");
        dbError(metrics.error);
        const data: Record<string, unknown> = { metrics: metrics.data };
        for (const table of tables) {
          const { data: rows, error } = await service
            .from(table)
            .select("*")
            .limit(1000);
          dbError(error);
          data[table] = rows;
        }
        return ok(data, z.record(z.string(), z.unknown()));
      }
      const body = await readBody(request);
      uuid.parse(request.headers.get("Idempotency-Key"));
      if (method === "PATCH" && path === "admin/sources") {
        const input = z
          .object({
            id: z.string().min(1),
            enabled: z.boolean().optional(),
            status: z.enum(["suspended", "denied", "candidate"]).optional(),
          })
          .strict()
          .parse(body);
        const { data, error } = await db.rpc("admin_source", {
          p_id: input.id,
          p_body: input,
        });
        dbError(error);
        return ok(
          data,
          z.object({
            id: z.string(),
            enabled: z.boolean(),
            status: z.string(),
          }),
        );
      }
      if (method === "PATCH" && path === "admin/flags") {
        const input = z
          .object({ name: z.string(), enabled: z.boolean() })
          .strict()
          .parse(body);
        const { data, error } = await db.rpc("admin_flag", {
          p_name: input.name,
          p_enabled: input.enabled,
        });
        dbError(error);
        return ok(data, z.object({ name: z.string(), enabled: z.boolean() }));
      }
      throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
    }
    if (!path.startsWith("me/"))
      throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
    const { db, user } = await requireSession();
    if (method === "GET") {
      if (path === "me/session")
        return ok({ id: user.id }, z.object({ id: uuid }));
      if (path === "me/preferences") {
        const { data, error } = await db
          .from("user_preferences")
          .select("in_app,web_push,zip,time_zone,quiet_hours,daily_cap")
          .eq("user_id", user.id)
          .single();
        dbError(error);
        return ok(data, preferencesSchema);
      }
      if (path.startsWith("me/export/")) {
        const id = uuid.parse(path.slice(10));
        const { data, error } = await db
          .from("privacy_jobs")
          .select("result,status,expires_at")
          .eq("id", id)
          .eq("user_id", user.id)
          .eq("kind", "export")
          .maybeSingle();
        dbError(error);
        if (!data) throw new HttpError("NOT_FOUND", 404, "Export not found.");
        if (
          data.status !== "completed" ||
          !data.expires_at ||
          Date.parse(data.expires_at) <= Date.now()
        )
          throw new HttpError("CONFLICT", 409, "Export not ready or expired.");
        return ok(data.result, z.record(z.string(), z.unknown()));
      }
      const config: Record<
        string,
        { table: string; fields: string; schema: z.ZodType }
      > = {
        "me/watchlist": {
          table: "watchlists",
          fields: "id,product_id,listing_id,created_at",
          schema: watchSchema,
        },
        "me/alert-rules": {
          table: "alert_rules",
          fields: "id,definition",
          schema: ruleSchema,
        },
        "me/notifications": {
          table: "notifications",
          fields:
            "id,rule_id,event_id,channel,created_at,read_at,title,body,action_url,evidence_type,observed_at",
          schema: notificationSchema,
        },
        "me/privacy-jobs": {
          table: "privacy_jobs",
          fields:
            "id,kind,status,created_at,completed_at,expires_at,error_code",
          schema: privacyJobSchema,
        },
      };
      const c = config[path];
      if (!c) throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          cursor: uuid.optional(),
        })
        .strict()
        .parse(Object.fromEntries(url.searchParams));
      let query = db
        .from(c.table)
        .select(c.fields)
        .eq("user_id", user.id)
        .order("id")
        .limit(q.limit + 1);
      if (q.cursor) query = query.gt("id", q.cursor);
      const { data, error } = await query;
      dbError(error);
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      const items = rows.slice(0, q.limit).map((r) =>
        path === "me/alert-rules"
          ? {
              ...z.record(z.string(), z.unknown()).parse(r.definition),
              id: r.id,
            }
          : r,
      );
      return ok(
        items,
        z.array(c.schema),
        200,
        rows.length > q.limit ? String(items.at(-1)!.id) : null,
      );
    }
    const body = await readBody(request),
      key = uuid.parse(request.headers.get("Idempotency-Key"));
    let operation: string;
    let value: unknown;
    let schema: z.ZodType;
    const idBody = z.object({ id: uuid }).strict();
    switch (`${method} ${path}`) {
      case "POST me/watchlist":
        operation = "watch_create";
        value = watchInputSchema.parse(body);
        schema = watchSchema;
        break;
      case "DELETE me/watchlist":
        operation = "watch_delete";
        value = idBody.parse(body);
        schema = idBody;
        break;
      case "POST me/alert-rules":
        operation = "rule_create";
        value = ruleInputSchema.parse(body);
        schema = ruleSchema;
        break;
      case "PATCH me/alert-rules":
        operation = "rule_update";
        value = ruleSchema.parse(body);
        schema = ruleSchema;
        break;
      case "DELETE me/alert-rules":
        operation = "rule_delete";
        value = idBody.parse(body);
        schema = idBody;
        break;
      case "PATCH me/notifications":
        operation = "notification_read";
        value = idBody.parse(body);
        schema = notificationSchema;
        break;
      case "PATCH me/preferences":
        operation = "preferences";
        value = preferencesPatchSchema.parse(body);
        schema = preferencesSchema;
        break;
      case "POST me/push-subscriptions": {
        operation = "push_create";
        const v = pushSubscriptionSchema.parse(body);
        safeSourceUrl(v.endpoint, [
          "fcm.googleapis.com",
          "updates.push.services.mozilla.com",
          "web.push.apple.com",
          "wns2-par02p.notify.windows.com",
        ]);
        value = v;
        schema = idBody;
        break;
      }
      case "DELETE me/push-subscriptions":
        operation = "push_delete";
        value = idBody.parse(body);
        schema = idBody;
        break;
      case "POST me/export":
        operation = "export";
        value = z.object({}).strict().parse(body);
        schema = z.object({ id: uuid, status: z.string() });
        break;
      case "POST me/delete-request":
        operation = "delete";
        value = z.object({}).strict().parse(body);
        schema = z.object({ id: uuid, status: z.string() });
        break;
      default:
        throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
    }
    const { data, error } = await db.rpc("account_write", {
      p_operation: operation,
      p_key: key,
      p_body: value,
    });
    dbError(error);
    return ok(
      data,
      schema,
      ["export", "delete"].includes(operation) ? 202 : 200,
    );
  } catch (error) {
    const known =
      error instanceof HttpError
        ? error
        : error instanceof z.ZodError
          ? new HttpError("VALIDATION_ERROR", 400, "Invalid request fields.")
          : new HttpError(
              "INTERNAL_ERROR",
              500,
              "Request could not be completed.",
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
const readBody = readJsonBody;
