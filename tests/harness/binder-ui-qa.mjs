import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
await mkdir("test-results/components/browser", { recursive: true });
await build({
  nodePaths: ["apps/web/node_modules"],
  entryPoints: ["tests/stories/binder-story.tsx"],
  bundle: true,
  outfile: "test-results/components/browser/binder.js",
  jsx: "automatic",
  format: "esm",
});
await writeFile(
  "test-results/components/browser/binder.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Binder QA</title><link rel="stylesheet" href="/packages/ui/src/tokens.css"></head><body><div id="root"></div><script type="module" src="/qa/binder.js"></script></body></html>',
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
  await page.goto("http://127.0.0.1:4174/qa/binder.html");
  await page
    .getByRole("heading", {
      name: "Original fictional binder fixture",
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator(".pp-binder-grid li").count(), 9);
  assert.ok(
    (await page.getByRole("status").allTextContents()).some((text) =>
      text.includes("1000 variants · Page 1 of 112"),
    ),
  );
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  assert.equal(
    await page.locator(".pp-binder-grid h3").first().innerText(),
    "Original Card 0010",
  );
  await page.getByLabel("Name or card number", { exact: true }).fill("1000");
  assert.equal(await page.locator(".pp-binder-grid li").count(), 1);
  assert.equal(
    await page.locator(".pp-binder-grid h3").innerText(),
    "Original Card 1000",
  );
  await page.getByLabel("Name or card number", { exact: true }).fill("");
  await page.getByLabel("Rarity", { exact: true }).selectOption("Special");
  assert.ok(
    (await page.getByRole("status").allTextContents()).some((text) =>
      text.includes("200 variants"),
    ),
  );
  await page.getByLabel("Show", { exact: true }).selectOption("duplicates");
  assert.equal(await page.locator(".pp-binder-grid li").count(), 1);
  assert.equal(
    await page.locator(".pp-binder-grid h3").innerText(),
    "Original Card 0001",
  );
  await page.getByLabel("Rarity", { exact: true }).selectOption("");
  await page.getByLabel("Show", { exact: true }).selectOption("all");
  await page.getByLabel("Finish", { exact: true }).selectOption("foil");
  assert.ok(
    (await page.getByRole("status").allTextContents()).some((text) =>
      text.includes("500 variants"),
    ),
  );
  await page.getByLabel("Finish", { exact: true }).selectOption("");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "test-results/components/screenshots/binder-grid-360-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Compact list", exact: true }).click();
  assert.equal(
    await page.locator(":is(.pp-binder-list,.pp-binder-grid) li").count(),
    9,
  );
  checks.push(
    "1000-variant dataset renders nine rows per page; number search, rarity/finish/duplicate filters, page reset and list fallback",
  );
  await page
    .getByLabel("Missing checklist goal", { exact: true })
    .selectOption("extended");
  assert.equal(
    await page
      .getByRole("button", { name: "Export missing checklist", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByLabel("Missing checklist goal", { exact: true })
    .selectOption("master");
  await page
    .getByRole("button", { name: "Export missing checklist", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  await page
    .getByRole("button", { name: "Export missing checklist", exact: true })
    .click();
  await page
    .getByText(
      "Missing real master checklist prepared for manifest original-large-1.",
      { exact: true },
    )
    .waitFor();
  const requests = JSON.parse(
    await page.locator("#export-requests").innerText(),
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].mode, "real");
  assert.equal(requests[0].goal, "master");
  assert.equal(requests[0].manifest_version, "original-large-1");
  assert.equal(Object.hasOwn(requests[0], "user_id"), false);
  checks.push(
    "Unknown Extended scope cannot export; failed private checklist retry keeps explicit mode/goal/version without client identity",
  );
  await page
    .getByRole("button", { name: "Show partial snapshot", exact: true })
    .click();
  assert.equal(
    await page.locator(":is(.pp-binder-list,.pp-binder-grid) li").count(),
    0,
  );
  assert.ok(
    (await page.getByRole("status").allTextContents()).some((text) =>
      text.includes("incomplete or previous mode quantities are hidden"),
    ),
  );
  await page
    .getByRole("button", { name: "Complete snapshot", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Virtual collection", exact: true })
    .click();
  assert.equal(
    await page.locator(":is(.pp-binder-list,.pp-binder-grid) li").count(),
    0,
  );
  await page.getByLabel("Show", { exact: true }).waitFor();
  await page.getByLabel("Show", { exact: true }).selectOption("owned");
  assert.equal(
    await page.locator(":is(.pp-binder-list,.pp-binder-grid) li").count(),
    1,
  );
  assert.equal(
    await page.locator(":is(.pp-binder-list,.pp-binder-grid) h3").innerText(),
    "Original Card 0003",
  );
  assert.ok(
    !(
      await page.locator(":is(.pp-binder-list,.pp-binder-grid)").innerText()
    ).includes("Owned: 3"),
  );
  await page
    .getByRole("button", { name: "Fail collection read", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Collection unavailable", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(":is(.pp-binder-list,.pp-binder-grid) li").count(),
    0,
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByLabel("Show", { exact: true }).selectOption("all");
  checks.push(
    "Partial or wrong-mode snapshot never labels cards missing/owned; delayed virtual mode and collection-read error/retry retain separation",
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
          path: `test-results/components/screenshots/binder-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/components/binder-ui-results.json",
    JSON.stringify(
      {
        checks,
        axeScans: scans,
        violations: 0,
        pageErrors: errors,
        fixtureVariants: 1000,
        maxRenderedCards: 9,
        limits: [
          "Original fixture data and callback tests; actual authenticated paging/export endpoints remain pending.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: binder large-data/filter/mode/export journeys and 10 viewport/theme axe scans.",
  );
} finally {
  await browser.close();
}
