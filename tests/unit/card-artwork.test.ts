import { describe, expect, it } from "vitest";
import { variantSchema } from "../../packages/contracts/src/collector";
const card = {
  id: "20000000-0000-4000-8000-000000000001",
  set_id: "10000000-0000-4000-8000-000000000001",
  card_name: "Pikachu",
  card_number: "58",
  finish: "standard",
  eligible_for_packs: true,
};
describe("collection artwork boundary", () => {
  it("keeps existing metadata without artwork compatible", () => {
    expect(variantSchema.parse(card).image_url).toBeNull();
  });
  it("accepts an approved exact-card scan", () => {
    expect(
      variantSchema.parse({
        ...card,
        image_url: "https://assets.tcgdex.net/en/base/base1/58/high.webp",
        image_rights_cleared: true,
      }).image_url,
    ).toContain("/58/");
  });
  it("rejects uncleared scans and non-HTTPS image sources", () => {
    expect(
      variantSchema.safeParse({
        ...card,
        image_url: "https://example.com/card.webp",
      }).success,
    ).toBe(false);
    expect(
      variantSchema.safeParse({
        ...card,
        image_url: "http://example.com/card.webp",
        image_rights_cleared: true,
      }).success,
    ).toBe(false);
  });
});
