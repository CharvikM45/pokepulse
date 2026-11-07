import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
await mkdir("test-results/components/browser", { recursive: true });
await build({
  nodePaths: ["apps/web/node_modules"],
  entryPoints: ["tests/stories/radar-story.tsx"],
  bundle: true,
  outfile: "test-results/components/browser/radar.js",
  jsx: "automatic",
  format: "esm",
});
await writeFile(
  "test-results/components/browser/radar.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Radar presentation QA</title><link rel="stylesheet" href="/packages/ui/src/tokens.css"></head><body><div id="root"></div><script type="module" src="/qa/radar.js"></script></body></html>',
);
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 360, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4174/qa/radar.html");
  await page
    .getByRole("heading", { name: "Local Radar", exact: true })
    .waitFor();
  const search = async (zip) => {
    await page.getByLabel("ZIP code", { exact: true }).fill(zip);
    await page
      .getByRole("button", { name: "Find stores", exact: true })
      .click();
  };
  await search("12");
  assert.equal(await page.getByRole("alert").isVisible(), true);
  assert.equal(
    await page
      .getByLabel("ZIP code", { exact: true })
      .getAttribute("aria-invalid"),
    "true",
  );
  await search("11111");
  await search("22222");
  await page
    .getByRole("heading", { name: "Fast current store", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => JSON.parse(document.getElementById("metrics").textContent).slowDone,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Slow stale store", exact: true })
      .count(),
    0,
  );
  await search("02110");
  await page
    .getByRole("button", { name: "Load more stores", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Example Binder Shop", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Example Hobby Store", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.getByRole("link", { name: /Directions to/ }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Report at Example Hobby Store", exact: true })
    .click();
  assert.equal(
    await page
      .getByText("Sign-in requested; no report saved.", { exact: true })
      .isVisible(),
    true,
  );
  await page
    .getByRole("button", {
      name: "View reports for Example Hobby Store",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "Found stock reported", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Shelf empty reported", exact: true })
      .isVisible(),
    true,
  );
  for (const value of [
    "PRIVATE_AUTHOR_MUST_NOT_APPEAR",
    "PENDING_NOTE_MUST_NOT_APPEAR",
    "EXPIRED_NOTE_MUST_NOT_APPEAR",
  ])
    assert.ok(!(await page.locator("body").innerText()).includes(value));
  await page.waitForFunction(
    () =>
      JSON.parse(document.getElementById("metrics").textContent).reportCalls >=
      2,
  );
  await page
    .getByRole("heading", { name: "Shelf empty reported", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Found stock reported", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByText("Conflicting reports: 1", { exact: true }).count(),
    0,
  );
  checks.push(
    "ZIP validation, ignored stale/out-of-order search, pagination dedup, missing map/directions fallback and progressive sign-in",
  );
  checks.push(
    "Only approved/unexpired public report fields render; expiry refetch removes stale conflict counts and private identity/notes",
  );
  await page
    .getByRole("button", { name: "Fail next report read", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "View reports for Example Hobby Store",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", {
      name: "Community reports unavailable",
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page
    .getByRole("heading", { name: "Shelf empty reported", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Show queue story", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Staff access required", exact: true })
    .waitFor();
  assert.equal(
    JSON.parse(await page.locator("#metrics").innerText()).queueCalls,
    0,
  );
  assert.ok(
    !(await page.locator("body").innerText()).includes("PRIVATE_STAFF_NOTE"),
  );
  await page
    .getByRole("button", { name: "Grant test staff", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Sighting moderation", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Reviewable demo store", exact: true })
    .waitFor();
  assert.equal(await page.locator("article script").count(), 0);
  assert.equal(
    await page
      .getByRole("button", {
        name: "Review report at Own demo report",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", {
      name: "Review report at Reviewable demo store",
      exact: true,
    })
    .click();
  assert.equal(
    await page
      .getByLabel("Public note (optional; reviewed text only)", { exact: true })
      .inputValue(),
    "",
  );
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Reviewed independently with public text redacted.");
  await page
    .getByLabel("Public note (optional; reviewed text only)", { exact: true })
    .fill("Reviewed shelf note.");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page.getByText(/The review could not be acknowledged/).waitFor();
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const attempts = JSON.parse(
    await page.locator("#metrics").innerText(),
  ).reviews;
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].key, attempts[1].key);
  assert.deepEqual(attempts[0].draft, attempts[1].draft);
  assert.equal(attempts[0].draft.public_notes, "Reviewed shelf note.");
  assert.equal(Object.hasOwn(attempts[0].draft, "actor_id"), false);
  await page
    .getByLabel("Report state", { exact: true })
    .selectOption("approved");
  await page
    .getByRole("heading", { name: "Reviewable demo store", exact: true })
    .waitFor();
  await page
    .getByRole("button", {
      name: "Review report at Reviewable demo store",
      exact: true,
    })
    .click();
  assert.equal(
    await page.getByLabel("Decision", { exact: true }).inputValue(),
    "rejected",
  );
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Withdraw outdated approval.");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  checks.push(
    "Staff presentation guard prevents queue loads, self-review disabled, private markup escaped, public notes start empty, validation/retry key preservation and approval withdrawal",
  );
  await page
    .getByLabel("Report state", { exact: true })
    .selectOption("expired");
  await page
    .getByRole("heading", { name: "No reports in this queue", exact: true })
    .waitFor();
  await page
    .getByLabel("Report state", { exact: true })
    .selectOption("rejected");
  await page
    .getByRole("heading", { name: "Reviewable demo store", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Fail next queue read", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh queue", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Review queue unavailable", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page
    .getByRole("heading", { name: "Reviewable demo store", exact: true })
    .waitFor();
  const done = JSON.parse(await page.locator("#metrics").innerText()).queueDone;
  await page
    .getByRole("button", { name: "Delay next queue read", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh queue", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Revoke test staff", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Staff access required", exact: true })
    .waitFor();
  await page.waitForFunction(
    (value) =>
      JSON.parse(document.getElementById("metrics").textContent).queueDone >
      value,
    done,
  );
  assert.ok(
    !(await page.locator("body").innerText()).includes("PRIVATE_STAFF_NOTE"),
  );
  checks.push(
    "Private queue empty/error/retry and late-response discard after staff access is revoked",
  );
  let scans = 0;
  for (const story of ["radar", "queue"]) {
    if (story === "radar") {
      await page
        .getByRole("button", { name: "Show Radar story", exact: true })
        .click();
      await search("02110");
      await page
        .getByRole("heading", { name: "Example Hobby Store", exact: true })
        .waitFor();
    } else {
      await page
        .getByRole("button", { name: "Show queue story", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Grant test staff", exact: true })
        .click();
      await page
        .getByLabel("Report state", { exact: true })
        .selectOption("rejected");
      await page
        .getByRole("heading", { name: "Reviewable demo store", exact: true })
        .waitFor();
    }
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
            path: `test-results/components/screenshots/${story}-${width}-${theme}.png`,
            fullPage: true,
          });
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/components/radar-ui-results.json",
    JSON.stringify(
      {
        checks,
        axeScans: scans,
        violations: 0,
        pageErrors: errors,
        limits: [
          "Callback test doubles; actual staff/auth/API/notification integration remains pending.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: Radar/moderation presentation journeys and 20 viewport/theme axe scans.",
  );
} finally {
  await browser.close();
}
