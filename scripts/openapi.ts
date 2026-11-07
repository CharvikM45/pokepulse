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
};
const spec: {
  openapi: string;
  info: Record<string, string>;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
} = {
  openapi: "3.1.0",
  info: {
    title: "PokéPulse Developer A API",
    version: "1.0.0",
    description:
      "Demo mode without Supabase. No approved live source. CONTRACT-01 joint review pending.",
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
writeFileSync(
  "packages/contracts/openapi.json",
  JSON.stringify(spec, null, 2) + "\n",
);
