import { createHash } from "node:crypto";
import { z } from "zod";
import { type EmailOtpType } from "@supabase/supabase-js";
import { successSchema, errorResponseSchema } from "@pokepulse/contracts";
import {
  configured,
  sessionDb,
  checkOrigin,
  safeRedirect,
  HttpError,
  adminDb,
  dbError,
  requireSession,
  readJsonBody,
} from "../../../src/server";
import {
  authActionSchema,
  authInput,
  authFailure,
} from "../../../src/auth/policy";
export const dynamic = "force-dynamic";
function redirectTo(url: URL) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
async function githubEnabled() {
  if (!configured()) return false;
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,
    {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok)
    throw new HttpError(
      "SOURCE_UNAVAILABLE",
      503,
      "Sign-in options are temporarily unavailable.",
    );
  const settings = z
    .object({ external: z.object({ github: z.boolean() }) })
    .parse(await response.json());
  return settings.external.github;
}
async function handle(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const request_id = crypto.randomUUID();
  let retryAfter: number | undefined;
  let actionForLog = "unknown";
  try {
    const { action: requestedAction } = await params;
    actionForLog = requestedAction;
    const url = new URL(request.url);
    if (request.method === "GET" && requestedAction === "providers") {
      return Response.json(
        { data: { github: await githubEnabled() }, meta: { request_id } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const db = await sessionDb();
    if (request.method === "GET" && requestedAction === "github") {
      if (!(await githubEnabled()))
        return redirectTo(
          new URL(
            "/dashboard?auth_error=provider_unavailable",
            process.env.APP_ORIGIN ?? url.origin,
          ),
        );
      const { data, error } = await db.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: `${process.env.APP_ORIGIN ?? url.origin}/auth/callback`,
          scopes: "read:user user:email",
          skipBrowserRedirect: true,
        },
      });
      if (error || !data.url)
        throw new HttpError(
          "SOURCE_UNAVAILABLE",
          503,
          "GitHub sign-in is temporarily unavailable.",
        );
      return redirectTo(new URL(data.url));
    }
    if (request.method === "GET" && requestedAction === "callback") {
      const next = safeRedirect(
        url.searchParams.get("next") ??
          (url.searchParams.get("type") === "recovery"
            ? "/settings"
            : "/collection/portfolio"),
      );
      const failed = (reason: string) =>
        redirectTo(
          new URL(
            `/dashboard?auth_error=${reason}`,
            process.env.APP_ORIGIN ?? url.origin,
          ),
        );
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
      } else return failed("missing");
      if (error) return failed("expired");
      return redirectTo(new URL(next, process.env.APP_ORIGIN ?? url.origin));
    }
    if (request.method !== "POST")
      throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
    const actionResult = authActionSchema.safeParse(requestedAction);
    if (!actionResult.success)
      throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
    const action = actionResult.data;
    checkOrigin(request);
    z.uuid().parse(request.headers.get("Idempotency-Key"));
    const body = await readJsonBody(request, 4096);
    const input = authInput(action, body) as {
      email?: string;
      password?: string;
    };
    const actor = ["update-password", "sign-out"].includes(action)
      ? (await db.auth.getUser()).data.user?.id
      : undefined;
    const subject = createHash("sha256")
      .update(input.email?.toLowerCase() ?? actor ?? "anonymous-session-action")
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
    let next_step = "signed_in";
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
        {
          const result = await db.auth.signUp({
            email: input.email,
            password: input.password,
            options: { emailRedirectTo: redirect },
          });
          error = result.error;
          next_step = result.data.session ? "signed_in" : "confirm_email";
        }
        break;
      case "recover":
        if (!input.email)
          throw new HttpError("VALIDATION_ERROR", 400, "Email required.");
        ({ error } = await db.auth.resetPasswordForEmail(input.email, {
          redirectTo: `${redirect}?next=/settings`,
        }));
        next_step = "recovery_email_sent";
        break;
      case "resend":
        ({ error } = await db.auth.resend({
          type: "signup",
          email: input.email!,
          options: { emailRedirectTo: redirect },
        }));
        next_step = "confirm_email";
        break;
      case "update-password":
        await requireSession();
        if (!input.password)
          throw new HttpError("VALIDATION_ERROR", 400, "Password required.");
        ({ error } = await db.auth.updateUser({ password: input.password }));
        next_step = "password_updated";
        break;
      case "sign-out":
        ({ error } = await db.auth.signOut());
        next_step = "signed_out";
        break;
      default:
        throw new HttpError("NOT_FOUND", 404, "Endpoint not found.");
    }
    if (error) {
      const failure = authFailure(error, action);
      retryAfter = failure.retryAfter;
      console.warn("auth_provider_failure", {
        request_id,
        action,
        code: error.code ?? "unknown",
        status: error.status,
      });
      throw new HttpError(failure.code, failure.status, failure.message);
    }
    return Response.json(
      successSchema(
        z.object({ accepted: z.boolean(), next_step: z.string() }),
      ).parse({
        data: { accepted: true, next_step },
        meta: { request_id },
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const err =
      e instanceof HttpError
        ? e
        : e instanceof z.ZodError
          ? new HttpError(
              "VALIDATION_ERROR",
              400,
              e.issues[0]?.message ?? "Invalid request.",
            )
          : new HttpError(
              "INTERNAL_ERROR",
              500,
              "Authentication could not be completed.",
            );
    if (err.status >= 500)
      console.error("auth_request_failure", {
        request_id,
        action: actionForLog,
        code: err.code,
      });
    return Response.json(
      errorResponseSchema.parse({
        error: { code: err.code, message: err.message, details: {} },
        meta: { request_id },
      }),
      {
        status: err.status,
        headers: {
          "Cache-Control": "no-store",
          ...(err.status === 429
            ? { "Retry-After": String(retryAfter ?? 300) }
            : {}),
        },
      },
    );
  }
}
export const GET = handle,
  POST = handle;
