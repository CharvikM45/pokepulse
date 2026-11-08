// Requires an explicitly supplied local disposable PostgreSQL administrator URL.
// Creates an isolated pp_b_* database; never touches an existing application DB.
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const connection = process.env.B_TEST_ADMIN_URL;
if (!connection)
  throw new Error(
    "Set B_TEST_ADMIN_URL to a local disposable PostgreSQL administrator connection.",
  );
const url = new URL(connection);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw new Error("This fixture harness only accepts a loopback database.");
const name = `pp_b_${Date.now()}_${process.pid}`;
assert.match(name, /^pp_b_\d+_\d+$/);
const root = new pg.Client({ connectionString: connection });
await root.connect();
await root.query(`create database ${name}`);
await root.end();
url.pathname = `/${name}`;
const pool = new pg.Pool({ connectionString: url.href, max: 25 });
const a = "41111111-1111-4111-8111-111111111111",
  b = "42222222-2222-4222-8222-222222222222",
  c = "43333333-3333-4333-8333-333333333333";
const set = "10000000-0000-4000-8000-000000000001";
async function user(userId, query, params = []) {
  const client = await pool.connect();
  try {
    await client.query("begin;set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userId,
    ]);
    const result = await client.query(query, params);
    await client.query("commit");
    return result.rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
try {
  await pool.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end $$;
    create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
  for (const file of (await readdir("supabase/migrations")).sort())
    await pool.query(await readFile(`supabase/migrations/${file}`, "utf8"));
  await pool.query(await readFile("supabase/seed.sql", "utf8"));
  await pool.query(await readFile("supabase/seed-b.sql", "utf8"));
  await pool.query(
    `insert into auth.users values('${a}'),('${b}'),('${c}');update public.b_pack_settings set enabled=true,allow_demo=true,daily_free_enabled=true;update public.feature_flags set enabled=true where name='pack_lab'`,
  );
  const key = crypto.randomUUID();
  const same = await Promise.all(
    Array.from({ length: 20 }, () =>
      user(a, "select public.b_open_pack($1,$2,false) result", [set, key]),
    ),
  );
  assert.equal(new Set(same.map((rows) => rows[0].result.id)).size, 1);
  assert(
    same.every(
      (rows) =>
        JSON.stringify(rows[0].result) === JSON.stringify(same[0][0].result),
    ),
  );
  assert.equal(
    (
      await pool.query("select balance from public.wallets where user_id=$1", [
        a,
      ])
    ).rows[0].balance,
    90,
  );
  const distinct = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      user(b, "select public.b_open_pack($1,$2,false) result", [
        set,
        crypto.randomUUID(),
      ]),
    ),
  );
  assert.equal(distinct.filter((r) => r.status === "fulfilled").length, 10);
  const state = (
    await pool.query(
      "select balance,(select sum(delta) from public.coin_ledger where user_id=$1)::int ledger,(select count(*) from public.pack_openings where user_id=$1)::int openings,(select sum(quantity) from public.virtual_inventory where user_id=$1)::int cards from public.wallets where user_id=$1",
      [b],
    )
  ).rows[0];
  assert.deepEqual(state, { balance: 0, ledger: 0, openings: 10, cards: 20 });
  await pool.query(
    `create function public.b_test_failure() returns trigger language plpgsql as $$ begin raise exception 'INJECTED_FAILURE';end $$;create trigger b_test_failure before insert or update on public.virtual_inventory for each row execute function public.b_test_failure()`,
  );
  await assert.rejects(
    user(c, "select public.b_open_pack($1,$2,false)", [
      set,
      crypto.randomUUID(),
    ]),
    /INJECTED_FAILURE/,
  );
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from public.wallets where user_id=$1",
        [c],
      )
    ).rows[0].n,
    0,
  );
  await pool.query(
    "drop trigger b_test_failure on public.virtual_inventory;drop function public.b_test_failure()",
  );
  const free = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      user(c, "select public.b_open_pack($1,$2,true) result", [
        set,
        crypto.randomUUID(),
      ]),
    ),
  );
  assert.equal(free.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await pool.query("select balance from public.wallets where user_id=$1", [
        c,
      ])
    ).rows[0].balance,
    100,
  );
  await assert.rejects(
    pool.query("update public.pack_slot_rules set weight=weight+1"),
    /IMMUTABLE_ODDS/,
  );
  const writer = await pool.connect();
  try {
    await writer.query("begin;set local role authenticated");
    await writer.query("select set_config('request.jwt.claim.sub',$1,true)", [
      a,
    ]);
    await writer.query("select public.b_open_pack($1,$2,false)", [
      set,
      crypto.randomUUID(),
    ]);
    let resolved = false;
    const snapshot = user(
      a,
      "select public.b_collection_snapshot($1,'fictional-1','virtual') result",
      [set],
    ).then((rows) => {
      resolved = true;
      return rows[0].result;
    });
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      waiting =
        (
          await pool.query(
            "select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event='advisory'",
          )
        ).rows[0].n > 0;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(waiting);
    assert.equal(resolved, false);
    await writer.query("commit");
    const complete = await snapshot;
    assert.equal(
      complete.entries.reduce((n, e) => n + e.quantity, 0),
      4,
    );
  } finally {
    await writer.query("rollback");
    writer.release();
  }
  await pool.query(
    `update public.b_radar_settings set enabled=true,allow_demo=true;update public.feature_flags set enabled=true where name='local_radar';insert into public.staff_members values('${b}'),('${c}')`,
  );
  const reportKey = crypto.randomUUID(),
    observed = new Date(Date.now() - 1000).toISOString(),
    store = "30000000-0000-4000-8000-000000000001";
  const submissions = await Promise.all(
    Array.from({ length: 20 }, () =>
      user(
        a,
        "select public.b_submit_sighting($1,$2,'found_stock',$3,'Original synthetic report',$4) result",
        [store, set, observed, reportKey],
      ),
    ),
  );
  const reportId = submissions[0][0].result.id;
  assert.equal(new Set(submissions.map((rows) => rows[0].result.id)).size, 1);
  const reviews = await Promise.allSettled(
    [b, c].map((staff) =>
      user(
        staff,
        "select public.b_moderate_sighting($1,'approved','Reviewed synthetic report',null,$2,0)",
        [reportId, crypto.randomUUID()],
      ),
    ),
  );
  assert.equal(reviews.filter((r) => r.status === "fulfilled").length, 1);
  const dispatches = await Promise.all(
    Array.from({ length: 20 }, () =>
      pool.query("select public.b_dispatch_sighting_outbox() n"),
    ),
  );
  assert.equal(
    dispatches.reduce((sum, r) => sum + r.rows[0].n, 0),
    1,
  );
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from public.stock_events where event_type='local_sighting'",
      )
    ).rows[0].n,
    1,
  );
  const editKey = crypto.randomUUID(),
    variant = "20000000-0000-4000-8000-000000000001";
  const edits = await Promise.all(
    Array.from({ length: 20 }, () =>
      user(
        c,
        "select public.b_save_real_inventory($1,2,$2,'Original private note') result",
        [variant, editKey],
      ),
    ),
  );
  assert(edits.every((rows) => rows[0].result.quantity === 2));
  await user(c, "select public.b_save_real_inventory($1,5,$2,null)", [
    variant,
    crypto.randomUUID(),
  ]);
  await user(
    c,
    "select public.b_save_real_inventory($1,2,$2,'Original private note')",
    [variant, editKey],
  );
  assert.equal(
    (
      await pool.query(
        "select quantity from public.real_inventory where user_id=$1 and card_variant_id=$2",
        [c, variant],
      )
    ).rows[0].quantity,
    5,
  );
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from public.b_real_edit_requests where user_id=$1",
        [c],
      )
    ).rows[0].n,
    2,
  );
  await pool.query(
    "insert into public.b_release_source_hosts values('example.com',true,'Original synthetic fixture')",
  );
  const editor = await pool.connect();
  try {
    await editor.query("begin;set local role authenticated");
    await editor.query("select set_config('request.jwt.claim.sub',$1,true)", [
      c,
    ]);
    const entry = {
      name: "Original fictional release",
      product_id: null,
      date: null,
      date_precision: "unconfirmed",
      event_type: "announcement",
      region: "DEMO",
      source_url: "https://example.com/demo",
      verified_at: new Date(Date.now() - 1000).toISOString(),
      is_demo: true,
      status: "published",
    };
    await editor.query(
      "select public.b_curate_release(null,0,$1,'Private editor note',$2)",
      [JSON.stringify(entry), crypto.randomUUID()],
    );
    await pool.query(
      "insert into public.privacy_jobs(user_id,kind) values($1,'delete')",
      [c],
    );
    let erased = false;
    const erase = pool
      .query("select public.b_erase_private($1)", [c])
      .then(() => {
        erased = true;
      });
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      waiting =
        (
          await pool.query(
            "select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event='advisory'",
          )
        ).rows[0].n > 0;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(waiting);
    assert.equal(erased, false);
    await editor.query("commit");
    await erase;
    assert.equal(
      (
        await pool.query(
          "select count(*)::int n from public.release_edit_history where actor_id=$1",
          [c],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "select count(*)::int n from public.release_edit_history where actor_id is null and reason='Account erased' and request_body='{}'::jsonb",
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      user(c, "select public.b_save_real_inventory($1,7,$2,null)", [
        variant,
        crypto.randomUUID(),
      ]),
      /DELETION_PENDING/,
    );
    await assert.rejects(
      user(c, "select public.b_open_pack($1,$2,false)", [
        set,
        crypto.randomUUID(),
      ]),
      /DELETION_PENDING/,
    );
  } finally {
    await editor.query("rollback");
    editor.release();
  }
  console.log(
    JSON.stringify({
      database: name,
      independent_connections: 20,
      passed: [
        "same-key replay",
        "distinct-key balance and ledger",
        "injected rollback",
        "one UTC free allowance",
        "used odds immutable",
        "binder waits for committed inventory",
        "same-key report submission",
        "stale competing moderation rejected",
        "one event across parallel outbox workers",
        "same-key real edit and stale replay preserve newer quantity",
        "deletion waits for in-flight curation, redacts notes and pauses new writes",
      ],
    }),
  );
} finally {
  await pool.end();
}
