import { createHash } from "node:crypto";
import { z } from "zod";
import { type EmailOtpType } from "@supabase/supabase-js";
import { successSchema, errorResponseSchema } from "@pokepulse/contracts";
import {
  sessionDb,
  checkOrigin,
  safeRedirect,
  HttpError,
  adminDb,
  dbError,
  requireSession,
  readJsonBody,
} from "../../../src/server";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const request_id = crypto.randomUUID();
  try {
    const { action } = await params;
    const url = new URL(request.url);
    const db = await sessionDb();
    if (request.method === "GET" && action === "callback") {
      const next = safeRedirect(url.searchParams.get("next"));
      const code = url.searchParams.get("code");
      const token = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type");
      let error;
      if (code) {
        ({ error } = await db.auth.exchangeCodeForSession(code));
      } else if (
        token &&
        ["signup", "recovery", "email"].includes(type ?? "")
      ) {
        ({ error } = await db.auth.verifyOtp({
          token_hash: token,
          type: type as EmailOtpType,
        }));
      } else
        throw new HttpError(
          "VALIDATION_ERROR",
          400,
          "Invalid authentication callback.",
        );
      if (error)
        throw new HttpError(
          "UNAUTHENTICATED",
          401,
          "Authentication link is invalid or expired.",
        );
      return Response.redirect(
        new URL(next, process.env.APP_ORIGIN ?? url.origin),
        303,
      );
    }
    if (request.method !== "POST")
      throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
    checkOrigin(request);
    z.uuid().parse(request.headers.get("Idempotency-Key"));
    const body = await readJsonBody(request, 4096);
    const input = z
      .object({
        email: z.email().max(254).optional(),
        password: z.string().min(12).max(256).optional(),
      })
      .strict()
      .parse(body);
    const subject = createHash("sha256")
      .update(input.email?.toLowerCase() ?? "session-action")
      .digest("hex");
    const service = adminDb();
    for (const [key, limit] of [
      [subject, 10],
      ["global", 200],
    ] as const) {
      const { data, error } = await service.rpc("take_rate_limit", {
        p_subject: key,
        p_action: "auth-" + action,
        p_limit: limit,
        p_seconds: 300,
      });
      dbError(error);
      if (data !== true)
        throw new HttpError("RATE_LIMITED", 429, "Please try again later.");
    }
    const redirect = `${process.env.APP_ORIGIN ?? url.origin}/auth/callback`;
    let error;
    switch (action) {
      case "sign-in":
        if (!input.email || !input.password)
          throw new HttpError(
            "VALIDATION_ERROR",
            400,
            "Email and password required.",
          );
        ({ error } = await db.auth.signInWithPassword({
          email: input.email,
          password: input.password,
        }));
        break;
      case "sign-up":
        if (!input.email || !input.password)
          throw new HttpError(
            "VALIDATION_ERROR",
            400,
            "Email and password required.",
          );
        ({ error } = await db.auth.signUp({
          email: input.email,
          password: input.password,
          options: { emailRedirectTo: redirect },
        }));
        break;
      case "recover":
        if (!input.email)
          throw new HttpError("VALIDATION_ERROR", 400, "Email required.");
        await db.auth.resetPasswordForEmail(input.email, {
          redirectTo: `${redirect}?next=/settings`,
        });
        break;
      case "update-password":
        await requireSession();
        if (!input.password)
          throw new HttpError("VALIDATION_ERROR", 400, "Password required.");
        ({ error } = await db.auth.updateUser({ password: input.password }));
        break;
      case "sign-out":
        ({ error } = await db.auth.signOut());
        break;
      default:
        throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
    }
    if (error)
      throw new HttpError(
        "UNAUTHENTICATED",
        401,
        "Authentication could not be completed.",
      );
    return Response.json(
      successSchema(z.object({ accepted: z.boolean() })).parse({
        data: { accepted: true },
        meta: { request_id },
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const err =
      e instanceof HttpError
        ? e
        : e instanceof z.ZodError
          ? new HttpError("VALIDATION_ERROR", 400, "Invalid request.")
          : new HttpError(
              "INTERNAL_ERROR",
              500,
              "Authentication could not be completed.",
            );
    return Response.json(
      errorResponseSchema.parse({
        error: { code: err.code, message: err.message, details: {} },
        meta: { request_id },
      }),
      {
        status: err.status,
        headers: {
          "Cache-Control": "no-store",
          ...(err.status === 429 ? { "Retry-After": "300" } : {}),
        },
      },
    );
  }
}
export const GET = handle,
  POST = handle;
