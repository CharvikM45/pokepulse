import { describe, it, expect, vi, beforeEach } from "vitest";
import { authInput, authFailure } from "../../apps/web/src/auth/policy";
const mocks = vi.hoisted(() => ({
  auth: {
    signInWithOAuth: vi.fn(),
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    resend: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    verifyOtp: vi.fn(),
  },
  rpc: vi.fn(),
}));
vi.mock("../../apps/web/src/server", () => ({
  configured: () => true,
  sessionDb: async () => ({ auth: mocks.auth }),
  adminDb: () => ({ rpc: mocks.rpc }),
  requireSession: async () => ({ user: { id: "test" } }),
  readJsonBody: async (request: Request) => request.json(),
  checkOrigin: (request: Request) => {
    if (request.headers.get("origin") !== "https://app.example")
      throw new Error("CSRF");
  },
  safeRedirect: (path: string | null) =>
    path?.startsWith("/") && !path.startsWith("//") && !path.includes("\\")
      ? path
      : "/",
  dbError: (error: unknown) => {
    if (error) throw error;
  },
  HttpError: class extends Error {
    constructor(
      public code: string,
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
import { POST, GET } from "../../apps/web/app/auth/[action]/route";
async function call(action: string, body: unknown) {
  return POST(
    new Request(`https://app.example/auth/${action}`, {
      method: "POST",
      headers: {
        Origin: "https://app.example",
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ action }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  delete process.env.APP_ORIGIN;
});
describe("authentication validation and provider failures", () => {
  it("allows existing short sign-in passwords but enforces stronger new passwords", () => {
    expect(
      authInput("sign-in", {
        email: " user@example.com ",
        password: "oldpass",
      }),
    ).toEqual({ email: "user@example.com", password: "oldpass" });
    expect(() =>
      authInput("sign-up", { email: "user@example.com", password: "oldpass" }),
    ).toThrow();
    expect(() =>
      authInput("recover", { email: "user@example.com", password: "extra" }),
    ).toThrow();
  });
  it("maps restricted SMTP without disclosing account existence or raw provider messages", () => {
    expect(
      authFailure({ code: "email_address_not_authorized" }, "sign-up"),
    ).toMatchObject({ status: 503, code: "SOURCE_UNAVAILABLE" });
    expect(
      authFailure({ code: "invalid_credentials" }, "sign-in").message,
    ).toContain("Email or password");
  });
  it("returns actionable signup email throttling and retry headers", async () => {
    mocks.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: { code: "over_email_send_rate_limit", status: 429 },
    });
    const response = await call("sign-up", {
      email: "new@example.com",
      password: "Strong-fixture-pass9!",
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect((await response.json()).error.message).toContain(
      "emails are temporarily unavailable",
    );
  });
  it("does not claim recovery email success when delivery fails", async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", status: 429 },
    });
    expect((await call("recover", { email: "new@example.com" })).status).toBe(
      429,
    );
  });
  it("distinguishes confirmation-required signup from an authenticated session", async () => {
    mocks.auth.signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    expect(
      (
        await (
          await call("sign-up", {
            email: "new@example.com",
            password: "Strong-fixture-pass9!",
          })
        ).json()
      ).data.next_step,
    ).toBe("confirm_email");
    mocks.auth.signUp.mockResolvedValue({
      data: { session: { access_token: "not-exposed" } },
      error: null,
    });
    const body = await (
      await call("sign-up", {
        email: "new@example.com",
        password: "Strong-fixture-pass9!",
      })
    ).json();
    expect(body.data).toEqual({ accepted: true, next_step: "signed_in" });
  });
  it("resends through the public provider API and validates the action before spending rate limits", async () => {
    mocks.auth.resend.mockResolvedValue({ error: null });
    expect((await call("resend", { email: "new@example.com" })).status).toBe(
      200,
    );
    expect(mocks.auth.resend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "signup" }),
    );
    mocks.rpc.mockClear();
    expect((await call("wrong", {})).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns invalid links to a usable sign-in page and valid recovery links to password settings", async () => {
    const get = (query: string) =>
      GET(new Request("https://app.example/auth/callback" + query), {
        params: Promise.resolve({ action: "callback" }),
      });
    const missing = await get("");
    expect(missing.status).toBe(303);
    expect(missing.headers.get("Location")).toBe(
      "https://app.example/dashboard?auth_error=missing",
    );
    mocks.auth.verifyOtp.mockResolvedValue({ error: null });
    expect(
      (await get("?token_hash=fixture&type=recovery")).headers.get("Location"),
    ).toBe("https://app.example/settings");
    mocks.auth.exchangeCodeForSession.mockResolvedValue({
      error: { code: "bad_code" },
    });
    expect((await get("?code=expired")).headers.get("Location")).toContain(
      "auth_error=expired",
    );
  });
});

it("offers GitHub only after the provider is enabled and starts a PKCE flow without repository scopes", async () => {
  const provider = vi.spyOn(globalThis, "fetch");
  provider.mockImplementation(async () =>
    Response.json({ external: { github: false } }),
  );
  const get = (action: string) =>
    GET(new Request(`https://app.example/auth/${action}`), {
      params: Promise.resolve({ action }),
    });
  expect((await (await get("providers")).json()).data.github).toBe(false);
  expect((await get("github")).headers.get("Location")).toContain(
    "auth_error=provider_unavailable",
  );
  provider.mockImplementation(async () =>
    Response.json({ external: { github: true } }),
  );
  mocks.auth.signInWithOAuth.mockResolvedValue({
    data: { url: "https://auth.example/authorize?provider=github" },
    error: null,
  });
  const response = await get("github");
  expect(response.status).toBe(303);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: "github",
    options: {
      redirectTo: "https://app.example/auth/callback",
      scopes: "read:user user:email",
      skipBrowserRedirect: true,
    },
  });
  provider.mockRestore();
});
