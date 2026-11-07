import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
export class HttpError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function configured() {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
export function adminDb() {
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new HttpError(
      "SOURCE_UNAVAILABLE",
      503,
      "Database is not configured.",
    );
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function sessionDb() {
  if (!configured())
    throw new HttpError(
      "SOURCE_UNAVAILABLE",
      503,
      "Authentication is not configured.",
    );
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll(values) {
          for (const { name, value, options } of values)
            jar.set(name, value, options);
        },
      },
    },
  );
}
export async function requireSession() {
  if (!configured())
    throw new HttpError("UNAUTHENTICATED", 401, "Sign in required.");
  const db = await sessionDb();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    throw new HttpError("UNAUTHENTICATED", 401, "Sign in required.");
  return { db, user: data.user };
}
export async function requireStaff() {
  const session = await requireSession();
  const { data, error } = await session.db.rpc("is_staff");
  if (error || data !== true)
    throw new HttpError("FORBIDDEN", 403, "Staff access required.");
  return session;
}
export function safeRedirect(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n]/.test(value)
  )
    return "/";
  return value;
}
export function checkOrigin(request: Request) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const expected = process.env.APP_ORIGIN ?? new URL(request.url).origin;
    if (origin !== expected)
      throw new HttpError("FORBIDDEN", 403, "Same-origin request required.");
  }
}
export function dbError(error: { message: string; code?: string } | null) {
  if (!error) return;
  const codes: Record<string, number> = {
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    RATE_LIMITED: 429,
    VALIDATION_ERROR: 400,
    RIGHTS_DISABLED: 403,
  };
  for (const [code, status] of Object.entries(codes))
    if (error.message === code)
      throw new HttpError(
        code,
        status,
        code.replaceAll("_", " ").toLowerCase(),
      );
  if (["23503", "23514", "22P02", "23502"].includes(error.code ?? ""))
    throw new HttpError("VALIDATION_ERROR", 400, "Invalid request.");
  throw new HttpError("INTERNAL_ERROR", 500, "Request could not be completed.");
}
export async function readJsonBody(
  request: Request,
  maxBytes = 16384,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError("VALIDATION_ERROR", 400, "JSON body required.");
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError("VALIDATION_ERROR", 400, "JSON body required.");
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError("VALIDATION_ERROR", 400, "Body too large.");
    }
    text += decoder.decode(part.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError("VALIDATION_ERROR", 400, "Malformed JSON.");
  }
}
