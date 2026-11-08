import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
await mkdir("test-results/components/browser", { recursive: true });
await build({
  nodePaths: ["apps/web/node_modules"],
  entryPoints: ["tests/stories/calendar-story.tsx"],
  bundle: true,
  outfile: "test-results/components/browser/calendar.js",
  jsx: "automatic",
  format: "esm",
});
await writeFile(
  "test-results/components/browser/calendar.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calendar QA</title><link rel="stylesheet" href="/packages/ui/src/tokens.css"></head><body><div id="root"></div><script type="module" src="/qa/calendar.js"></script></body></html>',
);
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 360, height: 900 },
    timezoneId: "America/Los_Angeles",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4174/qa/calendar.html");
  await page
    .getByRole("heading", { name: "Release calendar", exact: true })
    .waitFor();
  assert.equal(await page.locator("article").count(), 3);
  assert.equal(
    await page
      .getByRole("link", { name: /Source announcement for Fictional unknown/ })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByText("Source link unavailable", { exact: true })
      .isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Month view", exact: true }).click();
  const first = page.getByRole("button", {
    name: "February 1, 2027, 0 announcements",
    exact: true,
  });
  assert.equal(await first.isVisible(), true);
  const day = page.getByRole("button", {
    name: "February 6, 2027, 1 announcements",
    exact: true,
  });
  await day.focus();
  await day.press("Enter");
  assert.equal(
    await page
      .getByRole("heading", { name: "February 6, 2027", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await page
      .getByRole("heading", {
        name: "Month announced; exact day unconfirmed",
        exact: true,
      })
      .isVisible(),
    true,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Date unconfirmed", exact: true })
      .isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  assert.ok((await page.locator("caption").innerText()).includes("March 2027"));
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  checks.push(
    "Day-only date stable in Los Angeles; month-level release not assigned to day 1; unknown dates separate; keyboard day selection/month navigation",
  );
  await page.getByLabel("Region", { exact: true }).selectOption("JP");
  assert.equal(await page.locator("article").count(), 1);
  await page.getByLabel("Region", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await page.getByLabel("Set", { exact: true }).selectOption("Lumen Grove");
  assert.equal(await page.locator("article").count(), 1);
  await page.getByLabel("Set", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Show error", exact: true }).click();
  assert.equal(await page.getByRole("alert").isVisible(), true);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  assert.equal(await page.locator("article").count(), 3);
  await page.getByRole("button", { name: "Show loading", exact: true }).click();
  assert.ok(
    (await page.getByRole("status").innerText()).includes(
      "Loading release calendar",
    ),
  );
  await page.getByRole("button", { name: "Show empty", exact: true }).click();
  assert.equal(
    await page
      .getByRole("heading", { name: "No sourced releases", exact: true })
      .isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Show ready", exact: true }).click();
  checks.push(
    "Controlled region/set filtering, safe source fallback, loading/empty/error/retry states and visible demo/source/verification labels",
  );
  await page.getByRole("button", { name: "Month view", exact: true }).click();
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
          path: `test-results/components/screenshots/calendar-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/components/calendar-ui-results.json",
    JSON.stringify(
      {
        checks,
        axeScans: scans,
        violations: 0,
        limits: [
          "Fictional presentation fixtures; no integrated release HTTP endpoint or live source.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: calendar presentation journeys and 10 viewport/theme axe scans.",
  );
} finally {
  await browser.close();
}
