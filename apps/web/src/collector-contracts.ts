import { z } from "zod";
import {
  successSchema,
  errorResponseSchema,
  ApiError,
} from "@pokepulse/contracts";
export {
  uuid,
  modeSchema,
  goalSchema,
  mapSchema,
  variantSchema,
  manifestSchema,
  oddsSchema,
  setSchema,
  setsSchema,
  cardsSchema,
  openingSchema,
  summarySchema,
  historySchema,
  labSchema,
  inventorySchema,
  collectionProgressSchema,
  releaseSchema,
  releaseInput,
  editableRelease,
  releaseDraft,
  storeSchema,
  storesSchema,
  sightingSchema,
  reportDraft,
  reviewSchema,
  reviewDraft,
  reviewReceipt,
} from "@pokepulse/contracts";

export async function collectorRequest<T extends z.ZodType>(
  path: string,
  schema: T,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    signal?: AbortSignal;
  } = {},
) {
  const timeout = AbortSignal.timeout(15000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const response = await fetch(`/api/v1/${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...(options.body === undefined
      ? {}
      : {
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": options.key ?? crypto.randomUUID(),
          },
          body: JSON.stringify(options.body),
        }),
  });
  const payload: unknown = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, errorResponseSchema.parse(payload));
  return successSchema(schema).parse(payload);
}
