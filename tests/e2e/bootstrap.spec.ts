import { test, expect } from "@playwright/test";
test("anonymous mobile catalog is explicitly demo", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Find your next pack/ }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "DEMO DATA — synthetic products and offers. No live retailer verification.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/bootstrap-mobile.png",
    fullPage: true,
  });
});
test("public APIs validate inputs and preserve demo provenance", async ({
  request,
}) => {
  for (const endpoint of ["products", "drops"]) {
    const response = await request.get(`/api/v1/${endpoint}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data[0].is_demo).toBe(true);
    expect(body.meta.request_id).toBeTruthy();
    expect(body.meta.next_cursor).toBeTruthy();
    const invalid = await request.get(`/api/v1/${endpoint}?limit=51`);
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error.code).toBe("VALIDATION_ERROR");
  }
  const drops = await (await request.get("/api/v1/drops")).json();
  expect(drops.data[0].evidence_summary).toContain("DEMO DATA");
});
test("50-product pagination, product detail and public filters", async ({
  request,
}) => {
  const first = await (await request.get("/api/v1/products?limit=50")).json();
  expect(first.data).toHaveLength(50);
  const detail = await (
    await request.get("/api/v1/products/" + first.data[0].id)
  ).json();
  expect(detail.data.offers).toHaveLength(2);
  const missing = await request.get(
    "/api/v1/products/99999999-9999-4999-8999-999999999999",
  );
  expect(missing.status()).toBe(404);
  const page = await (await request.get("/api/v1/products?limit=20")).json();
  const next = await (
    await request.get(
      "/api/v1/products?limit=20&cursor=" + page.meta.next_cursor,
    )
  ).json();
  expect(next.data[0].id).not.toBe(page.data[0].id);
  const filtered = await (
    await request.get("/api/v1/drops?seller_type=third_party")
  ).json();
  expect(filtered.data).toHaveLength(1);
  expect(
    (await request.get("/api/v1/drops?max_price_minor=5000")).status(),
  ).toBe(400);
});
test("anonymous account/admin access and cross-origin writes reject", async ({
  request,
}) => {
  for (const path of [
    "me/watchlist",
    "me/alert-rules",
    "me/notifications",
    "me/privacy-jobs",
    "admin/sources",
  ]) {
    const r = await request.get("/api/v1/" + path);
    expect(r.status()).toBe(401);
    expect((await r.json()).error.code).toBe("UNAUTHENTICATED");
  }
  const csrf = await request.post("/api/v1/me/watchlist", {
    headers: { Origin: "https://evil.example" },
    data: { product_id: "10000000-0000-4000-8000-000000000001" },
  });
  expect(csrf.status()).toBe(403);
});
