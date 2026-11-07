// Real GoTrue/PostgREST/Next HTTP acceptance against a disposable local Supabase.
// Never accepts a hosted URL or populated production database.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

if (process.env.B_ACCEPT_DISPOSABLE_LOCAL !== "true")
  throw new Error("Explicit disposable-local acceptance opt-in required");
const statusFile = process.argv[2];
if (!statusFile) throw new Error("Supply supabase status -o env output file");
const status = Object.fromEntries(
  (await readFile(statusFile, "utf8")).split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z_]+)="(.*)"$/.exec(line.trim());
    return match ? [[match[1], match[2]]] : [];
  }),
);
for (const name of ["API_URL", "DB_URL", "ANON_KEY", "SERVICE_ROLE_KEY"])
  assert(status[name], `Missing Supabase status field ${name}`);
for (const name of ["API_URL", "DB_URL"])
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(status[name]).hostname,
    ),
    "Only loopback services are allowed",
  );
const origin = "http://127.0.0.1:3000";
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  APP_ORIGIN: origin,
};
const pool = new pg.Pool({ connectionString: status.DB_URL });
const setId = "10000000-0000-4000-8000-000000000001";
const storeId = "30000000-0000-4000-8000-000000000001";
const variantId = "20000000-0000-4000-8000-000000000001";
const users = [];
const checks = [];
let server;

async function admin(path, method = "GET", body) {
  const response = await fetch(status.API_URL + "/auth/v1/admin" + path, {
    method,
    headers: {
      apikey: status.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  assert(response.ok, `GoTrue admin ${method} failed with ${response.status}`);
  return response.status === 204 ? null : response.json();
}
function actor() {
  const jar = new Map();
  return async (
    path,
    {
      method = "GET",
      body,
      key = crypto.randomUUID(),
      expected = 200,
      requestOrigin = origin,
      raw = false,
    } = {},
  ) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
        Origin: requestOrigin,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
      redirect: "manual",
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const split = pair.indexOf("=");
      jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    assert.equal(
      response.status,
      expected,
      `${method} ${path} returned ${response.status}, expected ${expected}`,
    );
    if (raw) return response.text();
    const result = await response.json();
    assert(result.meta?.request_id, `${path} missing response envelope`);
    return expected < 400 ? result.data : result.error;
  };
}
function worker(mode) {
  execFileSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "services/notification-worker/run.ts",
      mode,
    ],
    { env, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 },
  );
}
async function check(name, task) {
  await task();
  checks.push(name);
  console.log(`PASS ${name}`);
}
try {
  assert.equal(
    (await pool.query("select count(*)::int n from auth.users")).rows[0].n,
    0,
    "Acceptance requires a fresh disposable auth database",
  );
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from public.tcg_sets where id=$1 and is_demo",
        [setId],
      )
    ).rows[0].n,
    1,
  );
  await pool.query(
    "update public.feature_flags set enabled=true where name in ('pack_lab','local_radar');update public.b_pack_settings set enabled=true,allow_demo=true;update public.b_radar_settings set enabled=true,allow_demo=true",
  );
  for (let index = 0; index < 3; index++) {
    const email = `collector-${crypto.randomUUID()}@example.test`,
      password = `Fixture-${crypto.randomUUID()}-9z!`;
    const created = await admin("/users", "POST", {
      email,
      password,
      email_confirm: true,
    });
    users.push({ id: created.id, email, password, call: actor() });
  }
  const [a, b, staff] = users;
  await pool.query("insert into public.staff_members(user_id) values($1)", [
    staff.id,
  ]);
  server = spawn(
    process.execPath,
    [
      "apps/web/node_modules/next/dist/bin/next",
      "start",
      "apps/web",
      "-H",
      "127.0.0.1",
    ],
    { env, stdio: "ignore" },
  );
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Application server exited before readiness");
    try {
      if (
        (
          await fetch(origin + "/api/v1/products", {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await delay(1000);
  }
  assert(ready, "Application readiness timeout");
  const anonymous = actor();
  await check(
    "real auth, session cookies, anonymous denial and CSRF",
    async () => {
      await anonymous("/api/v1/me/session", { expected: 401 });
      await anonymous("/api/v1/packs/open", {
        method: "POST",
        body: { set_id: setId },
        expected: 401,
      });
      for (const user of users) {
        await user.call("/auth/sign-in", {
          method: "POST",
          body: { email: user.email, password: user.password },
        });
        assert.equal((await user.call("/api/v1/me/session")).id, user.id);
      }
      await a.call("/api/v1/me/watchlist", {
        method: "POST",
        body: { product_id: setId },
        requestOrigin: "https://untrusted.example",
        expected: 403,
      });
    },
  );
  const products = await anonymous("/api/v1/products?limit=50");
  const productId = products[0].id;
  await check(
    "watch idempotency and two-user private HTTP isolation",
    async () => {
      const key = crypto.randomUUID(),
        body = { product_id: productId, listing_id: null };
      const first = await a.call("/api/v1/me/watchlist", {
        method: "POST",
        key,
        body,
      });
      assert.equal(
        (await a.call("/api/v1/me/watchlist", { method: "POST", key, body }))
          .id,
        first.id,
      );
      assert.equal((await a.call("/api/v1/me/watchlist")).length, 1);
      assert.equal((await b.call("/api/v1/me/watchlist")).length, 0);
    },
  );
  await check(
    "atomic pack replay, saved history and real/virtual separation",
    async () => {
      const key = crypto.randomUUID(),
        body = { set_id: setId, use_free_open: false };
      const opening = await a.call("/api/v1/packs/open", {
        method: "POST",
        key,
        body,
      });
      assert.equal(
        (await a.call("/api/v1/packs/open", { method: "POST", key, body })).id,
        opening.id,
      );
      await b.call(`/api/v1/me/pack-openings/${opening.id}`, { expected: 404 });
      assert.equal(
        (await a.call(`/api/v1/me/pack-openings/${opening.id}`)).id,
        opening.id,
      );
      const read = (mode, user = a) =>
        user.call(`/api/v1/me/collections?set_id=${setId}&mode=${mode}`);
      const virtual = await read("virtual");
      assert.equal(
        virtual.entries.reduce((sum, entry) => sum + entry.quantity, 0),
        2,
      );
      assert.equal((await read("real")).entries.length, 0);
      const editKey = crypto.randomUUID(),
        edit = {
          card_variant_id: variantId,
          quantity: 3,
          notes: "Private fixture note",
        };
      await a.call("/api/v1/me/collections/real", {
        method: "PATCH",
        key: editKey,
        body: edit,
      });
      await a.call("/api/v1/me/collections/real", {
        method: "PATCH",
        body: { ...edit, quantity: 5 },
      });
      await a.call("/api/v1/me/collections/real", {
        method: "PATCH",
        key: editKey,
        body: edit,
      });
      assert.equal(
        (await read("real")).entries.find(
          (entry) => entry.variant_id === variantId,
        ).quantity,
        5,
      );
      assert.deepEqual((await read("virtual")).entries, virtual.entries);
      assert.equal((await read("real", b)).entries.length, 0);
      const csv = await a.call(
        `/api/v1/me/collections/missing-export?set_id=${setId}&mode=real&goal=base`,
        { raw: true },
      );
      assert(csv.includes("real"));
      await pool.query(
        "update public.feature_flags set enabled=false where name='pack_lab'",
      );
      assert.equal(
        (await a.call("/api/v1/packs/open", { method: "POST", key, body })).id,
        opening.id,
      );
      await a.call("/api/v1/packs/open", {
        method: "POST",
        body,
        expected: 403,
      });
      await pool.query(
        "update public.feature_flags set enabled=true where name='pack_lab'",
      );
    },
  );
  let report;
  await check(
    "pending report, independent staff approval, A worker to inbox and reversal",
    async () => {
      const rule = {
        enabled: true,
        product_ids: [productId],
        set_names: [],
        retailer_ids: [],
        product_types: [],
        seller_types: [],
        channels: [],
        evidence_types: ["moderated_report"],
        max_price_minor: null,
        currency: null,
        store_ids: [storeId],
        zip: null,
        radius_mi: null,
        triggers: ["local_sighting"],
        delivery_channels: ["in_app"],
        quiet_hours: null,
        daily_cap: 20,
        cooldown_minutes: 0,
      };
      const savedRule = await b.call("/api/v1/me/alert-rules", {
        method: "POST",
        body: rule,
      });
      report = await a.call("/api/v1/sightings", {
        method: "POST",
        expected: 201,
        body: {
          store_id: storeId,
          product_id: productId,
          report_type: "found_stock",
          observed_at: new Date().toISOString(),
          notes: "Private fixture report",
        },
      });
      assert.equal(report.moderation, "pending");
      assert.equal(
        (await anonymous(`/api/v1/stores/${storeId}/sightings`)).length,
        0,
      );
      await a.call("/api/v1/sightings/confirm", {
        method: "POST",
        body: { id: report.id },
        expected: 404,
      });
      const body = {
        decision: "approved",
        reason: "Independent fixture review",
        public_notes: null,
        expected_revision: 0,
      };
      await a.call(`/api/v1/admin/sightings/${report.id}/moderate`, {
        method: "POST",
        body,
        expected: 403,
      });
      const approved = await staff.call(
        `/api/v1/admin/sightings/${report.id}/moderate`,
        { method: "POST", body },
      );
      assert.equal(approved.revision, 1);
      await a.call("/api/v1/sightings/confirm", {
        method: "POST",
        body: { id: report.id },
        expected: 403,
      });
      await b.call("/api/v1/sightings/confirm", {
        method: "POST",
        body: { id: report.id },
      });
      const visible = await anonymous(`/api/v1/stores/${storeId}/sightings`);
      assert.equal(visible.length, 1);
      assert(!JSON.stringify(visible).includes("Private fixture report"));
      worker("match");
      const inbox = await b.call("/api/v1/me/notifications");
      assert.equal(inbox.length, 1);
      assert.equal(inbox[0].rule_id, savedRule.id);
      assert.equal((await a.call("/api/v1/me/notifications")).length, 0);
      worker("match");
      assert.equal((await b.call("/api/v1/me/notifications")).length, 1);
      await staff.call(`/api/v1/admin/sightings/${report.id}/moderate`, {
        method: "POST",
        body: {
          decision: "rejected",
          reason: "Fixture reversal",
          public_notes: null,
          expected_revision: 1,
        },
      });
      assert.equal(
        (await anonymous(`/api/v1/stores/${storeId}/sightings`)).length,
        0,
      );
      assert.equal(
        (await b.call("/api/v1/me/notifications"))[0].title,
        "Community report no longer current",
      );
    },
  );
  await check(
    "private export, registered B hooks and completed account erasure",
    async () => {
      const job = await a.call("/api/v1/me/export", {
        method: "POST",
        body: {},
        expected: 202,
      });
      assert.equal(job.status, "pending");
      await a.call(`/api/v1/me/export/${job.id}`, { expected: 409 });
      await b.call(`/api/v1/me/export/${job.id}`, { expected: 404 });
      worker("privacy");
      const exported = await a.call(`/api/v1/me/export/${job.id}`);
      for (const name of ["radar", "binder", "packs"])
        assert(Object.hasOwn(exported, name), `Missing ${name} privacy hook`);
      const deletion = await a.call("/api/v1/me/delete-request", {
        method: "POST",
        body: {},
        expected: 202,
      });
      assert.equal(deletion.status, "pending");
      await a.call("/api/v1/me/collections/real", {
        method: "PATCH",
        body: { card_variant_id: variantId, quantity: 1 },
        expected: 409,
      });
      worker("privacy");
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from auth.users where id=$1",
            [a.id],
          )
        ).rows[0].n,
        0,
      );
      for (const table of [
        "wallets",
        "virtual_inventory",
        "real_inventory",
        "pack_openings",
      ])
        assert.equal(
          (
            await pool.query(
              `select count(*)::int n from public.${table} where user_id=$1`,
              [a.id],
            )
          ).rows[0].n,
          0,
          `${table} erasure`,
        );
      assert.equal(
        (
          await pool.query(
            "select status from public.privacy_jobs where id=$1",
            [deletion.id],
          )
        ).rows[0].status,
        "completed",
      );
      await a.call("/api/v1/me/session", { expected: 401 });
      assert.equal((await b.call("/api/v1/me/session")).id, b.id);
      await b.call("/auth/sign-out", { method: "POST", body: {} });
      await b.call("/api/v1/me/session", { expected: 401 });
    },
  );
  await mkdir("test-results/collector-http", { recursive: true });
  await writeFile(
    "test-results/collector-http/summary.json",
    JSON.stringify(
      {
        backend:
          "Disposable Docker Supabase GoTrue/PostgREST and production Next",
        checks,
        passed: checks.length,
        limitations: [
          "No hosted email or recovery delivery",
          "No device push or manual screen-reader claim",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (server) {
    server.kill();
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      delay(5000),
    ]);
  }
  for (const user of users) {
    try {
      await admin(`/users/${user.id}`, "DELETE");
    } catch {}
  }
  await pool.end();
}
