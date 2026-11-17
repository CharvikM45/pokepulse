import "server-only";
import { z } from "zod";
import { adminDb, configured, dbError, HttpError } from "./server";
import {
  cardSearchQuery,
  singleCardSchema,
  coverageSchema,
  cardIndexResult,
} from "@pokepulse/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
export const encodeCardCursor = (v: unknown) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");
export function decodeCardCursor<T extends z.ZodType>(
  value: string | undefined,
  schema: T,
): z.infer<T> | null {
  if (!value) return null;
  try {
    return schema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new HttpError(
      "VALIDATION_ERROR",
      400,
      "Invalid or mismatched cursor.",
    );
  }
}
export async function cardRpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const r = await db.rpc(name, args);
  if (r.error?.message.startsWith("CONFLICT:"))
    throw new HttpError(
      "CONFLICT",
      409,
      "Account changes are paused or the request conflicts.",
    );
  dbError(r.error);
  return r.data;
}
export async function searchCards(
  query: z.infer<typeof cardSearchQuery>,
  db?: SupabaseClient,
) {
  const { limit, cursor, ...filters } = query;
  const identity = JSON.stringify(filters);
  const after = decodeCardCursor(
    cursor,
    z.object({
      key: z.string().max(300),
      id: z.uuid(),
      query: z.literal(identity),
    }),
  );
  if (!configured()) return { cards: [], next_cursor: null };
  const result = z
    .object({
      cards: z.array(singleCardSchema),
      next: z.object({ key: z.string(), id: z.uuid() }).nullable(),
    })
    .parse(
      await cardRpc(db ?? adminDb(), "c_search_cards", {
        p_filters: filters,
        p_limit: limit,
        p_after: after ? { key: after.key, id: after.id } : null,
      }),
    );
  return {
    cards: result.cards,
    next_cursor: result.next
      ? encodeCardCursor({ ...result.next, query: identity })
      : null,
  };
}
export async function getCard(id: string) {
  z.uuid().parse(id);
  if (!configured())
    throw new HttpError(
      "NOT_FOUND",
      404,
      "No approved card record is indexed.",
    );
  const result = await cardRpc(adminDb(), "c_card_json", { p_id: id });
  if (!result)
    throw new HttpError(
      "NOT_FOUND",
      404,
      "Card metadata is unavailable or its permission was revoked.",
    );
  return singleCardSchema.parse(result);
}
export async function catalogCoverage() {
  if (!configured())
    return coverageSchema.parse({
      printings: 0,
      variants: 0,
      sets: 0,
      artists: 0,
      languages: [],
      approved_providers: [],
      art_enabled: false,
      measured_at: new Date().toISOString(),
    });
  return coverageSchema.parse(await cardRpc(adminDb(), "c_catalog_coverage"));
}
export async function catalogIndex(
  kind: "sets" | "artists",
  q: string,
  limit: number,
  cursor?: string,
) {
  const identity = JSON.stringify([kind, q]);
  const after = decodeCardCursor(
    cursor,
    z.object({ id: z.uuid(), query: z.literal(identity) }),
  );
  if (!configured()) return { entries: [], next_cursor: null };
  const result = cardIndexResult.extend({ next: z.uuid().nullable() }).parse(
    await cardRpc(adminDb(), "c_catalog_index", {
      p_kind: kind,
      p_q: q,
      p_after: after?.id ?? null,
      p_limit: limit,
    }),
  );
  return {
    entries: result.entries,
    next_cursor: result.next
      ? encodeCardCursor({ id: result.next, query: identity })
      : null,
  };
}
