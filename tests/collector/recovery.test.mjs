import { it as test } from "vitest";
import assert from "node:assert/strict";
import {
  parsePendingOpening,
  recoveryKeys,
  savedOpeningId,
} from "../../packages/domain/src/packs/recovery.ts";
const userA = "40000000-0000-4000-8000-000000000001",
  userB = "40000000-0000-4000-8000-000000000002";
const request = {
  version: 1,
  key: "60000000-0000-4000-8000-000000000001",
  body: {
    set_id: "10000000-0000-4000-8000-000000000001",
    use_free_open: false,
  },
};
test("Recovery reference preserves the original key/body without card results or account tokens", () => {
  assert.deepEqual(parsePendingOpening(JSON.stringify(request)), request);
  assert.equal(
    parsePendingOpening(
      JSON.stringify({ ...request, cards: ["private result"] }),
    ),
    null,
  );
  assert.equal(
    parsePendingOpening(
      JSON.stringify({ ...request, body: { ...request.body, seed: 42 } }),
    ),
    null,
  );
});
test("Recovery keys are partitioned by verified UUID and reject token-like scopes", () => {
  assert.notEqual(recoveryKeys(userA).pending, recoveryKeys(userB).pending);
  assert.notEqual(recoveryKeys(userA).pending, recoveryKeys(userA).opening);
  assert.throws(
    () => recoveryKeys("access-token-like-value"),
    /INVALID_USER_SCOPE/,
  );
  assert.equal(savedOpeningId(request.key), request.key);
  assert.equal(savedOpeningId("not-a-uuid"), null);
});
test("Malformed/oversized/unknown-version cache cannot trigger a request", () => {
  for (const raw of [
    "{bad",
    "x".repeat(2049),
    JSON.stringify({ ...request, version: 2 }),
    JSON.stringify({ ...request, key: "bad" }),
    JSON.stringify({
      ...request,
      body: { ...request.body, use_free_open: "yes" },
    }),
  ])
    assert.equal(parsePendingOpening(raw), null);
});
