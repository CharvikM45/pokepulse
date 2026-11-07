import { describe, it, expect } from "vitest";
import {
  canCheckProvider,
  featureFlags,
  anonymousAuth,
  requireUser,
} from "../../packages/domain/src";
import {
  products,
  in_stock_fresh,
  demoListings,
  rate_limited_source,
  source_timeout,
} from "../../packages/fixtures/src";
import { demoProductSchema, listingSchema } from "../../packages/contracts/src";
describe("provider permission gate", () => {
  for (const status of ["not_evaluated", "candidate", "denied", "suspended"])
    it(`rejects ${status} even with credentials`, () =>
      expect(
        canCheckProvider(
          {
            status,
            enabled: true,
            reviewer: "reviewer",
            evidence_url: "https://example.com/approval",
          },
          "key",
        ),
      ).toBe(false));
  it("requires evidence, credentials, enablement and approval", () => {
    const approved = {
      status: "approved",
      enabled: true,
      reviewer: "reviewer",
      evidence_url: "https://example.com/approval",
    };
    expect(canCheckProvider(approved, "key")).toBe(true);
    expect(canCheckProvider(approved, undefined)).toBe(false);
    expect(canCheckProvider({ ...approved, enabled: false }, "key")).toBe(
      false,
    );
    expect(canCheckProvider({ ...approved, evidence_url: null }, "key")).toBe(
      false,
    );
    expect(canCheckProvider({}, "key")).toBe(false);
  });
  it("disables all external feature flags", () =>
    expect(Object.values(featureFlags).every((v) => !v)).toBe(true));
});
describe("handoff contracts", () => {
  it("validates explicitly demo fixtures", () => {
    expect(demoProductSchema.parse(products[0]).is_demo).toBe(true);
    expect(listingSchema.parse(in_stock_fresh).is_demo).toBe(true);
  });
  it("ages a historical fixture using server time", () =>
    expect(demoListings(new Date("2026-11-07T00:00:00Z"))[0]).toMatchObject({
      availability_status: "unknown",
      freshness: "stale",
    }));
  it("never manufactures negative stock for failures", () => {
    for (const result of [rate_limited_source, source_timeout]) {
      expect(result.kind).toBe("temporary_error");
      expect(result).not.toHaveProperty("observation");
    }
  });
  it("does not fabricate signed-in identity", async () => {
    expect(await anonymousAuth.getUser()).toBeNull();
    await expect(requireUser(anonymousAuth)).rejects.toThrow("UNAUTHENTICATED");
  });
});
