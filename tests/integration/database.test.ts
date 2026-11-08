import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  for (const name of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.exec(`insert into auth.users values('${a}'),('${b}');`);
}, 120000);
afterAll(async () => {
  await db?.close();
});
it("runs all migrations and creates private profiles", async () => {
  const r = await db.query<{ n: number }>(
    "select count(*)::int as n from public.profiles",
  );
  expect(r.rows[0].n).toBe(2);
});
it("enforces cross-user reads and denies direct writes", async () => {
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);`,
  );
  expect((await db.query("select * from public.profiles")).rows).toHaveLength(
    1,
  );
  await expect(
    db.exec(
      `update public.user_preferences set in_app=true where user_id='${b}'`,
    ),
  ).rejects.toThrow();
  await expect(
    db.query(`select public.admin_source('demo','{}')`),
  ).rejects.toThrow("FORBIDDEN");
  await db.exec("reset role");
});
it("rejects anonymous private mutation and worker RPC access", async () => {
  await db.exec(
    `set role anon;select set_config('request.jwt.claim.sub','',false)`,
  );
  await expect(db.query("select * from public.watchlists")).rejects.toThrow();
  await expect(
    db.query(`select public.account_write('export',gen_random_uuid(),'{}')`),
  ).rejects.toThrow();
  await expect(db.query("select public.claim_check()")).rejects.toThrow();
  await db.exec("reset role");
});
it("enforces account idempotency and preference ownership", async () => {
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false)`,
  );
  const key = "33333333-3333-4333-8333-333333333333";
  const call = () =>
    db.query(
      `select public.account_write('preferences','${key}','{"in_app":true}') as result`,
    );
  expect((await call()).rows).toEqual((await call()).rows);
  await expect(
    db.query(
      `select public.account_write('preferences','${key}','{"in_app":false}')`,
    ),
  ).rejects.toThrow("CONFLICT");
  await db.exec("reset role");
  expect(
    (
      await db.query<{ in_app: boolean }>(
        `select in_app from public.user_preferences where user_id='${b}'`,
      )
    ).rows[0].in_app,
  ).toBe(false);
});
const listing = "20000000-0000-4000-8000-000000000001";
let clock = new Date("2026-11-06T12:00:00Z");
async function setupSource() {
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  await db.exec(
    `update public.source_permissions set status='approved',enabled=true,reviewer='automated-fixture-test',evidence_url='https://example.com/test',quota_per_hour=1000 where id='demo';insert into public.source_health(source_id) values('demo') on conflict do nothing;`,
  );
}
async function observe(
  status: string,
  options: { observed?: Date; price?: number | null; kind?: string } = {},
) {
  clock = new Date(clock.getTime() + 1000);
  const key = crypto.randomUUID();
  await db.query(
    `insert into public.source_check_jobs(id,listing_id,source_id,scheduled_for,available_at) values($1,$2,'demo',$3,$3)`,
    [key, listing, clock],
  );
  const claim = (
    await db.query<{ j: { id: string; lease_token: string } }>(
      "select public.claim_check($1) as j",
      [clock],
    )
  ).rows[0].j;
  expect(claim?.id).toBe(key);
  const outcome = options.kind
    ? { kind: options.kind, reason_code: "timeout", reason: "unsupported" }
    : {
        kind: "observation",
        observation: {
          listing_id: listing,
          source_id: "demo",
          availability_status: status,
          observed_at: (options.observed ?? clock).toISOString(),
          evidence_type: "editorial",
          price_minor: options.price === undefined ? 4999 : options.price,
          currency: "USD",
          seller_type: "retailer",
          seller_id: "demo-retailer",
          channel: "ship_to_home",
          region_code: "US",
          parser_version: "fixture-v1",
          payload_hash: "fixture-only",
        },
      };
  const result = await db.query<{ eid: string | null }>(
    "select public.finish_check($1,$2,$3,$4) as eid",
    [key, claim.lease_token, JSON.stringify(outcome), clock],
  );
  return { key, claim, outcome, eid: result.rows[0].eid };
}
it("seeds 50 distinct original demo products and separate offers", async () => {
  await setupSource();
  expect(
    (await db.query("select * from public.products where is_demo")).rows,
  ).toHaveLength(50);
  expect(
    (
      await db.query(
        `select * from public.listings where product_id='10000000-0000-4000-8000-000000000001'`,
      )
    ).rows,
  ).toHaveLength(2);
});
it("out→in creates one restock and retry cannot duplicate an event", async () => {
  await observe("out_of_stock");
  const r = await observe("in_stock");
  expect(r.eid).toBeTruthy();
  expect(
    (
      await db.query<{ event_type: string }>(
        "select event_type from public.stock_events where id=$1",
        [r.eid],
      )
    ).rows[0].event_type,
  ).toBe("restock");
  await expect(
    db.query("select public.finish_check($1,$2,$3,$4)", [
      r.key,
      r.claim.lease_token,
      JSON.stringify(r.outcome),
      clock,
    ]),
  ).rejects.toThrow("CONFLICT");
  expect(
    (
      await db.query(
        `select * from public.stock_events where event_type='restock'`,
      )
    ).rows,
  ).toHaveLength(1);
});
it("late evidence never overwrites newer stock and conflicts are explicit", async () => {
  await observe("out_of_stock", { observed: new Date("2026-11-06T11:00:00Z") });
  const before = (
    await db.query<{ availability_status: string }>(
      `select o.availability_status from public.listing_current_state c join public.stock_observations o on c.observation_id=o.id where c.listing_id=$1`,
      [listing],
    )
  ).rows[0];
  expect(before.availability_status).toBe("in_stock");
  await observe("out_of_stock", { observed: new Date("2026-11-06T12:00:02Z") });
  expect(
    (
      await db.query<{ conflicted: boolean }>(
        `select conflicted from public.listing_current_state where listing_id=$1`,
        [listing],
      )
    ).rows[0].conflicted,
  ).toBe(true);
  await observe("in_stock");
});
it("outage writes health only and retains positive evidence", async () => {
  const before = (
    await db.query<{ n: number }>(
      "select count(*)::int n from public.stock_observations",
    )
  ).rows[0].n;
  await observe("unknown", { kind: "temporary_error" });
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.stock_observations",
      )
    ).rows[0].n,
  ).toBe(before);
  expect(
    (
      await db.query<{ failures: number }>(
        `select failures from public.source_health where source_id='demo'`,
      )
    ).rows[0].failures,
  ).toBe(1);
  await db.exec(
    `update public.source_check_jobs set status='failed' where status='pending'`,
  );
});
let ruleId: string, eventId: string;
it("transactional outbox deduplicates a replay and enforces private inbox", async () => {
  await observe("out_of_stock");
  const r = await observe("in_stock");
  eventId = r.eid!;
  const definition = {
    enabled: true,
    product_ids: [],
    set_names: [],
    retailer_ids: [],
    product_types: [],
    seller_types: [],
    channels: [],
    evidence_types: [],
    max_price_minor: null,
    currency: null,
    store_ids: [],
    zip: null,
    radius_mi: null,
    triggers: ["restock"],
    delivery_channels: ["in_app"],
    quiet_hours: null,
    daily_cap: 20,
    cooldown_minutes: 0,
  };
  ruleId = crypto.randomUUID();
  await db.query(
    "insert into public.alert_rules(id,user_id,definition) values($1,$2,$3)",
    [ruleId, a, JSON.stringify(definition)],
  );
  const args = [
    a,
    ruleId,
    eventId,
    "in_app",
    JSON.stringify({
      title: "DEMO DATA — restock",
      body: "Synthetic observation",
      action_url: "https://example.com/demo",
    }),
    clock,
  ];
  const first = (
    await db.query<{ id: string }>(
      "select public.enqueue_notification($1,$2,$3,$4,$5,$6) as id",
      args,
    )
  ).rows[0].id;
  const again = (
    await db.query<{ id: string }>(
      "select public.enqueue_notification($1,$2,$3,$4,$5,$6) as id",
      args,
    )
  ).rows[0].id;
  expect(first).toBeTruthy();
  expect(first).toBe(again);
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${b}',false);`,
  );
  expect(
    (await db.query("select * from public.notifications")).rows,
  ).toHaveLength(0);
  await db.exec("reset role");
});
it("suppresses delayed stale notifications and unapproved source alerts", async () => {
  const before = (await db.query("select * from public.notifications")).rows
    .length;
  const newRule = crypto.randomUUID();
  await db.query(
    "insert into public.alert_rules select $1,user_id,definition,created_at from public.alert_rules where id=$2",
    [newRule, ruleId],
  );
  const args = [
    a,
    newRule,
    eventId,
    "in_app",
    JSON.stringify({ title: "stale", body: "should not send" }),
    new Date(clock.getTime() + 3600000),
  ];
  expect(
    (
      await db.query<{ id: string | null }>(
        "select public.enqueue_notification($1,$2,$3,$4,$5,$6) id",
        args,
      )
    ).rows[0].id,
  ).toBeNull();
  await db.exec(
    `update public.source_permissions set enabled=false where id='demo'`,
  );
  args[5] = clock;
  expect(
    (
      await db.query<{ id: string | null }>(
        "select public.enqueue_notification($1,$2,$3,$4,$5,$6) id",
        args,
      )
    ).rows[0].id,
  ).toBeNull();
  expect(
    (await db.query("select * from public.notifications")).rows,
  ).toHaveLength(before);
  await db.exec(
    `update public.source_permissions set enabled=true where id='demo'`,
  );
});
it("enforces worker quota and source kill switch", async () => {
  await db.exec(
    `update public.source_health set used=1000,quota_window='2026-11-06T12:00:00Z' where source_id='demo'`,
  );
  const key = crypto.randomUUID();
  await db.query(
    `insert into public.source_check_jobs(id,listing_id,source_id,scheduled_for,available_at) values($1,$2,'demo',$3,$3)`,
    [key, listing, new Date(clock.getTime() + 1000)],
  );
  expect(
    (
      await db.query<{ j: unknown }>("select public.claim_check($1) j", [
        new Date(clock.getTime() + 2000),
      ])
    ).rows[0].j,
  ).toBeNull();
  await db.exec(
    `insert into public.staff_members values('${a}');set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);`,
  );
  await db.query(
    `select public.admin_source('demo','{"enabled":false,"status":"suspended"}')`,
  );
  await db.exec("reset role");
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.source_check_jobs where id=$1",
        [key],
      )
    ).rows[0].status,
  ).toBe("quarantined");
  expect(
    (
      await db.query(
        `select * from public.audit_logs where action='source_changed'`,
      )
    ).rows,
  ).toHaveLength(1);
});
it("exports only one user and cascades account-owned records on deletion", async () => {
  const exported = (
    await db.query<{ data: Record<string, unknown[]> }>(
      "select public.privacy_export($1) data",
      [a],
    )
  ).rows[0].data;
  expect(exported.profiles).toHaveLength(1);
  await db.exec(`delete from auth.users where id='${a}'`);
  for (const table of [
    "watchlists",
    "alert_rules",
    "notifications",
    "push_subscriptions",
    "user_preferences",
    "idempotency_keys",
  ])
    expect(
      (await db.query(`select * from public.${table} where user_id=$1`, [a]))
        .rows,
    ).toHaveLength(0);
  expect(
    (await db.query("select * from public.profiles where id=$1", [b])).rows,
  ).toHaveLength(1);
});
it("covers all 16 explicit availability transition pairs", async () => {
  clock = new Date(clock.getTime() + 10000);
  await db.exec(
    `update public.source_permissions set status='approved',enabled=true where id='demo';update public.source_health set used=0,circuit_until=null where source_id='demo'`,
  );
  for (const previous of ["in_stock", "out_of_stock", "preorder", "unknown"])
    for (const next of ["in_stock", "out_of_stock", "preorder", "unknown"]) {
      await observe(previous);
      const r = await observe(next);
      if (previous === next) expect(r.eid).toBeNull();
      else {
        const row = (
          await db.query<{ event_type: string }>(
            "select event_type from public.stock_events where id=$1",
            [r.eid],
          )
        ).rows[0];
        expect(row.event_type).toBe(
          previous === "out_of_stock" && next === "in_stock"
            ? "restock"
            : previous === "unknown" && next === "in_stock"
              ? "new_listing"
              : "status_change",
        );
      }
    }
});
it("does not allow mutation of historical evidence", async () => {
  await expect(
    db.exec(
      `update public.stock_observations set availability_status='unknown'`,
    ),
  ).rejects.toThrow("IMMUTABLE_EVIDENCE");
  await expect(db.exec("delete from public.stock_events")).rejects.toThrow(
    "IMMUTABLE_EVIDENCE",
  );
});
it("reclaims expired leases with a new token and rejects the old worker", async () => {
  clock = new Date(clock.getTime() + 1000);
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.source_check_jobs(id,listing_id,source_id,scheduled_for,available_at) values($1,$2,'demo',$3,$3)`,
    [id, listing, clock],
  );
  const first = (
    await db.query<{ j: { id: string; lease_token: string } }>(
      "select public.claim_check($1) j",
      [clock],
    )
  ).rows[0].j;
  clock = new Date(clock.getTime() + 61000);
  const second = (
    await db.query<{ j: { id: string; lease_token: string } }>(
      "select public.claim_check($1) j",
      [clock],
    )
  ).rows[0].j;
  expect(second.id).toBe(first.id);
  expect(second.lease_token).not.toBe(first.lease_token);
  await expect(
    db.query(
      `select public.finish_check($1,$2,'{"kind":"temporary_error","reason_code":"timeout"}',$3)`,
      [id, first.lease_token, clock],
    ),
  ).rejects.toThrow("CONFLICT");
  await db.query(
    `select public.finish_check($1,$2,'{"kind":"not_supported","reason":"test"}',$3)`,
    [id, second.lease_token, clock],
  );
});
it("rate limits count successes and deny excess work", async () => {
  for (let i = 0; i < 3; i++)
    expect(
      (
        await db.query<{ ok: boolean }>(
          `select public.take_rate_limit('fixture','test',2,60) ok`,
        )
      ).rows[0].ok,
    ).toBe(i < 2);
});
it("requires every integrated B privacy participant", async () => {
  expect(
    (
      await db.query<{ p: string[] }>(
        "select public.privacy_participants_required() p",
      )
    ).rows[0].p,
  ).toEqual(expect.arrayContaining(["radar", "binder", "packs"]));
});
it("daily budgets fail closed on unknown costs and account for configured cost", async () => {
  clock = new Date(clock.getTime() + 10000);
  await db.exec(
    `update public.source_permissions set enabled=true,status='approved',daily_budget_micros=1,unit_cost_micros=null where id='demo';update public.source_health set used=0,cost_today_micros=0,circuit_until=null where source_id='demo'`,
  );
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.source_check_jobs(id,listing_id,source_id,scheduled_for,available_at) values($1,$2,'demo',$3,$3)`,
    [id, listing, clock],
  );
  expect(
    (await db.query<{ j: unknown }>("select public.claim_check($1) j", [clock]))
      .rows[0].j,
  ).toBeNull();
  await db.exec(
    `update public.source_permissions set unit_cost_micros=1 where id='demo'`,
  );
  await db.query(
    "update public.source_check_jobs set available_at=$1 where id=$2",
    [clock, id],
  );
  const job = (
    await db.query<{ j: { id: string; lease_token: string } }>(
      "select public.claim_check($1) j",
      [clock],
    )
  ).rows[0].j;
  expect(job.id).toBe(id);
  expect(
    (
      await db.query<{ cost_today_micros: number }>(
        `select cost_today_micros from public.source_health where source_id='demo'`,
      )
    ).rows[0].cost_today_micros,
  ).toBe(1);
  await db.query(
    `select public.finish_check($1,$2,'{"kind":"not_supported","reason":"fixture"}',$3)`,
    [id, job.lease_token, clock],
  );
  await db.exec(
    `update public.source_permissions set daily_budget_micros=null,unit_cost_micros=null where id='demo'`,
  );
});
it("suppresses an old restock after newer explicit out-of-stock evidence", async () => {
  await db.exec(
    `update public.user_preferences set in_app=true where user_id='${b}'`,
  );
  await observe("out_of_stock");
  const event = await observe("in_stock");
  const rule = crypto.randomUUID();
  await db.query(
    `insert into public.alert_rules(id,user_id,definition) values($1,$2,'{"enabled":true,"daily_cap":20,"cooldown_minutes":0,"delivery_channels":["in_app"],"quiet_hours":null}')`,
    [rule, b],
  );
  await observe("out_of_stock");
  expect(
    (
      await db.query<{ eligible: boolean }>(
        "select public.event_is_current($1,$2,$3) eligible",
        [event.eid, rule, clock],
      )
    ).rows[0].eligible,
  ).toBe(false);
  const r = await db.query<{ id: string | null }>(
    `select public.enqueue_notification($1,$2,$3,'in_app','{"title":"stale restock","body":"must not send"}',$4) id`,
    [b, rule, event.eid, clock],
  );
  expect(r.rows[0].id).toBeNull();
  expect(
    (
      await db.query<{ reason: string }>(
        "select reason from public.notification_suppressions where event_id=$1",
        [event.eid],
      )
    ).rows[0].reason,
  ).toBe("signal_no_longer_current");
});
