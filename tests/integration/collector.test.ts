import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import { ids } from "../../packages/fixtures/src/b-domain";
let db: PGlite;
let originalEligibilityOid: number;
const a = "41111111-1111-4111-8111-111111111111",
  b = "42222222-2222-4222-8222-222222222222",
  staff = "43333333-3333-4333-8333-333333333333";
const key = () => crypto.randomUUID();
async function asUser(user: string) {
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`,
  );
}
async function admin(sql: string) {
  await db.exec("reset role");
  return db.exec(sql);
}
async function value<T>(sql: string, args: unknown[] = []) {
  return (await db.query<{ result: T }>(sql, args)).rows[0].result;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  for (const name of readdirSync("supabase/migrations").sort()) {
    if (name === "20261107040000_b_platform_bridge.sql")
      originalEligibilityOid = Number(
        (
          await db.query<{ id: number }>(
            "select 'public.event_is_current(uuid,uuid,timestamptz)'::regprocedure::oid id",
          )
        ).rows[0].id,
      );
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  }
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  await db.exec(readFileSync("supabase/seed-b.sql", "utf8"));
  await db.exec(
    `insert into auth.users values('${a}'),('${b}'),('${staff}');insert into public.staff_members values('${staff}')`,
  );
}, 120000);
afterAll(async () => {
  await db?.close();
});
it("preserves A's notification eligibility function identity", async () => {
  const current = Number(
    (
      await db.query<{ id: number }>(
        "select 'public.event_is_current(uuid,uuid,timestamptz)'::regprocedure::oid id",
      )
    ).rows[0].id,
  );
  expect(current).toBe(originalEligibilityOid);
});

it("enables RLS on every B table and denies anonymous direct writes", async () => {
  const tables = [
    "tcg_sets",
    "cards",
    "card_variants",
    "master_set_manifests",
    "master_set_requirements",
    "pack_odds_versions",
    "pack_slot_rules",
    "b_pack_settings",
    "wallets",
    "pack_openings",
    "opening_cards",
    "coin_ledger",
    "virtual_inventory",
    "real_inventory",
    "b_radar_settings",
    "stores",
    "b_zip_centroids",
    "sightings",
    "sighting_confirmations",
    "sighting_moderation_actions",
    "b_sighting_outbox",
    "b_calendar_settings",
    "b_release_source_hosts",
    "releases",
    "release_edit_history",
    "b_manifest_actions",
    "b_real_edit_requests",
  ];
  const rows = await db.query<{
    relname: string;
    relrowsecurity: boolean;
    write: boolean;
  }>(
    "select relname,relrowsecurity,has_table_privilege('anon',oid,'INSERT,UPDATE,DELETE') as write from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])",
    [tables],
  );
  expect(rows.rows).toHaveLength(27);
  expect(rows.rows.every((row) => row.relrowsecurity && !row.write)).toBe(true);
});
it("blocks publication of non-demo metadata or simulation without separate permission evidence", async () => {
  await expect(
    db.query(
      "insert into public.tcg_sets(name,is_demo,public_metadata_allowed,rights_status) values('Unreviewed real set',false,true,'metadata_only')",
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "insert into public.tcg_sets(name,is_demo,enabled_for_simulation,rights_status) values('Unreviewed simulation',false,true,'approved')",
    ),
  ).rejects.toThrow();
});

it("fails closed on A's global pack flag even when B settings permit opening", async () => {
  await admin("update public.b_pack_settings set enabled=true,allow_demo=true");
  await asUser(a);
  await expect(
    db.query(`select public.b_open_pack($1,$2,false)`, [ids.set, key()]),
  ).rejects.toThrow("RIGHTS_DISABLED");
  expect(
    await value<number>("select count(*)::int result from public.wallets"),
  ).toBe(0);
});
it("commits pack, debit, immutable cards and virtual inventory once, then recovers with flags off", async () => {
  await admin(
    "update public.feature_flags set enabled=true where name='pack_lab'",
  );
  await asUser(a);
  const idempotency = key();
  const result = await value<{ id: string; cards: unknown[] }>(
    "select public.b_open_pack($1,$2,false) result",
    [ids.set, idempotency],
  );
  expect(result.cards).toHaveLength(2);
  expect(
    await value("select public.b_open_pack($1,$2,false) result", [
      ids.set,
      idempotency,
    ]),
  ).toEqual(result);
  expect(await value<number>("select balance result from public.wallets")).toBe(
    90,
  );
  expect(
    await value<number>(
      "select sum(quantity)::int result from public.virtual_inventory",
    ),
  ).toBe(2);
  expect(
    await value<number>(
      "select count(*)::int result from public.real_inventory",
    ),
  ).toBe(0);
  await expect(
    db.query("select public.b_open_pack($1,$2,true)", [ids.set, idempotency]),
  ).rejects.toThrow("CONFLICT");
  await admin(
    "update public.feature_flags set enabled=false where name='pack_lab'",
  );
  await asUser(a);
  expect(
    await value("select public.b_open_pack($1,$2,false) result", [
      ids.set,
      idempotency,
    ]),
  ).toEqual(result);
});
it("isolates two users and prevents direct virtual inventory writes", async () => {
  await asUser(b);
  expect(
    await value<number>(
      "select count(*)::int result from public.pack_openings",
    ),
  ).toBe(0);
  expect(
    await value<number>(
      "select count(*)::int result from public.virtual_inventory",
    ),
  ).toBe(0);
  await expect(
    db.query("insert into public.virtual_inventory values($1,$2,1)", [
      b,
      ids.moss,
    ]),
  ).rejects.toThrow();
  await expect(
    db.query("select public.b_opening_result(gen_random_uuid())"),
  ).rejects.toThrow();
});
it("real collection editing preserves notes and cannot contaminate virtual ownership", async () => {
  await asUser(b);
  const firstKey = key();
  await db.query(
    "select public.b_save_real_inventory($1,2,$2,'My physical copies')",
    [ids.mossFoil, firstKey],
  );
  await db.query("select public.b_save_real_inventory($1,3,$2,null)", [
    ids.mossFoil,
    key(),
  ]);
  await db.query(
    "select public.b_save_real_inventory($1,2,$2,'My physical copies')",
    [ids.mossFoil, firstKey],
  );
  expect(
    await value<number>("select quantity result from public.real_inventory"),
  ).toBe(3);
  await expect(
    db.query("select public.b_save_real_inventory($1,4,$2,null)", [
      ids.mossFoil,
      firstKey,
    ]),
  ).rejects.toThrow("CONFLICT");
  await expect(
    db.query("select public.b_edit_real_inventory($1,4,null)", [ids.mossFoil]),
  ).rejects.toThrow();
  expect(
    await value<string>("select notes result from public.real_inventory"),
  ).toBe("My physical copies");
  expect(
    await value<number>(
      "select count(*)::int result from public.virtual_inventory",
    ),
  ).toBe(0);
  const result = await value<Record<string, unknown>>(
    "select public.b_collection_progress($1,'fictional-1','real') result",
    [ids.set],
  );
  expect(result.base_collected).toBe(1);
  expect(result.base_required).toBe(3);
  expect(result.master_required).toBe(4);
  const snapshot = await value<{
    entries: { variant_id: string; quantity: number }[];
    realNotes: Record<string, string>;
    progress: unknown;
  }>("select public.b_collection_snapshot($1,'fictional-1','real') result", [
    ids.set,
  ]);
  expect(snapshot.entries).toEqual([{ variant_id: ids.mossFoil, quantity: 3 }]);
  expect(snapshot.realNotes[ids.mossFoil]).toBe("My physical copies");
  expect(snapshot.progress).toEqual(result);
  const missing = await db.query(
    "select * from public.b_missing_collection($1,'fictional-1','real','base',50)",
    [ids.set],
  );
  expect(missing.rows).toHaveLength(2);
  await expect(
    db.query("select public.b_save_real_inventory($1,10000,$2,null)", [
      ids.moss,
      key(),
    ]),
  ).rejects.toThrow("VALIDATION_ERROR");
});
it("enforces global Radar gate, then publishes only pending submissions", async () => {
  await admin(
    "update public.b_radar_settings set enabled=true,allow_demo=true",
  );
  await asUser(a);
  await expect(
    db.query("select * from public.b_nearby_stores('00000',25)"),
  ).rejects.toThrow("SOURCE_UNAVAILABLE");
  await admin(
    "update public.feature_flags set enabled=true where name='local_radar'",
  );
  await asUser(a);
  expect(
    (await db.query("select * from public.b_nearby_stores('00000',25)")).rows,
  ).toHaveLength(1);
  const idempotency = key(),
    observed = new Date(Date.now() - 1000).toISOString();
  const result = await value<{ id: string; moderation: string }>(
    "select public.b_submit_sighting($1,$2,'found_stock',$3,'Original synthetic observation',$4) result",
    [ids.store, ids.set, observed, idempotency],
  );
  expect(result.moderation).toBe("pending");
  reportId = result.id;
  expect(
    (await db.query("select * from public.b_public_sightings($1)", [ids.store]))
      .rows,
  ).toHaveLength(0);
  await expect(
    db.query(
      "select public.b_moderate_sighting($1,'approved','Reason',null,$2,0)",
      [reportId, key()],
    ),
  ).rejects.toThrow("FORBIDDEN");
});
let reportId: string, eventId: string;
it("uses A staff membership, rejects self confirmation and guards stale moderation revisions", async () => {
  await asUser(staff);
  expect(await value<boolean>("select public.b_is_staff() result")).toBe(true);
  const result = await value<{ revision: number }>(
    "select public.b_moderate_sighting($1,'approved','Reviewed fictional fixture','Community report',$2,0) result",
    [reportId, key()],
  );
  expect(result.revision).toBe(1);
  await expect(
    db.query(
      "select public.b_moderate_sighting($1,'rejected','Stale revision',null,$2,0)",
      [reportId, key()],
    ),
  ).rejects.toThrow("CONFLICT");
  await asUser(a);
  await expect(
    db.query("select public.b_confirm_sighting($1)", [reportId]),
  ).rejects.toThrow();
  await asUser(b);
  await db.query("select public.b_confirm_sighting($1)", [reportId]);
  await db.query("select public.b_confirm_sighting($1)", [reportId]);
  const reports = await db.query<{
    independent_confirmations: number;
    reporter_id?: string;
  }>("select * from public.b_public_sightings($1)", [ids.store]);
  expect(Number(reports.rows[0].independent_confirmations)).toBe(1);
  expect(reports.rows[0]).not.toHaveProperty("reporter_id");
});
it("drains approved reports into A's outbox once and invalidates notification eligibility on reversal", async () => {
  await admin("set role service_role");
  expect(
    await value<number>("select public.b_dispatch_sighting_outbox() result"),
  ).toBe(1);
  expect(
    await value<number>("select public.b_dispatch_sighting_outbox() result"),
  ).toBe(0);
  eventId = await value<string>(
    "select id result from public.stock_events where event_type='local_sighting'",
  );
  await admin(
    `insert into public.alert_rules(id,user_id,definition) values('${ruleId}','${b}','{"enabled":true}')`,
  );
  expect(
    await value<boolean>("select public.event_is_current($1,$2) result", [
      eventId,
      ruleId,
    ]),
  ).toBe(true);
  await asUser(staff);
  await db.query(
    "select public.b_moderate_sighting($1,'rejected','Withdrawn after review',null,$2,1)",
    [reportId, key()],
  );
  await admin("set role service_role");
  expect(
    await value<boolean>("select public.event_is_current($1,$2) result", [
      eventId,
      ruleId,
    ]),
  ).toBe(false);
});
const ruleId = "90000000-0000-4000-8000-000000000001";
it("curates nullable dates with approved source hosts and optimistic revisions", async () => {
  await admin(
    "insert into public.b_release_source_hosts values('example.com',true,'Original fictional editorial fixture only');update public.b_calendar_settings set enabled=true,allow_demo=true",
  );
  await asUser(staff);
  const entry = {
    name: "Fictional event — date not announced",
    product_id: ids.set,
    date: null,
    date_precision: "unconfirmed",
    event_type: "announcement",
    region: "DEMO",
    source_url: "https://example.com/demo",
    verified_at: new Date(Date.now() - 1000).toISOString(),
    is_demo: true,
    status: "published",
  };
  const receipt = await value<{ id: string }>(
    "select public.b_curate_release(null,0,$1,'Original test fixture',$2) result",
    [JSON.stringify(entry), key()],
  );
  await expect(
    db.query("select public.b_curate_release($1,0,$2,'Stale edit',$3)", [
      receipt.id,
      JSON.stringify(entry),
      key(),
    ]),
  ).rejects.toThrow("CONFLICT");
  await expect(
    db.query("select * from public.b_public_releases()"),
  ).rejects.toThrow("SOURCE_UNAVAILABLE");
  await admin(
    "update public.feature_flags set enabled=true where name='calendar'",
  );
  const releases = await db.query<{
    b_public_releases: { date: string | null; date_precision: string };
  }>("select * from public.b_public_releases()");
  expect(releases.rows[0].b_public_releases.date).toBeNull();
  expect(releases.rows[0].b_public_releases.date_precision).toBe("unconfirmed");
});
it("pauses new B writes during queued deletion while allowing saved receipts and reads", async () => {
  await admin(
    `insert into public.privacy_jobs(user_id,kind) values('${b}','delete'),('${staff}','delete')`,
  );
  await asUser(b);
  await expect(
    db.query("select public.b_save_real_inventory($1,9,$2,null)", [
      ids.mossFoil,
      key(),
    ]),
  ).rejects.toThrow("DELETION_PENDING");
  await expect(
    db.query("select public.b_open_pack($1,$2,false)", [ids.set, key()]),
  ).rejects.toThrow("DELETION_PENDING");
  await expect(
    db.query("select public.b_confirm_sighting($1)", [reportId]),
  ).rejects.toThrow("DELETION_PENDING");
  await expect(
    db.query(
      "select public.b_submit_sighting($1,$2,'found_stock',now(),'Original fixture',$3)",
      [ids.store, ids.set, key()],
    ),
  ).rejects.toThrow("DELETION_PENDING");
  expect(
    (
      await db.query(
        "select public.b_save_real_inventory((request_body->>'card_variant_id')::uuid,(request_body->>'quantity')::integer,idempotency_key,request_body->>'notes') from public.b_real_edit_requests limit 1",
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "select public.b_collection_snapshot($1,'fictional-1','real')",
        [ids.set],
      )
    ).rows,
  ).toHaveLength(1);
  await asUser(staff);
  await expect(
    db.query(
      "select public.b_moderate_sighting($1,'approved','Original fixture',null,$2,2)",
      [reportId, key()],
    ),
  ).rejects.toThrow("DELETION_PENDING");
  await expect(
    db.query(
      "select public.b_publish_manifest('60000000-0000-4000-8000-000000000001','Original fixture',$1)",
      [key()],
    ),
  ).rejects.toThrow("DELETION_PENDING");
  await admin(
    `delete from public.privacy_jobs where user_id in ('${b}','${staff}') and kind='delete'`,
  );
});
it("hides expired approved reports at read time without waiting for the expiry worker", async () => {
  await admin(
    `update public.sightings set moderation='approved',expires_at=clock_timestamp()-interval '1 millisecond',revision=revision+1 where id='${reportId}'`,
  );
  await db.exec("set role anon");
  expect(
    (await db.query("select * from public.b_public_sightings($1)", [ids.store]))
      .rows,
  ).toHaveLength(0);
});
it("erases B-owned data idempotently and leaves the other account intact", async () => {
  await admin("set role service_role");
  await db.query("select public.b_erase_private($1)", [a]);
  await db.query("select public.b_erase_private($1)", [a]);
  await asUser(a);
  expect(
    await value<number>(
      "select count(*)::int result from public.pack_openings",
    ),
  ).toBe(0);
  expect(
    await value<number>("select count(*)::int result from public.sightings"),
  ).toBe(0);
  await asUser(b);
  expect(
    await value<number>(
      "select count(*)::int result from public.real_inventory",
    ),
  ).toBe(1);
});
