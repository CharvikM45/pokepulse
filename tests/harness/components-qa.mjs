import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
await mkdir("test-results/components/browser", { recursive: true });
await build({
  nodePaths: ["apps/web/node_modules"],
  entryPoints: ["tests/stories/ui-story.tsx"],
  bundle: true,
  outfile: "test-results/components/browser/story.js",
  jsx: "automatic",
  format: "esm",
});
await writeFile(
  "test-results/components/browser/index.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>React primitive QA</title><link rel="stylesheet" href="/packages/ui/src/tokens.css"></head><body><div id="root"></div><script type="module" src="/qa/story.js"></script></body></html>',
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
  await page.goto("http://127.0.0.1:4174/qa/index.html");
  await page.getByRole("heading", { name: "Component stories" }).waitFor();
  const combo = page.getByRole("combobox", { name: "Choose a finish" });
  await combo.focus();
  await combo.press("ArrowDown");
  await combo.press("Enter");
  assert.equal(await combo.inputValue(), "Foil");
  assert.equal(await page.locator("#selected").innerText(), "Selected: foil");
  await combo.fill("does not exist");
  assert.equal(
    await page.getByText("No matching options", { exact: true }).isVisible(),
    true,
  );
  await combo.press("Escape");
  assert.equal(await combo.inputValue(), "Foil");
  assert.equal(await combo.getAttribute("aria-expanded"), "false");
  checks.push(
    "Combobox keyboard selection/no matches/Escape restores selection",
  );
  await page.getByRole("tab", { name: "Real", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "Virtual", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(
    await page
      .getByRole("tab", { name: "Real", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page.getByRole("tabpanel").innerText(),
    "Virtual panel content",
  );
  checks.push("Tabs use arrows for focus and Enter for activation");
  const trigger = page.getByRole("button", {
    name: "Edit quantity",
    exact: true,
  });
  await trigger.click();
  assert.equal(
    await page
      .getByRole("button", { name: "Cancel", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  const input = page.getByRole("spinbutton", { name: "Quantity" });
  assert.equal(await input.getAttribute("aria-invalid"), "true");
  assert.equal(
    await input.getAttribute("aria-describedby"),
    "quantity-hint quantity-error",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await trigger.evaluate((el) => el === document.activeElement),
    true,
  );
  await trigger.click();
  await page.getByRole("button", { name: "Preview save" }).click();
  assert.equal(
    await page
      .getByText("Example update acknowledged; no backend write.")
      .isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  checks.push(
    "Dialog Cancel focus/Escape/restore, labelled field error and toast",
  );
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
      if ([360, 1440].includes(width))
        await page.screenshot({
          path: `test-results/components/screenshots/react-${width}-${theme}.png`,
          fullPage: true,
        });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/components/component-browser-results.json",
    JSON.stringify(
      {
        checks,
        axeScans: 10,
        violations: 0,
        horizontalOverflow: false,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: React primitives keyboard/focus/error/toast checks, 10 viewport/theme axe scans, no page errors.",
  );
} finally {
  await browser.close();
}
