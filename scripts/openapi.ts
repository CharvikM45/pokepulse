import { writeFileSync } from "node:fs";
import { z } from "zod";
import * as c from "../packages/contracts/src";
const uuid = z.uuid();
const id = z.object({ id: uuid });
const job = z.object({ id: uuid, status: z.string() });
const models: Record<string, z.ZodType> = {
  Product: c.productRecordSchema,
  Listing: c.listingSchema,
  ProductDetail: c.detailSchema,
  Retailer: c.retailerSchema,
  Rule: c.ruleSchema,
  RuleInput: c.ruleInputSchema,
  Watch: c.watchSchema,
  WatchInput: c.watchInputSchema,
  Preferences: c.preferencesSchema,
  PreferencesPatch: c.preferencesPatchSchema,
  Notification: c.notificationSchema,
  PrivacyJob: c.privacyJobSchema,
  JobAccepted: job,
  Id: id,
  Error: c.errorResponseSchema,
  LocalSightingEvent: c.localEventSchema,
  PushInput: c.pushSubscriptionSchema,
  CollectorSets: c.setsSchema,
  CollectorCards: c.cardsSchema,
  PackOpening: c.openingSchema,
  OpeningHistory: c.historySchema,
  LabState: c.labSchema,
  CollectionSnapshot: c.inventorySchema,
  CollectionProgress: c.collectionProgressSchema,
  StoreResults: c.storesSchema,
  Sighting: c.sightingSchema,
  SightingInput: c.reportDraft,
  SightingReceipt: z.object({ id: uuid, moderation: z.literal("pending") }),
  ReviewInput: c.reviewDraft.omit({ sighting_id: true }),
  ReviewReceipt: c.reviewReceipt,
  Release: c.releaseSchema,
  ReleaseInput: c.releaseDraft,
  EditableRelease: c.editableRelease,
  MapConfiguration: c.mapSchema,
  PackInput: z
    .object({ set_id: uuid, use_free_open: z.boolean().default(false) })
    .strict(),
  RealInventoryInput: z
    .object({
      card_variant_id: uuid,
      quantity: z.number().int().min(0).max(9999),
      notes: z.string().max(500).optional(),
    })
    .strict(),
  ReviewQueue: z.object({
    reports: z.array(c.reviewSchema),
    next_cursor: z.string().nullable(),
  }),
  CollectorAdmin: z.object({
    authorized: z.literal(true),
    hosts: z.array(z.string()),
    products: z.array(z.object({ id: uuid, name: z.string() })),
    releases: z.array(c.editableRelease),
  }),
};
const spec: {
  openapi: string;
  info: Record<string, string>;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
} = {
  openapi: "3.1.0",
  info: {
    title: "PokéPulse API",
    version: "1.0.0",
    description:
      "A platform and B collector domains. Demo mode without Supabase; live sources and B feature flags default off. CONTRACT-01/02 review pending.",
  },
  paths: {},
  components: {
    schemas: Object.fromEntries(
      Object.entries(models).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema),
      ]),
    ),
    securitySchemes: {
      supabaseSession: {
        type: "apiKey",
        in: "cookie",
        name: "sb-<project>-auth-token",
        description: "Supabase SSR session cookies, verified server-side",
      },
    },
  },
};
function add(
  path: string,
  method: string,
  response: string,
  list = false,
  input?: string,
  publicRoute = false,
  status = 200,
) {
  const ref = { $ref: `#/components/schemas/${response}` };
  const dataSchema = list ? { type: "array", items: ref } : ref;
  const envelope = {
    type: "object",
    required: ["data", "meta"],
    properties: {
      data: dataSchema,
      meta: {
        type: "object",
        required: ["request_id"],
        properties: {
          request_id: { type: "string", format: "uuid" },
          next_cursor: { type: ["string", "null"] },
        },
      },
    },
  };
  const parameters: unknown[] = [];
  if (path.includes("{id}"))
    parameters.push({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  if (method === "get" && list)
    parameters.push(
      {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      {
        name: "cursor",
        in: "query",
        schema: { type: "string", format: "uuid" },
      },
    );
  if (method !== "get")
    parameters.push(
      {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "Origin",
        in: "header",
        required: true,
        schema: { type: "string" },
        description: "Must match APP_ORIGIN.",
      },
    );
  const responses: Record<string, unknown> = {
    [status]: {
      description: "Success",
      content: { "application/json": { schema: envelope } },
    },
  };
  for (const code of [400, 401, 403, 404, 409, 429, 500, 503])
    responses[code] = {
      description: "Typed safe error",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/Error" } },
      },
    };
  const operation: Record<string, unknown> = {
    summary: `${method.toUpperCase()} ${path}`,
    security: publicRoute ? [] : [{ supabaseSession: [] }],
    parameters,
    responses,
  };
  if (input)
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema:
            input === "Empty"
              ? { type: "object", additionalProperties: false }
              : { $ref: `#/components/schemas/${input}` },
        },
      },
    };
  spec.paths[path] ??= {};
  spec.paths[path][method] = operation;
}
add("/api/v1/products", "get", "Product", true, undefined, true);
add("/api/v1/drops", "get", "Listing", true, undefined, true);
add("/api/v1/retailers", "get", "Retailer", true, undefined, true);
add("/api/v1/products/{id}", "get", "ProductDetail", false, undefined, true);
for (const [path, model, input] of [
  ["watchlist", "Watch", "WatchInput"],
  ["alert-rules", "Rule", "RuleInput"],
]) {
  add("/api/v1/me/" + path, "get", model, true);
  add("/api/v1/me/" + path, "post", model, false, input);
  add("/api/v1/me/" + path, "delete", "Id", false, "Id");
}
add("/api/v1/me/alert-rules", "patch", "Rule", false, "Rule");
add("/api/v1/me/notifications", "get", "Notification", true);
add("/api/v1/me/notifications", "patch", "Notification", false, "Id");
add("/api/v1/me/preferences", "get", "Preferences");
add(
  "/api/v1/me/preferences",
  "patch",
  "Preferences",
  false,
  "PreferencesPatch",
);
add("/api/v1/me/privacy-jobs", "get", "PrivacyJob", true);
add("/api/v1/me/export", "post", "JobAccepted", false, "Empty", false, 202);
add(
  "/api/v1/me/delete-request",
  "post",
  "JobAccepted",
  false,
  "Empty",
  false,
  202,
);
add("/api/v1/me/push-subscriptions", "post", "Id", false, "PushInput");
add("/api/v1/me/push-subscriptions", "delete", "Id", false, "Id");
const query = z.toJSONSchema(c.catalogQuerySchema) as {
  properties?: Record<string, unknown>;
};
for (const path of ["/api/v1/products", "/api/v1/drops"]) {
  const get = spec.paths[path].get as { parameters: unknown[] };
  get.parameters = Object.entries(query.properties ?? {}).map(
    ([name, schema]) => ({ name, in: "query", schema }),
  );
}
const extraSchemas = {
  Session: z.object({ id: z.uuid() }),
  Export: z.record(z.string(), z.unknown()),
  Operator: z.record(z.string(), z.unknown()),
  SourceChange: z.object({
    id: z.string(),
    enabled: z.boolean().optional(),
    status: z.enum(["suspended", "denied", "candidate"]).optional(),
  }),
  SourceResult: z.object({
    id: z.string(),
    enabled: z.boolean(),
    status: z.string(),
  }),
  Flag: z.object({ name: z.string(), enabled: z.boolean() }),
  AuthInput: z.object({
    email: z.email().optional(),
    password: z.string().min(12).max(256).optional(),
  }),
  AuthAccepted: z.object({ accepted: z.boolean() }),
};
Object.assign(
  spec.components.schemas as object,
  Object.fromEntries(
    Object.entries(extraSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema),
    ]),
  ),
);
add("/api/v1/me/session", "get", "Session");
add("/api/v1/me/export/{id}", "get", "Export");
add("/api/v1/admin/sources", "get", "Operator");
add("/api/v1/admin/sources", "patch", "SourceResult", false, "SourceChange");
add("/api/v1/admin/flags", "patch", "Flag", false, "Flag");
for (const action of [
  "sign-up",
  "sign-in",
  "recover",
  "update-password",
  "sign-out",
])
  add(
    "/auth/" + action,
    "post",
    "AuthAccepted",
    false,
    "AuthInput",
    action !== "update-password",
  );
spec.paths["/auth/callback"] = {
  get: {
    summary:
      "Exchange PKCE code or verification token and redirect to a safe relative path",
    parameters: ["code", "token_hash", "type", "next"].map((name) => ({
      name,
      in: "query",
      schema: { type: "string" },
    })),
    responses: {
      303: { description: "Safe same-origin redirect" },
      401: { description: "Invalid or expired link" },
    },
  },
};
add("/api/v1/sets", "get", "CollectorSets", false, undefined, true);
add("/api/v1/sets/{id}/cards", "get", "CollectorCards", false, undefined, true);
add("/api/v1/stores", "get", "StoreResults", false, undefined, true);
add("/api/v1/stores/map", "get", "MapConfiguration", false, undefined, true);
add("/api/v1/stores/{id}/sightings", "get", "Sighting", true, undefined, true);
add(
  "/api/v1/sightings",
  "post",
  "SightingReceipt",
  false,
  "SightingInput",
  false,
  201,
);
add("/api/v1/sightings/confirm", "post", "Id", false, "Id");
add("/api/v1/admin/sightings", "get", "ReviewQueue");
add(
  "/api/v1/admin/sightings/{id}/moderate",
  "post",
  "ReviewReceipt",
  false,
  "ReviewInput",
);
add("/api/v1/admin/collector", "get", "CollectorAdmin");
add(
  "/api/v1/admin/collector/releases",
  "post",
  "EditableRelease",
  false,
  "ReleaseInput",
);
add("/api/v1/releases", "get", "Release", true, undefined, true);
add("/api/v1/packs/open", "post", "PackOpening", false, "PackInput");
add("/api/v1/me/lab", "get", "LabState");
add("/api/v1/me/pack-openings", "get", "OpeningHistory");
add("/api/v1/me/pack-openings/{id}", "get", "PackOpening");
add("/api/v1/me/collections", "get", "CollectionSnapshot");
add("/api/v1/me/collections/progress", "get", "CollectionProgress");
add("/api/v1/me/collections/real", "patch", "Id", false, "RealInventoryInput");
add("/api/v1/me/collections/missing-export", "get", "Id");
function queryParameters(
  path: string,
  fields: Record<string, unknown>,
  required: readonly string[] = [],
) {
  const operation = spec.paths[path].get as { parameters: unknown[] };
  operation.parameters = operation.parameters.filter(
    (value) => (value as { in: string }).in !== "query",
  );
  for (const [name, schema] of Object.entries(fields))
    operation.parameters.push({
      name,
      in: "query",
      schema,
      required: required.includes(name),
    });
}
const pagination = {
  limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
  cursor: { type: "string", maxLength: 512 },
};
queryParameters("/api/v1/sets", pagination);
queryParameters("/api/v1/sets/{id}/cards", {
  ...pagination,
  manifest_version: { type: "string", maxLength: 80 },
});
queryParameters(
  "/api/v1/stores",
  {
    ...pagination,
    zip: { type: "string", pattern: "^[0-9]{5}$" },
    radius_mi: { type: "integer", minimum: 1, maximum: 100 },
  },
  ["zip", "radius_mi"],
);
queryParameters("/api/v1/stores/{id}/sightings", pagination);
queryParameters("/api/v1/releases", {
  ...pagination,
  region: { type: "string", maxLength: 32 },
  event_type: { enum: ["release", "preorder", "announcement"] },
});
queryParameters(
  "/api/v1/admin/sightings",
  {
    ...pagination,
    state: { enum: ["pending", "approved", "rejected", "expired"] },
  },
  ["state"],
);
queryParameters("/api/v1/me/pack-openings", pagination);
for (const path of [
  "/api/v1/me/collections",
  "/api/v1/me/collections/progress",
  "/api/v1/me/collections/missing-export",
])
  queryParameters(
    path,
    {
      set_id: { type: "string", format: "uuid" },
      mode: { enum: ["real", "virtual"] },
      manifest_version: { type: "string", maxLength: 80 },
      ...(path.endsWith("missing-export")
        ? { goal: { enum: ["base", "master", "extended"] } }
        : {}),
    },
    ["set_id", "mode", ...(path.endsWith("missing-export") ? ["goal"] : [])],
  );
const csv = spec.paths["/api/v1/me/collections/missing-export"].get as {
  responses: Record<string, unknown>;
};
csv.responses[200] = {
  description: "Private mode/version-bound checklist",
  content: { "text/csv": { schema: { type: "string" } } },
};
writeFileSync(
  "packages/contracts/openapi.json",
  JSON.stringify(spec, null, 2) + "\n",
);
