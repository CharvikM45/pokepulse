-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned proposal, NOT a merged migration. Requires Supabase auth.users/auth.uid().
-- No dependency on unmerged A-owned tables. A's pack_lab gate must also be enforced
-- in the eventual route adapter. Internal DB gates default OFF; no seed is included.
begin;
create function public.b_assert_account_writable() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
 if exists(select 1 from public.privacy_jobs where user_id=auth.uid() and kind='delete' and status in ('pending','running','blocked')) then raise exception 'CONFLICT:DELETION_PENDING';end if;
end $$;
revoke all on function public.b_assert_account_writable() from public,anon,authenticated;

create table public.tcg_sets (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 160),
  rights_status text not null default 'disabled' check (rights_status in ('approved','metadata_only','disabled')),
  enabled_for_simulation boolean not null default false,
  is_demo boolean not null default true,
  public_metadata_allowed boolean not null default false,
  release_date date,
  check (not enabled_for_simulation or rights_status = 'approved')
);
create table public.cards (
  id uuid primary key default gen_random_uuid(), set_id uuid not null references public.tcg_sets(id),
  card_number text not null check (length(card_number) between 1 and 32),
  card_name text not null check (length(card_name) between 1 and 160),
  unique (set_id, card_number), unique (set_id, id)
);
create table public.card_variants (
  id uuid primary key default gen_random_uuid(), set_id uuid not null,
  card_id uuid not null, finish text not null check (length(finish) between 1 and 64),
  rarity text, image_url text, image_rights_cleared boolean not null default false,
  eligible_for_packs boolean not null default false,
  foreign key (set_id, card_id) references public.cards(set_id,id),
  unique (card_id, finish), unique (set_id,id),
  check (image_url is null or (image_rights_cleared and image_url like 'https://%'))
);
create table public.master_set_manifests (
  id uuid primary key default gen_random_uuid(), set_id uuid not null references public.tcg_sets(id),
  version text not null check (length(version) between 1 and 80),
  validated boolean not null default false,
  supported_goals text[] not null default '{}',
  published_at timestamptz,
  unique(set_id, version), unique(set_id,id),
  check (supported_goals <@ array['base','master','extended']::text[])
);
create table public.master_set_requirements (
  manifest_id uuid not null, set_id uuid not null, variant_id uuid not null,
  scope text not null check (scope in ('base','master','extended')),
  collectible_key text not null check (length(collectible_key) between 1 and 160),
  rationale text not null check (length(rationale) between 1 and 500),
  primary key (manifest_id,scope,variant_id),
  foreign key(set_id,manifest_id) references public.master_set_manifests(set_id,id),
  foreign key(set_id,variant_id) references public.card_variants(set_id,id)
);
create unique index master_exact_variant_goals on public.master_set_requirements(manifest_id,scope,collectible_key) where scope <> 'base';

create table public.pack_odds_versions (
  id uuid primary key default gen_random_uuid(), set_id uuid not null references public.tcg_sets(id),
  version text not null check (length(version) between 1 and 80),
  active boolean not null default false,
  fictional boolean not null default true,
  methodology text not null check (length(methodology) between 1 and 2000),
  sample_size integer check (sample_size > 0), source_url text,
  checked_at timestamptz, uncertainty text,
  price_coins integer not null check (price_coins between 0 and 1000000),
  unique(set_id,version), unique(set_id,id),
  check (fictional or (sample_size is not null and source_url like 'https://%' and checked_at is not null and length(uncertainty) > 0))
);
create unique index pack_one_active_odds on public.pack_odds_versions(set_id) where active;
create table public.pack_slot_rules (
  odds_id uuid not null, set_id uuid not null, slot_index integer not null check (slot_index between 0 and 99),
  variant_id uuid not null, weight integer not null check (weight > 0),
  primary key (odds_id, slot_index, variant_id),
  foreign key(set_id,odds_id) references public.pack_odds_versions(set_id,id),
  foreign key(set_id,variant_id) references public.card_variants(set_id,id)
);
create table public.b_pack_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false, allow_demo boolean not null default false,
  welcome_coins integer not null default 100 check (welcome_coins between 0 and 100000),
  daily_free_enabled boolean not null default false,
  daily_opening_cap integer not null default 100 check (daily_opening_cap between 1 and 1000)
);
insert into public.b_pack_settings(singleton) values(true);

create table public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0), last_free_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.pack_openings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null, request_body jsonb not null,
  set_id uuid not null references public.tcg_sets(id), odds_id uuid not null,
  opened_at timestamptz not null default now(), spent_coins integer not null check (spent_coins >= 0),
  used_free_open boolean not null,
  opening_status text not null default 'committed' check (opening_status = 'committed'),
  unique(user_id,idempotency_key), unique(user_id,id), unique(set_id,id),
  foreign key(set_id,odds_id) references public.pack_odds_versions(set_id,id),
  check (not used_free_open or spent_coins = 0)
);
create index pack_openings_owner_time on public.pack_openings(user_id,opened_at desc,id);
create table public.opening_cards (
  opening_id uuid not null, set_id uuid not null, slot_index integer not null,
  card_variant_id uuid not null,
  primary key(opening_id,slot_index),
  foreign key(set_id,opening_id) references public.pack_openings(set_id,id) on delete cascade,
  foreign key(set_id,card_variant_id) references public.card_variants(set_id,id)
);
create table public.coin_ledger (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  opening_id uuid, kind text not null check (kind in ('welcome_grant','pack_open')),
  delta integer not null, balance_after integer not null check(balance_after >= 0),
  created_at timestamptz not null default now(),
  foreign key(user_id,opening_id) references public.pack_openings(user_id,id) on delete cascade,
  check ((kind='welcome_grant' and opening_id is null and delta >= 0) or
         (kind='pack_open' and opening_id is not null and delta <= 0))
);
create unique index coin_once_welcome on public.coin_ledger(user_id) where kind='welcome_grant';
create unique index coin_once_opening on public.coin_ledger(opening_id) where kind='pack_open';
create table public.virtual_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_variant_id uuid not null references public.card_variants(id), quantity bigint not null check(quantity > 0),
  primary key(user_id,card_variant_id)
);
create table public.real_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_variant_id uuid not null references public.card_variants(id), quantity integer not null check(quantity between 1 and 9999),
  notes text not null default '' check(length(notes) <= 500), updated_at timestamptz not null default now(),
  primary key(user_id,card_variant_id)
);

-- No public/private direct writes: all exposed tables have RLS and explicit grants.
alter table public.tcg_sets enable row level security;
alter table public.cards enable row level security;
alter table public.card_variants enable row level security;
alter table public.master_set_manifests enable row level security;
alter table public.master_set_requirements enable row level security;
alter table public.pack_odds_versions enable row level security;
alter table public.pack_slot_rules enable row level security;
alter table public.b_pack_settings enable row level security;
alter table public.wallets enable row level security;
alter table public.pack_openings enable row level security;
alter table public.opening_cards enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.virtual_inventory enable row level security;
alter table public.real_inventory enable row level security;

-- Catalog is served by the eventual rights-aware API adapter, not raw browser table reads.
revoke all on public.tcg_sets, public.cards, public.card_variants, public.master_set_manifests,
 public.master_set_requirements, public.pack_odds_versions, public.pack_slot_rules, public.b_pack_settings,
 public.wallets, public.pack_openings, public.opening_cards, public.coin_ledger,
 public.virtual_inventory, public.real_inventory from public,anon,authenticated;
grant all on public.tcg_sets, public.cards, public.card_variants, public.master_set_manifests,
 public.master_set_requirements, public.pack_odds_versions, public.pack_slot_rules, public.b_pack_settings,
 public.wallets, public.pack_openings, public.opening_cards, public.coin_ledger,
 public.virtual_inventory, public.real_inventory to service_role;
grant select on public.wallets,public.pack_openings,public.opening_cards,public.coin_ledger,
 public.virtual_inventory,public.real_inventory to authenticated;
create policy wallet_owner on public.wallets for select to authenticated using(user_id=(select auth.uid()));
create policy opening_owner on public.pack_openings for select to authenticated using(user_id=(select auth.uid()));
create policy opening_cards_owner on public.opening_cards for select to authenticated using(
  exists(select 1 from public.pack_openings o where o.id=opening_id and o.user_id=(select auth.uid())));
create policy ledger_owner on public.coin_ledger for select to authenticated using(user_id=(select auth.uid()));
create policy virtual_owner on public.virtual_inventory for select to authenticated using(user_id=(select auth.uid()));
create policy real_owner on public.real_inventory for select to authenticated using(user_id=(select auth.uid()));

-- Unbiased bounded cryptographic draw: UUID-v4's first 32 bits contain no fixed
-- version/variant bits. gen_random_uuid() uses Postgres's strong random source.
-- Rejection sampling avoids modulo bias. No seed parameter or public execute.
create function public.b_random_below(p_bound bigint) returns bigint
language plpgsql volatile set search_path=pg_catalog,public as $$
declare v_value bigint; v_limit bigint;
begin
  if p_bound < 1 or p_bound > 4294967296 or p_bound is null then raise exception 'INVALID_CONFIG'; end if;
  v_limit := 4294967296 - (4294967296 % p_bound);
  loop
    v_value := ('x'||substr(gen_random_uuid()::text,1,8))::bit(32)::bigint;
    exit when v_value < v_limit;
  end loop;
  return v_value % p_bound;
end $$;
revoke all on function public.b_random_below(bigint) from public,anon,authenticated;

create function public.b_opening_result(p_id uuid) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',o.id,'set_id',o.set_id,'opened_at',to_char(o.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'spent_coins',o.spent_coins,'used_free_open',o.used_free_open,'odds_version',v.version,
    'opening_status',o.opening_status,'cards',coalesce((select jsonb_agg(jsonb_build_object(
      'card_variant_id',c.card_variant_id,'slot_index',c.slot_index) order by c.slot_index)
      from public.opening_cards c where c.opening_id=o.id),'[]'::jsonb))
  from public.pack_openings o join public.pack_odds_versions v on v.id=o.odds_id where o.id=p_id
$$;
revoke all on function public.b_opening_result(uuid) from public,anon,authenticated;

-- Immutable used odds/slot rules: edits coordinate on the same parent row as open.
create function public.b_guard_odds() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.pack_openings where odds_id=old.id) and
     (tg_op='DELETE' or (to_jsonb(new)-'active') is distinct from (to_jsonb(old)-'active')) then
    raise exception 'IMMUTABLE_ODDS';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger b_odds_immutable before update or delete on public.pack_odds_versions for each row execute function public.b_guard_odds();
create function public.b_guard_slots() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  if tg_op='UPDATE' and new.odds_id<>old.odds_id then raise exception 'IMMUTABLE_ODDS_REFERENCE'; end if;
  v_id:=case when tg_op='DELETE' then old.odds_id else new.odds_id end;
  perform 1 from public.pack_odds_versions where id=v_id for update;
  if exists(select 1 from public.pack_openings where odds_id=v_id) then raise exception 'IMMUTABLE_ODDS'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger b_slots_immutable before insert or update or delete on public.pack_slot_rules for each row execute function public.b_guard_slots();

create function public.b_open_pack(p_set_id uuid,p_idempotency_key uuid,p_use_free_open boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_user uuid:=auth.uid(); v_body jsonb; v_prior public.pack_openings%rowtype;
  v_settings public.b_pack_settings%rowtype; v_set public.tcg_sets%rowtype;
  v_odds public.pack_odds_versions%rowtype; v_wallet public.wallets%rowtype;
  v_now timestamptz:=transaction_timestamp(); v_day date;
  v_id uuid:=gen_random_uuid(); v_cost integer; v_new_wallet boolean;
  v_slot record; v_pick uuid; v_draw bigint; v_count integer; v_max integer;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_set_id is null or p_idempotency_key is null or p_use_free_open is null then raise exception 'VALIDATION_ERROR'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-pack:'||v_user::text,0));
  v_body:=jsonb_build_object('set_id',p_set_id,'use_free_open',p_use_free_open);
  select * into v_prior from public.pack_openings where user_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_body<>v_body then raise exception 'CONFLICT'; end if;
    return public.b_opening_result(v_prior.id);
  end if;
  perform public.b_assert_account_writable();
  select * into strict v_settings from public.b_pack_settings where singleton for share;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='pack_lab' and f.enabled) then raise exception 'RIGHTS_DISABLED'; end if;
  select * into v_set from public.tcg_sets where id=p_set_id for share;
  if not found or not v_set.enabled_for_simulation or v_set.rights_status<>'approved' or
    (v_set.is_demo and not v_settings.allow_demo) then raise exception 'RIGHTS_DISABLED'; end if;
  select * into v_odds from public.pack_odds_versions where set_id=p_set_id and active for share;
  if not found then raise exception 'RIGHTS_DISABLED'; end if;
  -- Lock eligible variants before validation/draw so a concurrent disable cannot race.
  perform cv.id from public.card_variants cv where cv.id in
    (select variant_id from public.pack_slot_rules where odds_id=v_odds.id) order by cv.id for share;
  select count(distinct slot_index),max(slot_index) into v_count,v_max from public.pack_slot_rules where odds_id=v_odds.id;
  if v_count=0 or v_max<>v_count-1 or
    exists(select 1 from public.pack_slot_rules sr join public.card_variants cv on cv.id=sr.variant_id
      where sr.odds_id=v_odds.id and (not cv.eligible_for_packs or cv.set_id<>p_set_id)) or
    exists(select 1 from public.pack_slot_rules where odds_id=v_odds.id group by slot_index having sum(weight::bigint)>4294967296)
    then raise exception 'INVALID_CONFIG'; end if;
  v_day:=(v_now at time zone 'UTC')::date;
  if (select count(*) from public.pack_openings where user_id=v_user and opened_at>=v_now-interval '1 minute')>=10 or
     (select count(*) from public.pack_openings where user_id=v_user and opened_at>=(v_day::timestamp at time zone 'UTC'))>=v_settings.daily_opening_cap
     then raise exception 'RATE_LIMITED'; end if;
  insert into public.wallets(user_id,balance) values(v_user,v_settings.welcome_coins) on conflict do nothing;
  v_new_wallet:=found;
  select * into strict v_wallet from public.wallets where user_id=v_user for update;
  if p_use_free_open then
    if not v_settings.daily_free_enabled or v_wallet.last_free_date>=v_day then raise exception 'CONFLICT:FREE_ALLOWANCE_UNAVAILABLE'; end if;
    v_cost:=0;
  else
    v_cost:=v_odds.price_coins;
    if v_wallet.balance<v_cost then raise exception 'CONFLICT:INSUFFICIENT_COINS'; end if;
  end if;
  if v_new_wallet then insert into public.coin_ledger(user_id,kind,delta,balance_after)
    values(v_user,'welcome_grant',v_wallet.balance,v_wallet.balance); end if;
  update public.wallets set balance=balance-v_cost,
    last_free_date=case when p_use_free_open then v_day else last_free_date end,updated_at=v_now where user_id=v_user;
  insert into public.pack_openings(id,user_id,idempotency_key,request_body,set_id,odds_id,opened_at,spent_coins,used_free_open)
    values(v_id,v_user,p_idempotency_key,v_body,p_set_id,v_odds.id,v_now,v_cost,p_use_free_open);
  insert into public.coin_ledger(user_id,opening_id,kind,delta,balance_after)
    values(v_user,v_id,'pack_open',-v_cost,v_wallet.balance-v_cost);
  for v_slot in select slot_index,sum(weight::bigint) total from public.pack_slot_rules where odds_id=v_odds.id group by slot_index order by slot_index loop
    v_draw:=public.b_random_below(v_slot.total::bigint);
    select variant_id into strict v_pick from (
      select variant_id,sum(weight::bigint) over(order by variant_id) cumulative from public.pack_slot_rules
      where odds_id=v_odds.id and slot_index=v_slot.slot_index
    ) weights where cumulative>v_draw order by cumulative limit 1;
    insert into public.opening_cards(opening_id,set_id,slot_index,card_variant_id) values(v_id,p_set_id,v_slot.slot_index,v_pick);
    insert into public.virtual_inventory(user_id,card_variant_id,quantity) values(v_user,v_pick,1)
      on conflict(user_id,card_variant_id) do update set quantity=public.virtual_inventory.quantity+1;
  end loop;
  return public.b_opening_result(v_id);
end $$;
revoke all on function public.b_open_pack(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.b_open_pack(uuid,uuid,boolean) to authenticated;

create function public.b_edit_real_inventory(p_variant_id uuid,p_quantity integer,p_notes text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_variant_id is null or p_quantity is null or p_quantity<0 or p_quantity>9999 or length(p_notes)>500 or
    translate(p_notes,E'\n\r\t','')~'[[:cntrl:]]' then raise exception 'VALIDATION_ERROR'; end if;
  perform 1 from public.card_variants cv join public.tcg_sets s on s.id=cv.set_id
    where cv.id=p_variant_id and s.rights_status<>'disabled' for share of cv,s;
  if not found then raise exception 'RIGHTS_DISABLED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-real:'||v_user::text,0));
  perform public.b_assert_account_writable();
  if p_quantity=0 then
    delete from public.real_inventory where user_id=v_user and card_variant_id=p_variant_id;
  else
    insert into public.real_inventory(user_id,card_variant_id,quantity,notes) values(v_user,p_variant_id,p_quantity,coalesce(p_notes,''))
      on conflict(user_id,card_variant_id) do update set quantity=excluded.quantity,
      notes=case when p_notes is null then public.real_inventory.notes else p_notes end,updated_at=now();
  end if;
end $$;
revoke all on function public.b_edit_real_inventory(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.b_edit_real_inventory(uuid,integer,text) to authenticated;

-- Trigger helpers are not externally invokable capabilities.
revoke all on function public.b_guard_odds(),public.b_guard_slots() from public,anon,authenticated;
commit;
