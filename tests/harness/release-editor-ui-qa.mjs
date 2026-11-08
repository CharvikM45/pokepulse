import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
await mkdir("test-results/components/browser", { recursive: true });
await build({
  nodePaths: ["apps/web/node_modules"],
  entryPoints: ["tests/stories/release-editor-story.tsx"],
  bundle: true,
  outfile: "test-results/components/browser/editor.js",
  jsx: "automatic",
  format: "esm",
});
await writeFile(
  "test-results/components/browser/editor.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Release editor QA</title><link rel="stylesheet" href="/packages/ui/src/tokens.css"></head><body><div id="root"></div><script type="module" src="/qa/editor.js"></script></body></html>',
);
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 360, height: 900 },
    reducedMotion: "reduce",
    timezoneId: "America/Los_Angeles",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4174/qa/editor.html");
  await page
    .getByRole("heading", { name: "Staff access required", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Release name", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Grant test editor", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Curate a release", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Source verified at (ISO UTC)", { exact: true })
      .inputValue(),
    "",
  );
  await page
    .getByRole("button", { name: "Disable test source", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Save sourced release", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Approve test source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save sourced release", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  await page
    .getByLabel("Release name", { exact: true })
    .fill("Fictional source-curated announcement");
  await page
    .getByLabel("Approved announcement URL", { exact: true })
    .fill("https://calendar.example.test/fictional-test");
  await page
    .getByLabel("Source verified at (ISO UTC)", { exact: true })
    .fill(new Date(Date.now() - 60000).toISOString());
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Original test source checked; exact date not announced.");
  await page
    .getByRole("button", { name: "Save sourced release", exact: true })
    .click();
  await page.getByText(/The edit could not be acknowledged/).waitFor();
  await page
    .getByRole("button", { name: "Save sourced release", exact: true })
    .click();
  await page.getByText(/Editorial release saved at revision 1/).waitFor();
  let attempts = JSON.parse(await page.locator("#editor-attempts").innerText());
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].key, attempts[1].key);
  assert.deepEqual(attempts[0].draft, attempts[1].draft);
  assert.equal(attempts[0].draft.entry.date, null);
  assert.equal(attempts[0].draft.entry.date_precision, "unconfirmed");
  assert.equal(
    await page
      .getByRole("button", { name: "Save sourced release", exact: true })
      .isDisabled(),
    true,
  );
  checks.push(
    "Staff-only form, source host gate, blank verification time, validation, unknown date null and same-key lost-response retry; unchanged save disabled",
  );
  await page
    .getByLabel("Date precision", { exact: true })
    .selectOption("month");
  await page.getByLabel("Announced month", { exact: true }).fill("2030-02");
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Fictional source now specifies a month, not a day.");
  await page
    .getByRole("button", { name: "Save sourced release", exact: true })
    .click();
  await page.getByText(/Editorial release saved at revision 2/).waitFor();
  attempts = JSON.parse(await page.locator("#editor-attempts").innerText());
  assert.equal(attempts.at(-1).draft.expected_revision, 1);
  assert.equal(attempts.at(-1).draft.entry.date, "2030-02-01");
  assert.equal(attempts.at(-1).draft.entry.date_precision, "month");
  assert.notEqual(attempts.at(-1).key, attempts[0].key);
  await page
    .getByLabel("Publication status", { exact: true })
    .selectOption("withdrawn");
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Withdraw test fixture.");
  await page
    .getByRole("button", { name: "Save sourced release", exact: true })
    .click();
  await page.getByText(/Editorial release saved at revision 3/).waitFor();
  assert.equal(
    JSON.parse(await page.locator("#editor-saved").innerText()).status,
    "withdrawn",
  );
  checks.push(
    "Month precision preserved through normalized storage; subsequent edits use next revision/new key; explicit withdrawal",
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
          path: `test-results/components/screenshots/release-editor-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  await page
    .getByRole("button", { name: "Revoke test editor", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Staff access required", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Release name", { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/components/release-editor-ui-results.json",
    JSON.stringify(
      {
        checks,
        axeScans: scans,
        violations: 0,
        pageErrors: errors,
        limits: [
          "Callback test doubles, not a published announcement or A auth/API integration.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: release editor validation/retry/revision/withdrawal and 10 viewport/theme axe scans.",
  );
} finally {
  await browser.close();
}
