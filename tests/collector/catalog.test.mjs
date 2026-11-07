import { it as test } from "vitest";
import assert from "node:assert/strict";
import {
  disabledCatalogPermissions,
  loadPermittedCatalog,
} from "../../packages/domain/src/catalog/provider.ts";
const now = Date.parse("2026-11-07T05:00:00Z");
const grant = () => ({
  approved: true,
  proof_reference: "original-fictional-test-review",
  checked_at: "2026-11-06T00:00:00Z",
  expires_at: null,
  source_id: "original-fixture",
  provider_set_ids: ["original-test"],
});
const approved = () => ({
  metadata: grant(),
  art: grant(),
  licensed_card_art: true,
  image_hosts: ["images.example.test"],
  cleared_image_urls: new Set([
    "https://images.example.test/original-placeholder.svg",
  ]),
});
const raw = () => ({
  provider_set_id: "original-test",
  name: "Original Lumen Grove fixture",
  cards: [
    {
      provider_card_id: "original-001",
      card_number: "001",
      card_name: "Moss Courier",
      variant_status: "explicit",
      variants: [
        {
          provider_variant_id: "original-001-standard",
          finish: "standard",
          image_url: "https://images.example.test/original-placeholder.svg",
        },
      ],
    },
  ],
});
test("Unreviewed metadata never invokes the provider", async () => {
  let calls = 0;
  const provider = {
    source_id: "original-fixture",
    loadSet: async () => {
      calls++;
      return raw();
    },
  };
  const result = await loadPermittedCatalog(
    provider,
    "original-test",
    disabledCatalogPermissions,
    () => now,
  );
  assert.equal(result.kind, "error");
  assert.equal(result.code, "RIGHTS_DISABLED");
  assert.equal(calls, 0);
});
test("Canonical IDs and inventory fields are not inferred or copied from provider data", async () => {
  const result = await loadPermittedCatalog(
    {
      source_id: "original-fixture",
      loadSet: async () => ({
        ...raw(),
        availability_status: "in_stock",
        secret: "must not leak",
      }),
    },
    "original-test",
    approved,
    () => now,
  );
  assert.equal(result.kind, "metadata");
  assert.equal(result.snapshot.provider_set_id, "original-test");
  assert.equal(result.snapshot.curation_required, true);
  assert.equal(Object.hasOwn(result.snapshot, "availability_status"), false);
  assert.equal(Object.hasOwn(result.snapshot, "secret"), false);
  assert.equal(Object.hasOwn(result.snapshot, "id"), false);
});
test("Metadata permission does not grant art; expired or revoked art and unsafe hosts yield null images", async () => {
  const provider = {
    source_id: "original-fixture",
    loadSet: async () => raw(),
  };
  for (const modify of [
    (p) => {
      p.licensed_card_art = false;
    },
    (p) => {
      p.art.approved = false;
    },
    (p) => {
      p.art.expires_at = new Date(now).toISOString();
    },
    (p) => {
      p.image_hosts = ["different.example.test"];
    },
  ]) {
    const permissions = approved();
    modify(permissions);
    const result = await loadPermittedCatalog(
      provider,
      "original-test",
      () => permissions,
      () => now,
    );
    assert.equal(result.snapshot.cards[0].variants[0].image_url, null);
  }
  for (const image of [
    "javascript:alert(1)",
    "http://images.example.test/a",
    "https://images.example.test@evil.test/a",
    "https://images.example.test.evil.test/a",
    "https://127.0.0.1/a",
  ]) {
    const data = raw();
    data.cards[0].variants[0].image_url = image;
    const result = await loadPermittedCatalog(
      { source_id: "original-fixture", loadSet: async () => data },
      "original-test",
      approved,
      () => now,
    );
    assert.equal(result.snapshot.cards[0].variants[0].image_url, null);
  }
});
test("Unknown variants remain unknown despite blanket normal/reverse/holo flags", async () => {
  const data = raw();
  data.cards[0].variant_status = "unknown";
  data.cards[0].variants = { normal: true, reverse: true, holo: true };
  const result = await loadPermittedCatalog(
    { source_id: "original-fixture", loadSet: async () => data },
    "original-test",
    approved,
    () => now,
  );
  assert.equal(result.snapshot.cards[0].variants, null);
});
test("Revocation during fetch blocks metadata; provider errors never expose credentials", async () => {
  let permissions = approved();
  const provider = {
    source_id: "original-fixture",
    loadSet: async () => {
      permissions = disabledCatalogPermissions();
      return raw();
    },
  };
  const revoked = await loadPermittedCatalog(
    provider,
    "original-test",
    () => permissions,
    () => now,
  );
  assert.equal(revoked.code, "RIGHTS_DISABLED");
  const failed = await loadPermittedCatalog(
    {
      source_id: "original-fixture",
      loadSet: async () => {
        throw new Error("SECRET provider token");
      },
    },
    "original-test",
    approved,
    () => now,
  );
  assert.equal(failed.code, "SOURCE_UNAVAILABLE");
  assert.ok(!JSON.stringify(failed).includes("SECRET"));
});
test("Provider set mismatch, duplicate finishes and unsafe IDs cannot silently corrupt the catalog", async () => {
  const wrong = raw();
  wrong.provider_set_id = "different";
  const duplicate = raw();
  duplicate.cards[0].variants.push({
    ...duplicate.cards[0].variants[0],
    provider_variant_id: "another",
  });
  for (const data of [wrong, duplicate])
    assert.equal(
      (
        await loadPermittedCatalog(
          { source_id: "original-fixture", loadSet: async () => data },
          "original-test",
          approved,
          () => now,
        )
      ).code,
      "SOURCE_UNAVAILABLE",
    );
  let called = false;
  const result = await loadPermittedCatalog(
    {
      source_id: "original-fixture",
      loadSet: async () => {
        called = true;
        return raw();
      },
    },
    "../private",
    approved,
    () => now,
  );
  assert.equal(result.code, "VALIDATION_ERROR");
  assert.equal(called, false);
});
test("Grants are bound to provider/set and each cleared asset; hung calls abort at the server deadline", async () => {
  let called = false;
  const blocked = await loadPermittedCatalog(
    {
      source_id: "another-provider",
      loadSet: async () => {
        called = true;
        return raw();
      },
    },
    "original-test",
    approved,
    () => now,
  );
  assert.equal(blocked.code, "RIGHTS_DISABLED");
  assert.equal(called, false);
  const wrongSet = approved();
  wrongSet.metadata.provider_set_ids = ["not-approved"];
  assert.equal(
    (
      await loadPermittedCatalog(
        {
          source_id: "original-fixture",
          loadSet: async () => {
            called = true;
            return raw();
          },
        },
        "original-test",
        () => wrongSet,
        () => now,
      )
    ).code,
    "RIGHTS_DISABLED",
  );
  assert.equal(called, false);
  const data = raw();
  data.cards[0].variants[0].image_url =
    "https://images.example.test/not-cleared.svg";
  const result = await loadPermittedCatalog(
    { source_id: "original-fixture", loadSet: async () => data },
    "original-test",
    approved,
    () => now,
  );
  assert.equal(result.snapshot.cards[0].variants[0].image_url, null);
  let signal;
  const timed = await loadPermittedCatalog(
    {
      source_id: "original-fixture",
      loadSet: async (_, value) => {
        signal = value;
        return new Promise(() => {});
      },
    },
    "original-test",
    approved,
    () => now,
    5,
  );
  assert.equal(timed.code, "SOURCE_UNAVAILABLE");
  assert.equal(signal.aborted, true);
});
