import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
const userA = "41111111-1111-4111-8111-111111111111",
  userB = "42222222-2222-4222-8222-222222222222";
const set = "91111111-1111-4111-8111-111111111111",
  card = "92222222-2222-4222-8222-222222222222",
  variant = "93333333-3333-4333-8333-333333333333";
async function value<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
) {
  return (await db.query<{ result: T }>(sql, args)).rows[0].result;
}
async function asUser(id: string) {
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`,
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.exec(
    `insert into auth.users values('${userA}'),('${userB}');update public.card_provider_permissions set enabled=true,metadata_approved=true,retention_approved=true,pricing_approved=true,reviewer='test',evidence_url='https://example.com/review',checked_at=now(),allowed_image_hosts=array['assets.example.test'] where id='tcgdex';insert into public.tcg_sets(id,name,rights_status,is_demo,public_metadata_allowed,provider_id,language,metadata_source,metadata_permission_evidence_url,metadata_permission_checked_at) values('${set}','Verified set','metadata_only',false,true,'tcgdex','en','reviewed test metadata','https://example.com/review',now());insert into public.cards(id,set_id,card_number,card_name,provider_id,language,artists) values('${card}','${set}','1','Pikachu','tcgdex','en',array['Illustrator']);insert into public.card_variants(id,set_id,card_id,finish,image_url,image_rights_cleared) values('${variant}','${set}','${card}','normal','https://assets.example.test/card.webp',true);`,
  );
}, 120000);
afterAll(async () => {
  await db?.close();
});
it("pages globally with stable secondary IDs and honors metadata/image revocation", async () => {
  await db.exec("reset role");
  const cards = await value<{
    cards: { id: string; variants: { image_url: string | null }[] }[];
    next: unknown;
  }>("select public.c_search_cards('{}',1,null) result");
  expect(cards.cards[0].id).toBe(card);
  expect(cards.cards[0].variants[0].image_url).toBeNull();
  await db.exec(
    "update public.card_provider_permissions set artwork_approved=true where id='tcgdex';update public.feature_flags set enabled=true where name='licensed_card_art'",
  );
  expect(
    (
      await value<{ variants: { image_url: string | null }[] }>(
        "select public.c_card_json($1) result",
        [card],
      )
    ).variants[0].image_url,
  ).toContain("assets.example");
  await db.exec(
    "update public.card_provider_permissions set enabled=false where id='tcgdex'",
  );
  expect(
    (
      await value<{ cards: unknown[] }>(
        "select public.c_search_cards('{}',20,null) result",
      )
    ).cards,
  ).toEqual([]);
  await db.exec(
    "update public.card_provider_permissions set enabled=true where id='tcgdex'",
  );
});
it("keeps ownership private, idempotent and independent of virtual inventory", async () => {
  await asUser(userA);
  const key = crypto.randomUUID(),
    body = {
      variant_id: variant,
      quantity: 2,
      condition: "near_mint",
      cost_minor: 1000,
      currency: "USD",
      notes: "private",
    };
  const first = await value(
    "select public.c_collection_write('lot_add',$1,$2) result",
    [key, body],
  );
  expect(
    await value("select public.c_collection_write('lot_add',$1,$2) result", [
      key,
      body,
    ]),
  ).toEqual(first);
  const p = await value<{
    copies: number;
    unpriced_copies: number;
    cost_minor: number;
  }>("select public.c_portfolio('USD','market') result");
  expect(p).toMatchObject({ copies: 2, unpriced_copies: 2, cost_minor: 1000 });
  expect(
    (await db.query("select * from public.virtual_inventory")).rows,
  ).toHaveLength(0);
  await asUser(userB);
  expect(
    (await db.query("select * from public.physical_copy_lots")).rows,
  ).toHaveLength(0);
  expect(
    (
      await value<{ copies: number }>(
        "select public.c_portfolio('USD','market') result",
      )
    ).copies,
  ).toBe(0);
});
it("values only comparable fresh physical lots and preserves measured prices", async () => {
  await db.exec("reset role");
  await db.exec(
    `insert into public.card_price_observations(variant_id,provider_id,condition,currency,statistic,amount_minor,observed_at,source_url) values('${variant}','tcgdex','near_mint','USD','market',800,now()-interval '1 day','https://example.com/price'),('${variant}','tcgdex','near_mint','JPY','market',9000,now()-interval '1 day','https://example.com/price')`,
  );
  await asUser(userA);
  expect(
    await value("select public.c_portfolio('USD','market') result"),
  ).toMatchObject({
    copies: 2,
    valued_copies: 2,
    value_minor: 1600,
    cost_minor: 1000,
    gain_minor: 600,
  });
  await db.exec("reset role");
  const history = await value<{ count: number; change: null }>(
    "select public.c_price_history($1,'USD','market','near_mint','','',null,now()-interval '30 days',100,null) result",
    [variant],
  );
  expect(history).toMatchObject({ count: 1, change: null });
});
it("legacy aggregate edits reconcile lot details and deletion erases new private data", async () => {
  await asUser(userA);
  await value("select public.c_collection_write('favorite',$1,$2) result", [
    crypto.randomUUID(),
    { card_id: card, active: true },
  ]);
  await value("select public.b_save_real_inventory($1,1,$2,null) result", [
    variant,
    crypto.randomUUID(),
  ]);
  expect(
    (
      await db.query<{ quantity: number }>(
        "select quantity from public.physical_copy_lots",
      )
    ).rows[0].quantity,
  ).toBe(1);
  await db.exec(`reset role;select public.b_erase_private('${userA}')`);
  expect(
    (await db.query("select * from public.physical_copy_lots")).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select * from public.card_actions")).rows,
  ).toHaveLength(0);
});
it("keyset-pages a large same-name catalog with no duplicate or skipped printing IDs", async () => {
  await db.exec("reset role");
  await db.exec(
    `insert into public.cards(id,set_id,card_number,card_name,provider_id,language) select ('a0000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'${set}',('K'||g::text),'Same Name','tcgdex','en' from generate_series(1,2000) g`,
  );
  const found = new Set<string>();
  let after: unknown = null;
  let pages = 0;
  do {
    const result = await value<{ cards: { id: string }[]; next: unknown }>(
      "select public.c_search_cards($1,50,$2) result",
      [{ q: "Same" }, after],
    );
    expect(result.cards.length).toBeLessThanOrEqual(50);
    for (const card of result.cards) {
      expect(found.has(card.id)).toBe(false);
      found.add(card.id);
    }
    after = result.next;
    pages++;
  } while (after && pages < 50);
  expect(pages).toBe(40);
  expect(found.size).toBe(2000);
  await asUser(userB);
  expect(
    (
      await value<{ cards: unknown[] }>(
        "select public.c_search_cards($1,20,null) result",
        [{ q: "Same", ownership: "owned" }],
      )
    ).cards,
  ).toHaveLength(0);
}, 60000);
it("new writes pause for account deletion and conflicting idempotent payloads fail closed", async () => {
  await asUser(userB);
  const key = crypto.randomUUID();
  await value("select public.c_collection_write('wishlist',$1,$2) result", [
    key,
    { card_id: card, active: true },
  ]);
  await expect(
    value("select public.c_collection_write('wishlist',$1,$2) result", [
      key,
      { card_id: card, active: false },
    ]),
  ).rejects.toThrow("CONFLICT");
  await db.exec("reset role");
  await db.exec(
    `insert into public.privacy_jobs(user_id,kind,status) values('${userB}','delete','pending')`,
  );
  await asUser(userB);
  await expect(
    value("select public.c_collection_write('wishlist',$1,$2) result", [
      crypto.randomUUID(),
      { card_id: card, active: false },
    ]),
  ).rejects.toThrow("CONFLICT:DELETION_PENDING");
});
