/** Browser wiring tests; real GoTrue signup/confirmation/recovery runs in collector-http.mjs. */
import { test, expect } from "@playwright/test";
const user = "41111111-1111-4111-8111-111111111111";
const envelope = (data: unknown) => ({
  data,
  meta: { request_id: crypto.randomUUID() },
});
test("signup reports email delivery failure and confirmation success accurately", async ({
  page,
}) => {
  await page.route("**/api/v1/me/session", (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: "UNAUTHENTICATED",
          message: "Sign in required.",
          details: {},
        },
        meta: { request_id: crypto.randomUUID() },
      },
    }),
  );
  let succeeds = false;
  await page.route("**/auth/sign-up", (route) =>
    route.fulfill(
      succeeds
        ? {
            status: 200,
            json: envelope({ accepted: true, next_step: "confirm_email" }),
          }
        : {
            status: 429,
            json: {
              error: {
                code: "RATE_LIMITED",
                message:
                  "Confirmation and reset emails are temporarily unavailable. Please try again later.",
                details: {},
              },
              meta: { request_id: crypto.randomUUID() },
            },
          },
    ),
  );
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("signup@example.test");
  await page
    .getByLabel("Password (at least 12 characters)", { exact: true })
    .fill("A-strong-fixture-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "emails are temporarily unavailable",
  );
  succeeds = true;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Check your email to confirm",
  );
  await expect(
    page.getByRole("button", {
      name: "Resend confirmation email",
      exact: true,
    }),
  ).toBeVisible();
});
test("existing passwords reach sign-in and an expired link shows recovery instructions", async ({
  page,
}) => {
  await page.route("**/api/v1/me/session", (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: "UNAUTHENTICATED",
          message: "Sign in required.",
          details: {},
        },
        meta: { request_id: crypto.randomUUID() },
      },
    }),
  );
  let submitted = false;
  await page.route("**/auth/sign-in", async (route) => {
    submitted = true;
    expect(route.request().postDataJSON().password).toBe("oldpass");
    await route.fulfill({
      status: 401,
      json: {
        error: {
          code: "UNAUTHENTICATED",
          message:
            "Confirm your email before signing in. You can request another confirmation email below.",
          details: {},
        },
        meta: { request_id: crypto.randomUUID() },
      },
    });
  });
  await page.goto("/dashboard?auth_error=expired");
  await expect(page.getByRole("status")).toContainText("invalid or expired");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("signup@example.test");
  await page.getByLabel("Password", { exact: true }).fill("oldpass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Confirm your email");
  expect(submitted).toBe(true);
  await expect(
    page.getByRole("button", {
      name: "Resend confirmation email",
      exact: true,
    }),
  ).toBeVisible();
});
test("virtual cards page uses private paginated inventory without a set manifest", async ({
  page,
}) => {
  await page.route("**/api/v1/me/session", (route) =>
    route.fulfill({ json: envelope({ id: user }) }),
  );
  await page.route("**/api/v1/me/card-library?*", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("kind")).toBe("virtual");
    return route.fulfill({
      json: envelope(
        url.searchParams.has("cursor")
          ? { entries: [], next_cursor: null }
          : {
              entries: [{ id: user, quantity: 2, card: null }],
              next_cursor: "next-fixture",
            },
      ),
    });
  });
  await page.goto("/collection?mode=virtual");
  await expect(
    page.getByRole("heading", { name: "Your virtual cards." }),
  ).toBeVisible();
  await expect(
    page.getByText("2 virtual copies", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Manifest incomplete")).toHaveCount(0);
  await page.getByRole("button", { name: "Next page →" }).click();
  await expect(
    page.getByRole("heading", { name: "No virtual cards yet" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("GitHub sign-in appears only when its provider is connected", async ({
  page,
}) => {
  await page.route("**/api/v1/me/session", (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: "UNAUTHENTICATED",
          message: "Sign in required.",
          details: {},
        },
        meta: { request_id: crypto.randomUUID() },
      },
    }),
  );
  await page.route("**/auth/providers", (route) =>
    route.fulfill({ json: envelope({ github: true }) }),
  );
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" }),
  ).toHaveAttribute("href", "/auth/github");
});
