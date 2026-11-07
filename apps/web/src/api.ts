import { z } from "zod";
import {
  errorResponseSchema,
  pageQuerySchema,
  successSchema,
} from "@pokepulse/contracts";
export function fixturePage<T extends { id: string }>(
  request: Request,
  items: T[],
  schema: z.ZodType<T>,
) {
  const request_id = crypto.randomUUID();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = pageQuerySchema.safeParse(params);
  if (!parsed.success)
    return Response.json(
      errorResponseSchema.parse({
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Use limit 1–50 and a valid cursor; unsupported filters are rejected.",
          details: {},
        },
        meta: { request_id },
      }),
      { status: 400 },
    );
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  if (
    parsed.data.cursor &&
    !sorted.some((item) => item.id === parsed.data.cursor)
  )
    return Response.json(
      errorResponseSchema.parse({
        error: {
          code: "VALIDATION_ERROR",
          message: "Unknown cursor.",
          details: {},
        },
        meta: { request_id },
      }),
      { status: 400 },
    );
  const remaining = sorted.filter(
    (item) => !parsed.data.cursor || item.id > parsed.data.cursor,
  );
  const data = remaining.slice(0, parsed.data.limit);
  return Response.json(
    successSchema(z.array(schema)).parse({
      data,
      meta: {
        request_id,
        next_cursor: remaining.length > data.length ? data.at(-1)!.id : null,
      },
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
