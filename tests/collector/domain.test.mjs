import { it as test } from "vitest";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import {
  ids,
  variants,
  manifest,
  config,
  fixtureNow,
  reportFixtures,
} from "../../packages/fixtures/src/b-domain.ts";
import {
  collectionProgress,
  missingChecklist,
  missingCsv,
  csvCell,
  validateManifest,
  validateRealEdit,
} from "../../packages/domain/src/collections/policies.ts";
import {
  publicReports,
  nearbyQuery,
  observationTime,
  checkReportRate,
  validateReportNotes,
  approvalEnvelope,
} from "../../packages/domain/src/radar/policies.ts";
import {
  drawSlots,
  validateConfig,
  allowanceAvailable,
} from "../../packages/domain/src/packs/policies.ts";
import { releaseDateLabel } from "../../packages/domain/src/calendar/dates.ts";

test("Base counts numbered cards once, Master counts exact variants, duplicates do not inflate progress", () => {
  const entries = [
    { variant_id: ids.moss, quantity: 5 },
    { variant_id: ids.mossFoil, quantity: 2 },
  ];
  const result = collectionProgress("virtual", manifest, variants, entries);
  assert.deepEqual(result.base, { collected: 1, required: 3 });
  assert.deepEqual(result.master, { collected: 2, required: 4 });
  assert.deepEqual(result.extended, { collected: 2, required: 5 });
  assert.equal(result.manifest_version, "fictional-1");
});
test("Foil satisfies Base, but standard and foil remain separately missing for Master", () => {
  const entries = [{ variant_id: ids.mossFoil, quantity: 1 }];
  assert.equal(missingChecklist("base", manifest, variants, entries).length, 2);
  assert.ok(
    missingChecklist("master", manifest, variants, entries).some((r) =>
      r.variant_ids.includes(ids.moss),
    ),
  );
});
test("Base groups cannot merge different numbered cards or split one number into two requirements", () => {
  const collapsed = structuredClone(manifest);
  const first = collapsed.requirements.find((r) => r.scope === "base");
  collapsed.requirements.find(
    (r) => r.scope === "base" && r.variant_id === ids.lantern,
  ).collectible_key = first.collectible_key;
  assert.throws(
    () => validateManifest(collapsed, variants),
    /INVALID_BASE_GROUP/,
  );
  const split = structuredClone(manifest);
  split.requirements.find(
    (r) => r.scope === "base" && r.variant_id === ids.mossFoil,
  ).collectible_key = "separate-finish";
  assert.throws(() => validateManifest(split, variants), /INVALID_BASE_GROUP/);
  assert.throws(
    () =>
      validateManifest(
        { ...manifest, supported_goals: ["base", "base"] },
        variants,
      ),
    /DUPLICATE_GOAL/,
  );
});
test("Real and virtual policies consume distinct inventories without mutating either", () => {
  const virtual = [{ variant_id: ids.moss, quantity: 1 }],
    real = [];
  assert.equal(
    collectionProgress("real", manifest, variants, real).base.collected,
    0,
  );
  assert.equal(
    collectionProgress("virtual", manifest, variants, virtual).base.collected,
    1,
  );
  assert.deepEqual(real, []);
});
test("Unsupported or unvalidated scope never becomes complete", () => {
  assert.throws(
    () => validateManifest({ ...manifest, validated: false }, variants),
    /INCOMPLETE/,
  );
  const incomplete = {
    ...manifest,
    supported_goals: ["base"],
    requirements: manifest.requirements.filter((r) => r.scope === "base"),
  };
  assert.equal(
    collectionProgress("real", incomplete, variants, []).master,
    null,
  );
  assert.throws(
    () => missingChecklist("master", incomplete, variants, []),
    /INCOMPLETE_GOAL/,
  );
  assert.throws(
    () => validateManifest({ ...manifest, requirements: [] }, variants),
    /EMPTY_GOAL/,
  );
});
test("Unrelated sets with identical card numbers cannot satisfy manifest requirements", () => {
  const foreign = {
    ...variants[0],
    id: "20000000-0000-4000-8000-000000000099",
    set_id: "10000000-0000-4000-8000-000000000099",
  };
  const result = collectionProgress(
    "real",
    manifest,
    [...variants, foreign],
    [{ variant_id: foreign.id, quantity: 1 }],
  );
  assert.equal(result.base.collected, 0);
  assert.throws(
    () =>
      validateManifest(
        {
          ...manifest,
          requirements: [
            { ...manifest.requirements[0], variant_id: foreign.id },
          ],
        },
        [...variants, foreign],
      ),
    /INVALID_VARIANT/,
  );
});
test("Manifest migration changes denominator explicitly and preserves supplied version", () => {
  const next = {
    ...manifest,
    version: "fictional-2",
    requirements: manifest.requirements.filter(
      (r) => r.variant_id !== ids.mossFoil,
    ),
  };
  const result = collectionProgress("real", next, variants, [
    { variant_id: ids.mossFoil, quantity: 1 },
  ]);
  assert.equal(result.manifest_version, "fictional-2");
  assert.deepEqual(result.master, { collected: 0, required: 3 });
});
test("Real edits reject unsupported variants, fractional/negative/excessive quantity and oversized notes", () => {
  assert.throws(
    () => validateRealEdit("missing", 1, "", variants),
    /INVALID_VARIANT/,
  );
  for (const count of [-1, 0.5, NaN, 10000])
    assert.throws(
      () => validateRealEdit(ids.moss, count, "", variants),
      /INVALID_QUANTITY/,
    );
  assert.throws(
    () => validateRealEdit(ids.moss, 1, "x".repeat(501), variants),
    /INVALID_NOTES/,
  );
  assert.equal(
    validateRealEdit(ids.moss, 0, "  note  ", variants).notes,
    "note",
  );
});
test("CSV escapes quotes, commas/newlines and formula prefixes including leading controls", () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell("\t=1+1"), '"\'\t=1+1"');
  assert.equal(csvCell("@SUM(A1)"), '"\'@SUM(A1)"');
  const csv = missingCsv("base", manifest, variants, []);
  assert.equal(csv.split("\r\n").length, 5);
  assert.ok(csv.includes("fictional-1"));
});
test("Pending/rejected/expired community reports are excluded at read time", () => {
  const expired = {
    ...reportFixtures.community_found_approved,
    expires_at: new Date(fixtureNow).toISOString(),
  };
  assert.deepEqual(
    publicReports(
      [
        reportFixtures.community_found_pending,
        reportFixtures.community_report_expired,
        expired,
        { ...expired, moderation: "rejected" },
      ],
      [],
      fixtureNow,
    ),
    [],
  );
});
test("Public projection strips private fields, deduplicates independent confirmations and shows conflict", () => {
  const approved = reportFixtures.community_found_approved;
  const reports = [approved, reportFixtures.community_shelf_empty_conflict];
  const confirmations = [
    { sighting_id: approved.id, user_id: ids.userA },
    { sighting_id: approved.id, user_id: ids.userB },
    { sighting_id: approved.id, user_id: ids.userB },
  ];
  const row = publicReports(
    reports.map((r) => ({ ...r, secret: "must not leak" })),
    confirmations,
    fixtureNow,
  ).find((r) => r.id === approved.id);
  assert.equal(row.independent_confirmations, 1);
  assert.equal(row.conflict_count, 1);
  assert.ok(!JSON.stringify(row).includes(ids.userA));
  assert.ok(!("secret" in row));
  assert.ok(!("reporter_id" in row));
  assert.equal(row.is_demo, true);
});
test("Same account cannot manufacture conflicting independent reports", () => {
  const rows = publicReports(
    [
      reportFixtures.community_found_approved,
      {
        ...reportFixtures.community_shelf_empty_conflict,
        reporter_id: ids.userA,
      },
    ],
    [],
    fixtureNow,
  );
  assert.equal(rows[0].conflict_count, 0);
});
test("ZIP and radius validation are bounded without requesting geolocation", () => {
  assert.deepEqual(nearbyQuery("02110", 25), { zip: "02110", radius_mi: 25 });
  for (const zip of ["2110", "02110-1234", "abcde"])
    assert.throws(() => nearbyQuery(zip, 25), /INVALID_ZIP/);
  for (const radius of [0, 101, 1.5, NaN])
    assert.throws(() => nearbyQuery("02110", radius), /INVALID_RADIUS/);
});
test("Observation validation rejects future, normalized invalid date, offset and old times", () => {
  assert.equal(
    observationTime("2026-11-06T17:00:00Z", fixtureNow),
    "2026-11-06T17:00:00.000Z",
  );
  for (const value of [
    "2026-11-06T19:00:00Z",
    "2026-11-01T10:00:00Z",
    "2026-02-30T10:00:00Z",
    "2026-11-06T17:00:00-01:00",
  ]) {
    assert.throws(() => observationTime(value, fixtureNow), /INVALID_TIME/);
  }
});
test("Notes reject markup/contact details; approval event excludes notes and private author", () => {
  for (const note of [
    "<script>bad()</script>",
    "contact a@example.com",
    "+1 (555) 123-4567",
    "https://example.com",
  ]) {
    assert.throws(() => validateReportNotes(note));
  }
  assert.equal(validateReportNotes("  Saw two boxes  "), "Saw two boxes");
  const event = approvalEnvelope(
    reportFixtures.community_found_approved,
    fixtureNow,
    1,
  );
  assert.equal(event.evidence_type, "moderated_report");
  assert.equal(
    event.event_id,
    approvalEnvelope(reportFixtures.community_found_approved, fixtureNow, 1)
      .event_id,
  );
  assert.ok(!("reporter_id" in event));
  assert.ok(!("public_notes" in event));
  assert.throws(
    () =>
      approvalEnvelope(reportFixtures.community_report_expired, fixtureNow, 1),
    /NOT_CURRENT/,
  );
});
test("Per-account cooldown, daily cap and current same-scope duplication are rejected", () => {
  const report = reportFixtures.community_found_pending;
  assert.throws(
    () =>
      checkReportRate(
        [{ ...report, submitted_at: "2026-11-06T17:59:59Z" }],
        ids.userA,
        ids.store,
        null,
        fixtureNow,
      ),
    /RATE_LIMITED/,
  );
  assert.throws(
    () => checkReportRate([report], ids.userA, ids.store, null, fixtureNow),
    /DUPLICATE_REPORT/,
  );
  assert.throws(
    () =>
      checkReportRate(
        Array.from({ length: 10 }, () => report),
        ids.userA,
        "other-store",
        null,
        fixtureNow,
      ),
    /RATE_LIMITED/,
  );
  assert.doesNotThrow(() =>
    checkReportRate([report], ids.userB, ids.store, null, fixtureNow),
  );
});
test("Calendar day-only dates do not shift; month/unconfirmed keep precision", () => {
  assert.equal(releaseDateLabel("2026-11-06", "day"), "November 6, 2026");
  assert.equal(releaseDateLabel("2026-11", "month"), "November 2026");
  assert.equal(releaseDateLabel("", "unconfirmed"), "Date unconfirmed");
  assert.throws(() => releaseDateLabel("2026-02-30", "day"), /INVALID_DATE/);
});
test("Slot endpoints and exact configured boundaries choose only declared variants", () => {
  assert.deepEqual(
    drawSlots(config, variants, () => 0),
    [
      { card_variant_id: ids.moss, slot_index: 0 },
      { card_variant_id: ids.moss, slot_index: 1 },
    ],
  );
  assert.deepEqual(
    drawSlots(config, variants, (max) => max - 1),
    [
      { card_variant_id: ids.lantern, slot_index: 0 },
      { card_variant_id: ids.cloud, slot_index: 1 },
    ],
  );
  assert.throws(() => drawSlots(config, variants, (max) => max), /INVALID_RNG/);
});
test("Disabled rights, promo/unsupported finishes, invalid weights and slot indices are rejected", () => {
  assert.throws(
    () => validateConfig({ ...config, rights_status: "disabled" }, variants),
    /RIGHTS_DISABLED/,
  );
  assert.throws(
    () => validateConfig({ ...config, enabled: false }, variants),
    /RIGHTS_DISABLED/,
  );
  assert.throws(
    () =>
      validateConfig(
        {
          ...config,
          slots: [
            { slot_index: 0, pool: [{ variant_id: ids.promo, weight: 1 }] },
          ],
        },
        variants,
      ),
    /UNSUPPORTED_VARIANT/,
  );
  assert.throws(
    () =>
      validateConfig(
        {
          ...config,
          slots: [
            { slot_index: 0, pool: [{ variant_id: ids.moss, weight: 0 }] },
          ],
        },
        variants,
      ),
    /INVALID_WEIGHT/,
  );
  assert.throws(
    () => validateConfig({ ...config, slots: [config.slots[1]] }, variants),
    /INVALID_SLOTS/,
  );
});
test("Seeded harness produces stable results; production seed is not part of any request contract", () => {
  function seeded() {
    let state = 7;
    return (max) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor((state / 2 ** 32) * max);
    };
  }
  assert.deepEqual(
    drawSlots(config, variants, seeded()),
    drawSlots(config, variants, seeded()),
  );
});
test("Exhaustive configured-weight tickets reproduce the fictional distribution exactly", () => {
  const last = { ...config, slots: [{ ...config.slots[1], slot_index: 0 }] };
  const counts = new Map();
  for (let sample = 0; sample < 100; sample++) {
    const id = drawSlots(last, variants, () => sample)[0].card_variant_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), {
    [ids.moss]: 70,
    [ids.mossFoil]: 25,
    [ids.cloud]: 5,
  });
});
test("Large-run CSPRNG sample stays within broad configured-distribution tolerance", () => {
  const counts = new Map();
  const n = 20000;
  for (let sample = 0; sample < n; sample++) {
    const id = drawSlots(config, variants, randomInt)[1].card_variant_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, expected] of [
    [ids.moss, 0.7],
    [ids.mossFoil, 0.25],
    [ids.cloud, 0.05],
  ]) {
    assert.ok(Math.abs((counts.get(id) ?? 0) / n - expected) < 0.025);
  }
});
test("UTC daily allowance resets deterministically without stacking and rejects future prior usage", () => {
  assert.equal(allowanceAvailable(null, fixtureNow), true);
  assert.equal(allowanceAvailable("2026-11-06T00:00:00Z", fixtureNow), false);
  assert.equal(
    allowanceAvailable(
      "2026-11-05T23:59:59Z",
      Date.parse("2026-11-06T00:00:00Z"),
    ),
    true,
  );
  assert.equal(allowanceAvailable("2026-11-07T00:00:00Z", fixtureNow), false);
});
