import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";

test("filters survive refresh and browser back, including channel and third-party distinction", async ({
  page,
}) => {
  await page.goto("/products");
  await page.getByText("Filter products and offers", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("Starlight 1");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/q=Starlight\+1/);
  await expect(
    page.getByRole("link", { name: "Demo Starlight 1", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByText("Filter products and offers", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search", exact: true }),
  ).toHaveValue("Starlight 1");
  await page
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("missing-product");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching records" }),
  ).toBeVisible();
  await page.goBack();
  if (
    !(await page
      .getByRole("textbox", { name: "Search", exact: true })
      .isVisible())
  )
    await page.getByText("Filter products and offers", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search", exact: true }),
  ).toHaveValue("Starlight 1");
  await page.goto("/drops?seller_type=third_party&channel=ship_to_home");
  await expect(page.getByText("Third-party marketplace seller")).toBeVisible();
  await expect(page.getByText("Price unavailable")).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
});
test("product details preserve offer identity, missing history and signed-out watch behavior", async ({
  page,
}) => {
  await page.goto("/products/10000000-0000-4000-8000-000000000001");
  await expect(
    page.getByRole("heading", { name: "Retailer offers" }),
  ).toBeVisible();
  await expect(page.getByText("Third-party marketplace seller")).toBeVisible();
  await expect(
    page.getByText("No recorded observation history."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Watch product", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /sign in/i }),
  ).toBeVisible();
});
test("product and offer pagination keep their different cursors separate", async ({
  page,
}) => {
  for (const path of ["/products", "/drops"]) {
    await page.goto(path);
    await page.getByRole("link", { name: "Next page →" }).click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(
      page.getByRole("heading", { name: "Catalog unavailable" }),
    ).toHaveCount(0);
    await expect(page.locator(".pp-card h2").first()).toBeVisible();
  }
});
test("adapter: freshness expiry requests a new A projection without inventing availability", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/v1/drops?*", async (route) => {
    const upstream = await route.fetch();
    const body = await upstream.json();
    reads++;
    body.data[0] = {
      ...body.data[0],
      availability_status: reads === 1 ? "in_stock" : "unknown",
      freshness: reads === 1 ? "fresh" : "unavailable",
      observed_at: new Date().toISOString(),
      stale_after: new Date(
        Date.now() + (reads === 1 ? 1500 : -1000),
      ).toISOString(),
      evidence_summary:
        reads === 1
          ? "DEMO DATA — transport freshness fixture."
          : "Source unavailable; current availability is unknown.",
    };
    await route.fulfill({ response: upstream, json: body });
  });
  await page.goto("/drops");
  const first = page.locator(".pp-offer").first();
  await expect(first.getByText("in stock", { exact: true })).toBeVisible();
  await expect(first.getByText("unavailable", { exact: true })).toBeVisible();
  await expect(first.getByText("unknown", { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2);
});
test("Radar ZIP controls and unavailable provider keep the list usable without GPS", async ({
  page,
}) => {
  let asked = false;
  await page.exposeFunction("gpsWasRequested", () => {
    asked = true;
  });
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => {
      (window as unknown as { gpsWasRequested: () => void }).gpsWasRequested();
    };
  });
  await page.goto("/local");
  await page.getByLabel("ZIP code").fill("abc");
  await page.getByRole("button", { name: /find|search/i }).click();
  await expect(page.getByText(/Enter a 5-digit ZIP/)).toBeVisible();
  await page.getByLabel("ZIP code").fill("00000");
  await page.getByRole("button", { name: /find|search/i }).click();
  await expect(
    page.getByRole("heading", { name: /unavailable|could not/i }),
  ).toBeVisible();
  expect(asked).toBe(false);
});
test("free simulation disabled and anonymous binder never imply physical ownership", async ({
  page,
}) => {
  await page.goto("/lab");
  await expect(
    page.getByRole("heading", { name: "Pack opening unavailable" }),
  ).toBeVisible();
  await expect(page.getByText(/Lumen Grove/, { exact: true })).toBeVisible();
  await page.goto("/collection");
  await expect(page.getByText(/Anonymous demo sample/)).toBeVisible();
  await expect(page.getByText(/fictional-1/).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /save real|add quantity/i }),
  ).toHaveCount(0);
});
test("public B APIs enforce bounds, envelopes, privacy and CSRF", async ({
  request,
}) => {
  const catalog = await request.get("/api/v1/sets");
  expect(catalog.status()).toBe(200);
  expect((await catalog.json()).data.enabled).toBe(false);
  const cards = await request.get(
    "/api/v1/sets/10000000-0000-4000-8000-000000000001/cards",
  );
  expect((await cards.json()).data.variants).toHaveLength(5);
  for (const path of [
    "stores?zip=bad&radius_mi=25",
    "stores?zip=00000&radius_mi=101",
    "sets/not-a-uuid/cards",
    "releases?limit=51",
  ]) {
    const result = await request.get(`/api/v1/${path}`);
    expect(result.status()).toBe(400);
    expect((await result.json()).error.code).toBe("VALIDATION_ERROR");
  }
  for (const path of [
    "me/lab",
    "me/pack-openings",
    "me/collections",
    "admin/collector",
    "admin/collector/reports?state=pending",
  ])
    expect((await request.get(`/api/v1/${path}`)).status()).toBe(401);
  const forbidden = await request.post("/api/v1/packs/open", {
    headers: { Origin: "https://evil.example" },
    data: {
      set_id: "10000000-0000-4000-8000-000000000001",
      use_free_open: true,
    },
  });
  expect(forbidden.status()).toBe(403);
});

for (const width of [360, 1440])
  for (const theme of ["light", "dark"] as const) {
    test(`consumer routes: accessibility, overflow and ${theme} appearance at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(120000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      for (const path of [
        "/",
        "/products",
        "/drops",
        "/products/10000000-0000-4000-8000-000000000001",
        "/local",
        "/calendar",
        "/lab",
        "/collection",
        "/dashboard",
        "/watchlist",
        "/alerts",
        "/settings",
        "/staff/collector",
      ]) {
        const scan = await page.context().newPage();
        await scan.setViewportSize({ width, height: 900 });
        await scan.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        expect(await scan.evaluate(() => innerWidth)).toBe(width);
        expect(
          await scan.evaluate(
            () => matchMedia("(prefers-color-scheme: dark)").matches,
          ),
        ).toBe(theme === "dark");
        scan.setDefaultNavigationTimeout(10000);
        console.log(`B scan ${width} ${theme}: ${path}`);
        await scan.goto(path, { waitUntil: "domcontentloaded" });
        await expect(scan.locator("main h1").first()).toBeVisible();
        await expect(scan.locator(".pp-skeleton")).toHaveCount(0);
        expect(
          await scan.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          path,
        ).toBe(true);
        const result = await new AxeBuilder({ page: scan })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(result.violations, path).toEqual([]);
        if (["/", "/local", "/lab", "/collection"].includes(path))
          await scan.screenshot({
            path: `test-results/b-${path === "/" ? "home" : path.slice(1)}-${width}-${theme}.png`,
            fullPage: true,
            timeout: 10000,
          });
        await scan.close();
      }
    });
  }
test("keyboard skip link and persisted appearance are usable", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await page.getByLabel("Appearance").selectOption("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("390px, 768px and 1024px layouts retain usable controls without overflow", async ({
  page,
}) => {
  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/products", "/local", "/collection"]) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expect(page.locator(".pp-skeleton")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${path} at ${width}`,
      ).toBe(true);
    }
  }
});
test("records local production-build timing without claiming staging Core Web Vitals", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const values: { lcp_ms: number | null; layout_shift_sum: number } = {
      lcp_ms: null,
      layout_shift_sum: 0,
    };
    (window as unknown as { ppLocalTiming: typeof values }).ppLocalTiming =
      values;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) values.lcp_ms = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput) values.layout_shift_sum += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "View all products →" }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  const observed = await page.evaluate(() => {
    const timing = (
      window as unknown as {
        ppLocalTiming: { lcp_ms: number | null; layout_shift_sum: number };
      }
    ).ppLocalTiming;
    const nav = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    return { ...timing, ttfb_ms: nav.responseStart - nav.requestStart };
  });
  const result = {
    scope:
      "Local loopback production build, unthrottled Chromium; not a field or staging CWV result",
    viewport: page.viewportSize(),
    observed,
    inp: "Not measured; requires staging interaction and field evidence",
  };
  writeFileSync(
    testInfo.outputPath("b-local-timing.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  await testInfo.attach("local-timing", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});
