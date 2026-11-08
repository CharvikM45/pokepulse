import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
await mkdir("test-results/components/browser", { recursive: true });
await build({
  nodePaths: ["apps/web/node_modules"],
  entryPoints: ["tests/stories/lab-story.tsx"],
  bundle: true,
  outfile: "test-results/components/browser/lab.js",
  jsx: "automatic",
  format: "esm",
});
await writeFile(
  "test-results/components/browser/lab.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pack Lab presentation QA</title><link rel="stylesheet" href="/packages/ui/src/tokens.css"></head><body><div id="root"></div><script type="module" src="/qa/lab.js"></script></body></html>',
);
const browser = await chromium.launch({ headless: true });
const checks = [];
const A = "40000000-0000-4000-8000-000000000001",
  B = "40000000-0000-4000-8000-000000000002",
  set = "10000000-0000-4000-8000-000000000001";
const models = new Map(
  [A, B].map((id) => [id, { balance: 20, openings: [], requests: new Map() }]),
);
let currentUser = null,
  loseNext = true,
  failState = false,
  rejectNext = false,
  ambiguousNext = false,
  stateCalls = 0,
  resultCalls = 0;
const attempts = [];
const summary = (o) => ({
  id: o.openingId,
  set_name: o.setName,
  opened_at_label: o.openedAtLabel,
  odds_version: o.oddsVersion,
});
try {
  const context = await browser.newContext({
    viewport: { width: 360, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/qa-test/lab/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = url.pathname.slice("/qa-test/lab/".length);
    const reply = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ data, meta: { request_id: randomUUID() } }),
      });
    const reject = (message, status = 403) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: status === 403 ? "RIGHTS_DISABLED" : "SOURCE_UNAVAILABLE",
            message,
            details: {},
          },
          meta: { request_id: randomUUID() },
        }),
      });
    if (path === "test-session") return reply({ user_id: currentUser });
    if (path === "test-user") {
      const { who } = request.postDataJSON();
      currentUser = who === "A" ? A : who === "B" ? B : null;
      return reply({ user_id: currentUser });
    }
    const owner = currentUser;
    if (!owner) return reject("Test session required.", 401);
    const model = models.get(owner);
    if (path === "state") {
      stateCalls++;
      if (failState) {
        failState = false;
        return reject("Test state failure.", 503);
      }
      return reply({
        balance: model.balance,
        welcome_grant_on_first_open: 0,
        free_open_available: false,
        allowance_note:
          "Test allowance already used; deterministic reset at 00:00 UTC.",
        history: model.openings.slice(0, 1).map(summary),
        next_cursor: model.openings.length > 1 ? "older" : null,
      });
    }
    if (path === "history")
      return reply({
        openings: model.openings.map(summary),
        next_cursor: null,
      });
    if (path.startsWith("opening/")) {
      resultCalls++;
      const found = model.openings.find((o) => o.openingId === path.slice(8));
      return found ? reply(found) : reject("Saved opening not found.", 404);
    }
    if (path === "open") {
      const body = request.postDataJSON(),
        key = request.headers()["idempotency-key"];
      assert.match(key, /^[a-f0-9-]{36}$/);
      assert.deepEqual(Object.keys(body).sort(), ["set_id", "use_free_open"]);
      assert.equal(body.set_id, set);
      assert.equal(typeof body.use_free_open, "boolean");
      attempts.push({ owner, key, body });
      const prior = model.requests.get(key);
      if (prior) {
        assert.deepEqual(prior.body, body);
        return reply(prior.result);
      }
      if (rejectNext) {
        rejectNext = false;
        return reject("Simulation disabled by the test server.");
      }
      assert.ok(model.balance >= 10, "Test fixture must not overdraw");
      model.balance -= 10;
      const opening = {
        openingId: randomUUID(),
        setId: set,
        setName: "Lumen Grove",
        openedAtLabel: new Date().toISOString(),
        oddsVersion: "fictional-1",
        spentCoins: 10,
        usedFreeOpen: false,
        cards: [
          {
            card_variant_id: "20000000-0000-4000-8000-000000000001",
            slot_index: 0,
            name: "Moss Courier",
            number: "001",
            finish: "standard",
          },
          {
            card_variant_id: "20000000-0000-4000-8000-000000000004",
            slot_index: 1,
            name: "Cloud Archivist",
            number: "003",
            finish: "foil",
          },
        ],
      };
      model.openings.unshift(opening);
      model.requests.set(key, { body, result: opening });
      if (loseNext) {
        loseNext = false;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return route.abort("failed");
      }
      if (ambiguousNext) {
        ambiguousNext = false;
        return reject("Ambiguous test failure after commit.", 500);
      }
      return reply(opening);
    }
    return reject("Unknown test route.", 404);
  });
  await page.goto("http://127.0.0.1:4174/qa/lab.html");
  await page.getByRole("heading", { name: "Pack Lab", exact: true }).waitFor();
  assert.equal(stateCalls, 0);
  await page
    .getByRole("button", {
      name: "Sign in to open a free simulation",
      exact: true,
    })
    .first()
    .click();
  assert.equal(attempts.length, 0);
  assert.equal(
    await page
      .getByText("Sign-in requested; no opening submitted.", { exact: true })
      .isVisible(),
    true,
  );
  await page
    .getByRole("button", { name: "Test account A", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Free-only wallet", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Open Metadata-only fixture simulation",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Open Lumen Grove simulation", exact: true })
    .dblclick();
  await page
    .getByRole("heading", { name: "Pending opening request", exact: true })
    .waitFor();
  await page.getByText(/The opening response was not acknowledged/).waitFor();
  assert.equal(attempts.length, 1);
  assert.equal(models.get(A).openings.length, 1);
  assert.equal(models.get(A).balance, 10);
  checks.push(
    "Anonymous browse has no private state loads; explicit sign-in, disabled rights and double-click guard; lost response preserves one committed server request",
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Pending opening request", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Free-only wallet", exact: true })
    .waitFor();
  assert.equal(attempts.length, 1);
  await page
    .getByRole("button", { name: "Disable test simulation", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Retry pending opening", exact: true })
      .isDisabled(),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Open Lumen Grove simulation", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Retry pending opening", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Saved simulated opening", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Enable test simulation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Saved simulated opening", exact: true })
    .waitFor();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].key, attempts[1].key);
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(models.get(A).openings.length, 1);
  await page
    .getByRole("button", { name: "Reveal next card", exact: true })
    .click();
  assert.equal(await page.locator(".pp-reveal-list li").count(), 1);
  const firstId = await page
    .locator("[data-opening-id]")
    .getAttribute("data-opening-id");
  await page.reload();
  await page
    .getByRole("heading", { name: "Saved simulated opening", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("[data-opening-id]").getAttribute("data-opening-id"),
    firstId,
  );
  assert.equal(attempts.length, 2);
  await page.getByRole("button", { name: "Reveal all", exact: true }).click();
  assert.deepEqual(await page.locator(".pp-reveal-list li").allTextContents(), [
    "◇ Moss Courier · 001 · standard",
    "◇ Cloud Archivist · 003 · foil",
  ]);
  const cache = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([key]) =>
      key.startsWith("pokepulse:lab:"),
    ),
  );
  assert.ok(
    cache.every(
      ([, value]) =>
        !value.includes("Moss Courier") && !value.includes("cards"),
    ),
  );
  checks.push(
    "Reload makes no POST; pending retry preserves key/body; mid-reveal reload reads the same saved ID and exact cards; browser cache contains references only",
  );
  await page
    .getByRole("button", { name: "Test account B", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Free-only wallet", exact: true })
    .waitFor();
  await page.getByText("No saved openings yet.", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Saved simulated opening", exact: true })
      .count(),
    0,
  );
  rejectNext = true;
  await page
    .getByRole("button", { name: "Open Lumen Grove simulation", exact: true })
    .click();
  await page
    .getByText("Simulation disabled by the test server.", { exact: true })
    .waitFor();
  assert.equal(models.get(B).openings.length, 0);
  assert.equal(models.get(B).balance, 20);
  assert.equal(
    await page
      .getByRole("heading", { name: "Pending opening request", exact: true })
      .count(),
    0,
  );
  checks.push(
    "Account switch clears prior private presentation/recovery; definitive server rejection clears pending reference without another debit",
  );
  await page
    .getByRole("heading", { name: "Free-only wallet", exact: true })
    .waitFor();
  ambiguousNext = true;
  await page
    .getByRole("button", { name: "Open Lumen Grove simulation", exact: true })
    .click();
  await page.getByText(/The opening response was not acknowledged/).waitFor();
  assert.equal(models.get(B).openings.length, 1);
  assert.equal(models.get(B).balance, 10);
  const ambiguousKey = attempts.at(-1).key;
  await page
    .getByRole("button", { name: "Retry pending opening", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Saved simulated opening", exact: true })
    .waitFor();
  assert.equal(attempts.at(-1).key, ambiguousKey);
  assert.equal(models.get(B).openings.length, 1);
  assert.equal(models.get(B).balance, 10);
  checks.push(
    "Ambiguous 5xx after commitment retains the original request key; retry returns the same saved result without a second debit",
  );
  await page
    .getByRole("button", { name: "Test account A", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Saved simulated opening", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Free-only wallet", exact: true })
    .waitFor();
  await page
    .getByRole("button", {
      name: "Choose another simulated opening",
      exact: true,
    })
    .click();
  failState = true;
  await page
    .getByRole("button", { name: "Open Lumen Grove simulation", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Wallet and history unavailable",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Saved simulated opening", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(models.get(A).openings.length, 2);
  assert.equal(models.get(A).balance, 0);
  const posts = attempts.length;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page
    .getByRole("heading", { name: "Free-only wallet", exact: true })
    .waitFor();
  assert.equal(attempts.length, posts);
  await page
    .getByRole("button", { name: "Load more opening history", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".pp-history-list li").length === 2,
  );
  assert.equal(await page.locator(".pp-history-list li").count(), 2);
  checks.push(
    "A committed result survives wallet refresh failure; retry refresh is GET-only; history pages deduplicate saved IDs",
  );
  let scans = 0;
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "wcag22aa"])
        .analyze();
      assert.deepEqual(
        axe.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      scans++;
      if ([360, 1440].includes(width))
        await page.screenshot({
          path: `test-results/components/screenshots/lab-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/components/lab-ui-results.json",
    JSON.stringify(
      {
        checks,
        axeScans: scans,
        violations: 0,
        stateCalls,
        resultCalls,
        openingRequests: attempts.length,
        committedA: models.get(A).openings.length,
        committedB: models.get(B).openings.length,
        limits: [
          "State persists in the Node browser-test fixture, not actual Supabase or A auth/API.",
          "Native PostgreSQL transaction tests are separate evidence.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: Pack Lab retry/reload/privacy/history presentation journeys and 10 viewport/theme axe scans.",
  );
} finally {
  await browser.close();
}
