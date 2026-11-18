import { z } from "zod";
export const authActionSchema = z.enum([
  "sign-in",
  "sign-up",
  "recover",
  "resend",
  "update-password",
  "sign-out",
]);
export type AuthAction = z.infer<typeof authActionSchema>;
const email = z.string().trim().pipe(z.email().max(254));
const password = z
  .string()
  .min(12, "Use at least 12 characters for your password.")
  .max(256);
export function authInput(action: AuthAction, body: unknown) {
  switch (action) {
    case "sign-in":
      return z
        .object({ email, password: z.string().min(1).max(256) })
        .strict()
        .parse(body);
    case "sign-up":
      return z.object({ email, password }).strict().parse(body);
    case "recover":
    case "resend":
      return z.object({ email }).strict().parse(body);
    case "update-password":
      return z.object({ password }).strict().parse(body);
    case "sign-out":
      return z.object({}).strict().parse(body);
  }
}
export function authFailure(
  error: { code?: string; status?: number },
  action: AuthAction,
) {
  switch (error.code) {
    case "over_email_send_rate_limit":
      return {
        code: "RATE_LIMITED",
        status: 429,
        message:
          "Confirmation and reset emails are temporarily unavailable. Please try again later.",
        retryAfter: 3600,
      };
    case "over_request_rate_limit":
      return {
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many attempts. Please wait a few minutes and try again.",
        retryAfter: 300,
      };
    case "email_address_not_authorized":
    case "unexpected_failure":
      return {
        code: "SOURCE_UNAVAILABLE",
        status: 503,
        message:
          action === "sign-in"
            ? "Sign-in is temporarily unavailable. Please try again later."
            : "Account email delivery is unavailable. Please try again later.",
      };
    case "email_not_confirmed":
      return {
        code: "UNAUTHENTICATED",
        status: 401,
        message:
          "Confirm your email before signing in. You can request another confirmation email below.",
      };
    case "weak_password":
      return {
        code: "VALIDATION_ERROR",
        status: 400,
        message: "Choose a stronger password with at least 12 characters.",
      };
    case "email_address_invalid":
    case "validation_failed":
      return {
        code: "VALIDATION_ERROR",
        status: 400,
        message: "Check your email address and password and try again.",
      };
    case "signup_disabled":
      return {
        code: "SOURCE_UNAVAILABLE",
        status: 503,
        message:
          "New accounts are temporarily unavailable. Please try again later.",
      };
    default:
      return error.status === 429
        ? {
            code: "RATE_LIMITED",
            status: 429,
            message: "Too many attempts. Please try again later.",
            retryAfter: 300,
          }
        : error.status && error.status >= 500
          ? {
              code: "SOURCE_UNAVAILABLE",
              status: 503,
              message:
                "Authentication is temporarily unavailable. Please try again later.",
            }
          : {
              code: "UNAUTHENTICATED",
              status: 401,
              message:
                action === "sign-in"
                  ? "Email or password is incorrect, or the account is not ready to sign in."
                  : "Authentication could not be completed. Try signing in or request a new email link.",
            };
  }
}
export const callbackMessages: Record<string, string> = {
  expired:
    "This authentication link is invalid or expired. Sign in or request a new email link.",
  missing: "This authentication link is incomplete. Request a new email link.",
};
