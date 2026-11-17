import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("new card archive APIs are bounded and never invent a global fixture catalog", async ({
  request,
}) => {
  for (const path of [
    "cards?limit=51",
    "cards?sort=unknown",
    "cards?unexpected=true",
    "card-sets?limit=100",
    "artists?limit=0",
  ]) {
    expect((await request.get("/api/v1/" + path)).status()).toBe(400);
  }
  const coverage = await (await request.get("/api/v1/cards/coverage")).json();
  expect(coverage.data.printings).toBe(0);
  expect(coverage.data.approved_providers).toEqual([]);
  expect(
    (await (await request.get("/api/v1/cards")).json()).data.cards,
  ).toEqual([]);
  for (const path of [
    "me/portfolio",
    "me/card-actions?card_id=92222222-2222-4222-8222-222222222222",
    "me/collection-lots",
    "me/collection-export",
    "admin/card-catalog",
  ]) {
    expect((await request.get("/api/v1/" + path)).status()).toBe(401);
  }
  const csrf = await request.post("/api/v1/me/collection-lots", {
    headers: { Origin: "https://untrusted.example" },
    data: {},
  });
  expect(csrf.status()).toBe(403);
});
test("card archive, artist index, market and private portfolio retain usable mobile states", async ({
  page,
}) => {
  for (const route of [
    "/cards",
    "/card-sets",
    "/artists",
    "/market",
    "/collection/portfolio",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator(".pp-skeleton")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.goto("/cards");
  await page
    .getByRole("combobox", { name: "Find a card", exact: true })
    .fill("Pikachu");
  await page.getByRole("button", { name: "Explore cards" }).click();
  await expect(page).toHaveURL(/q=Pikachu/);
  await expect(
    page.getByRole("heading", {
      name: "The archive is waiting for its first approved import",
    }),
  ).toBeVisible();
});
