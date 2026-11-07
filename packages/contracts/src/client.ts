import { z } from "zod";
import { listingSchema, successSchema, errorResponseSchema } from "./schemas";
import {
  productRecordSchema,
  detailSchema,
  retailerSchema,
  ruleSchema,
  ruleInputSchema,
  watchSchema,
  watchInputSchema,
  preferencesSchema,
  preferencesPatchSchema,
  notificationSchema,
  privacyJobSchema,
  type CatalogQuery,
} from "./platform";
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly response: z.infer<typeof errorResponseSchema>,
  ) {
    super(response.error.message);
  }
}
export function createApiClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  async function request<T extends z.ZodType>(
    path: string,
    schema: T,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    const response = await fetcher(new URL(path, baseUrl), {
      method,
      credentials: "same-origin",
      headers:
        body === undefined
          ? undefined
          : {
              "Content-Type": "application/json",
              "Idempotency-Key": key ?? crypto.randomUUID(),
            },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown = await response.json();
    if (!response.ok)
      throw new ApiError(response.status, errorResponseSchema.parse(payload));
    return successSchema(schema).parse(payload);
  }
  const query = (q: Partial<CatalogQuery> = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q))
      if (v !== undefined) params.set(k, String(v));
    return params.size ? "?" + params.toString() : "";
  };
  const idResult = z.object({ id: z.uuid() });
  const jobResult = z.object({ id: z.uuid(), status: z.string() });
  return {
    products: (q?: Partial<CatalogQuery>) =>
      request("/api/v1/products" + query(q), z.array(productRecordSchema)),
    drops: (q?: Partial<CatalogQuery>) =>
      request("/api/v1/drops" + query(q), z.array(listingSchema)),
    product: (id: string) =>
      request("/api/v1/products/" + z.uuid().parse(id), detailSchema),
    retailers: (q?: Partial<CatalogQuery>) =>
      request("/api/v1/retailers" + query(q), z.array(retailerSchema)),
    watchlist: () => request("/api/v1/me/watchlist", z.array(watchSchema)),
    watch: (input: z.input<typeof watchInputSchema>, key?: string) =>
      request(
        "/api/v1/me/watchlist",
        watchSchema,
        "POST",
        watchInputSchema.parse(input),
        key,
      ),
    unwatch: (id: string, key?: string) =>
      request(
        "/api/v1/me/watchlist",
        idResult,
        "DELETE",
        { id: z.uuid().parse(id) },
        key,
      ),
    rules: () => request("/api/v1/me/alert-rules", z.array(ruleSchema)),
    createRule: (input: z.input<typeof ruleInputSchema>, key?: string) =>
      request(
        "/api/v1/me/alert-rules",
        ruleSchema,
        "POST",
        ruleInputSchema.parse(input),
        key,
      ),
    updateRule: (input: z.input<typeof ruleSchema>, key?: string) =>
      request(
        "/api/v1/me/alert-rules",
        ruleSchema,
        "PATCH",
        ruleSchema.parse(input),
        key,
      ),
    deleteRule: (id: string, key?: string) =>
      request(
        "/api/v1/me/alert-rules",
        idResult,
        "DELETE",
        { id: z.uuid().parse(id) },
        key,
      ),
    notifications: () =>
      request("/api/v1/me/notifications", z.array(notificationSchema)),
    markRead: (id: string, key?: string) =>
      request(
        "/api/v1/me/notifications",
        notificationSchema,
        "PATCH",
        { id: z.uuid().parse(id) },
        key,
      ),
    preferences: () => request("/api/v1/me/preferences", preferencesSchema),
    updatePreferences: (
      input: z.input<typeof preferencesPatchSchema>,
      key?: string,
    ) =>
      request(
        "/api/v1/me/preferences",
        preferencesSchema,
        "PATCH",
        preferencesPatchSchema.parse(input),
        key,
      ),
    requestExport: (key?: string) =>
      request("/api/v1/me/export", jobResult, "POST", {}, key),
    requestDeletion: (key?: string) =>
      request("/api/v1/me/delete-request", jobResult, "POST", {}, key),
    privacyJobs: () =>
      request("/api/v1/me/privacy-jobs", z.array(privacyJobSchema)),
    exportData: (id: string) =>
      request(
        "/api/v1/me/export/" + z.uuid().parse(id),
        z.record(z.string(), z.unknown()),
      ),
  };
}
