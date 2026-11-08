import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
await build({
  nodePaths: ["apps/web/node_modules"],
  entryPoints: ["tests/stories/feature-story.tsx"],
  bundle: true,
  outfile: "test-results/components/browser/features.js",
  jsx: "automatic",
  format: "esm",
});
await writeFile(
  "test-results/components/browser/features.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Feature presentation QA</title><link rel="stylesheet" href="/packages/ui/src/tokens.css"></head><body><div id="root"></div><script type="module" src="/qa/features.js"></script></body></html>',
);
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 360, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4174/qa/features.html");
  await page
    .getByRole("heading", { name: "Feature presentation stories" })
    .waitFor();
  assert.equal(
    await page
      .getByText("Use subtle reveal transitions", { exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Pause reveal", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Reveal next card", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Resume reveal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reveal next card", exact: true })
    .click();
  assert.equal(await page.locator(".pp-reveal-list li").count(), 1);
  await page.getByRole("button", { name: "Reveal all", exact: true }).click();
  assert.equal(await page.locator(".pp-reveal-list li").count(), 2);
  assert.ok(
    (await page.locator(".pp-reveal-list").innerText()).includes("foil"),
  );
  assert.equal(
    await page
      .getByRole("link", { name: "View virtual collection" })
      .getAttribute("href"),
    "/collection?mode=virtual",
  );
  checks.push(
    "Reduced motion, pause/resume/skip, ordered server-result presentation",
  );
  await page
    .getByRole("button", { name: "Edit 001 standard", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Quantity", exact: true }).fill("99");
  await page
    .getByRole("button", { name: "Save real quantity", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Quantity", exact: true })
      .inputValue(),
    "99",
  );
  await page.getByRole("textbox", { name: "Quantity", exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Save real quantity", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const saved = JSON.parse(await page.locator("#saved-real").innerText());
  assert.equal(saved.quantity, 2);
  assert.equal(Object.hasOwn(saved, "notes"), false);
  await page
    .getByRole("button", { name: "Virtual collection", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Edit 001 standard", exact: true })
      .count(),
    0,
  );
  assert.ok(
    !(await page.locator(".pp-binder-grid").innerText()).includes("Owned: 2"),
  );
  await page
    .getByRole("button", { name: "Real collection", exact: true })
    .click();
  assert.ok(
    (await page.locator(".pp-binder-grid").innerText()).includes("Owned: 2"),
  );
  await page.getByRole("button", { name: "Compact list", exact: true }).click();
  assert.equal(await page.locator(".pp-binder-list").count(), 1);
  checks.push(
    "Real edit server error/draft retry, unloaded notes preserved, real/virtual input separation, compact list",
  );
  const localTime = await page.evaluate(() => {
    const date = new Date(Date.now() - 600000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  await page
    .getByLabel("Observed time (your local time)", { exact: true })
    .fill(localTime);
  await page
    .getByRole("button", { name: "Submit for moderation", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  await page
    .getByRole("button", { name: "Submit for moderation", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Report received for moderation",
      exact: true,
    })
    .waitFor();
  const attempts = JSON.parse(
    await page.locator("#report-attempts").innerText(),
  ).map(JSON.parse);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].key, attempts[1].key);
  assert.deepEqual(attempts[0].draft, attempts[1].draft);
  checks.push(
    "Report lost-response retry reuses normalized body and idempotency key; pending receipt",
  );
  let scans = 0;
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
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
          targets: v.nodes.map((n) => n.target),
        })),
        [],
      );
      scans++;
      if ([360, 1440].includes(width))
        await page.screenshot({
          path: `test-results/components/screenshots/features-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  await writeFile(
    "test-results/components/feature-browser-results.json",
    JSON.stringify(
      {
        checks,
        axeScans: scans,
        violations: 0,
        note: "UI callback test doubles only. No backend persistence/concurrency/auth claim.",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: feature presentation callbacks/retry/separation/reveal and 10 viewport/theme axe scans.",
  );
} finally {
  await browser.close();
}
