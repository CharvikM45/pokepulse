-- PokePulse staging initialization from committed source cef1612.
-- Fresh database only. One transaction; original fictional demo seeds; all gates remain off.
begin;
select pg_advisory_xact_lock(hashtextextended('pokepulse-initial-staging',0));
do $$ begin
 if exists(select 1 from pg_tables where schemaname='public') then
  raise exception 'Refusing initialization: public schema is not empty';
 end if;
end $$;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text not null primary key);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;
revoke all on schema supabase_migrations from public,anon,authenticated;
revoke all on table supabase_migrations.schema_migrations from public,anon,authenticated;
alter table supabase_migrations.schema_migrations enable row level security;

-- SOURCE 20261106000000_bootstrap.sql
-- A-01 only. No user tables; A-02 introduces profiles and their policies.
create table public.feature_flags (
 name text primary key check (name in ('retailer_verification','local_radar','web_push','calendar','pack_lab','licensed_card_art')),
 enabled boolean not null default false
);
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;
grant select on public.feature_flags to anon, authenticated;
create policy "Public flag reads" on public.feature_flags for select to anon, authenticated using (true);
insert into public.feature_flags(name) values ('retailer_verification'),('local_radar'),('web_push'),('calendar'),('pack_lab'),('licensed_card_art');
-- Pre-merge rollback: drop table public.feature_flags. After merge use a new forward migration.

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261106000000','bootstrap',array[$pp_source_20261106000000$-- A-01 only. No user tables; A-02 introduces profiles and their policies.
begin;
create table public.feature_flags (
 name text primary key check (name in ('retailer_verification','local_radar','web_push','calendar','pack_lab','licensed_card_art')),
 enabled boolean not null default false
);
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;
grant select on public.feature_flags to anon, authenticated;
create policy "Public flag reads" on public.feature_flags for select to anon, authenticated using (true);
insert into public.feature_flags(name) values ('retailer_verification'),('local_radar'),('web_push'),('calendar'),('pack_lab'),('licensed_card_art');
commit;
-- Pre-merge rollback: drop table public.feature_flags. After merge use a new forward migration.
$pp_source_20261106000000$]);

-- SOURCE 20261106010000_platform.sql
-- A-02 through A-11. Forward-fix only after merge. See docs/runbooks/migrations.md.
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now(), privacy text not null default 'private' check(privacy='private'));
create table public.staff_members (user_id uuid primary key references auth.users(id) on delete cascade);
create function public.is_staff() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.staff_members where user_id=auth.uid()) $$;
create table public.user_preferences (user_id uuid primary key references public.profiles on delete cascade, in_app boolean not null default false, web_push boolean not null default false, zip text check(zip ~ '^[0-9]{5}$'), time_zone text not null default 'UTC', quiet_hours jsonb, daily_cap integer not null default 20 check(daily_cap between 1 and 100));
create function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.profiles(id) values(new.id); insert into public.user_preferences(user_id) values(new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile();
insert into public.profiles(id) select id from auth.users on conflict do nothing;
insert into public.user_preferences(user_id) select id from public.profiles on conflict do nothing;
create table public.retailers(id uuid primary key default gen_random_uuid(), name text not null, website text not null check(website ~ '^https://'), is_demo boolean not null default false);
create table public.source_permissions(id text primary key, retailer_id uuid references public.retailers, status text not null default 'not_evaluated' check(status in ('not_evaluated','candidate','approved','denied','suspended')), enabled boolean not null default false, is_demo boolean not null default false, reviewer text, evidence_url text, allowed_hosts text[] not null default '{}', ttl_seconds integer not null default 900 check(ttl_seconds between 30 and 86400), unit_cost_micros bigint check(unit_cost_micros>=0), daily_budget_micros bigint check(daily_budget_micros>=0), quota_per_hour integer not null default 60 check(quota_per_hour between 1 and 10000), concurrency integer not null default 1 check(concurrency between 1 and 10), poll_seconds integer not null default 900 check(poll_seconds>=30), check(status <> 'approved' or (reviewer is not null and evidence_url ~ '^https://')));
create table public.source_health(source_id text primary key references public.source_permissions on delete cascade, failures integer not null default 0, attempts integer not null default 0, last_successful_check_at timestamptz, last_error_code text, circuit_until timestamptz, quota_window timestamptz not null default now(), used integer not null default 0, total_cost_micros bigint, budget_day date, cost_today_micros bigint not null default 0);
create table public.products(id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null, set_name text, era text, product_type text not null, language text, release_region text, edition text, pack_count integer check(pack_count>0), gtin text, release_date date, reference_price_minor integer check(reference_price_minor>=0), reference_price_currency text check(length(reference_price_currency)=3), reference_price_source text, reference_price_valid_from timestamptz, reference_price_valid_until timestamptz, image_url text, identity_key text unique not null, is_demo boolean not null default false, check(reference_price_minor is null or (reference_price_currency is not null and reference_price_source is not null and reference_price_valid_from is not null and reference_price_valid_until>reference_price_valid_from)));
create table public.product_equivalences(id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products on delete cascade, gtin text unique not null check(gtin ~ '^[0-9]{8,14}$'), reviewed_by uuid references auth.users on delete set null);
create table public.mapping_reviews(id uuid primary key default gen_random_uuid(), source_id text references public.source_permissions, source_item_id text not null, candidates uuid[] not null default '{}', reason text not null, state text not null default 'pending' check(state in ('pending','resolved','rejected')), created_at timestamptz not null default now());
create table public.listings(id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products, retailer_id uuid not null references public.retailers, source_id text not null references public.source_permissions, source_item_id text not null, retailer_url text not null check(retailer_url ~ '^https://'), seller_type text not null default 'unknown' check(seller_type in ('retailer','third_party','mixed','unknown')), seller_id text, channel text not null default 'unknown' check(channel in ('ship_to_home','pickup','in_store_report','unknown')), region_code text, price_minor integer check(price_minor>=0), currency text check(length(currency)=3), is_demo boolean not null default false, priority integer not null default 0, next_check_at timestamptz not null default now(), mapping_state text not null default 'approved' check(mapping_state in ('approved','quarantined')), unique nulls not distinct(source_id,source_item_id,region_code,channel,seller_id));
create table public.stock_observations(id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings, source_id text not null references public.source_permissions, check_key uuid not null, availability_status text not null check(availability_status in ('in_stock','out_of_stock','preorder','unknown')), observed_at timestamptz not null, ingested_at timestamptz not null default now(), stale_after timestamptz not null, evidence_type text not null check(evidence_type in ('retailer_api','permitted_partner','moderated_report','editorial')), price_minor integer check(price_minor>=0), currency text, seller_type text not null, seller_id text, channel text not null, region_code text, parser_version text not null, payload_hash text not null, unique(source_id,check_key), check(stale_after>observed_at));
create table public.listing_current_state(listing_id uuid primary key references public.listings, observation_id uuid not null references public.stock_observations, conflicted boolean not null default false, last_successful_check_at timestamptz not null);
create table public.stock_events(id uuid primary key default gen_random_uuid(), observation_id uuid unique references public.stock_observations, listing_id uuid references public.listings, event_type text not null check(event_type in ('restock','new_listing','price_drop','status_change','local_sighting','release_reminder')), occurred_at timestamptz not null, snapshot jsonb not null);
create table public.source_check_jobs(id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings, source_id text not null references public.source_permissions, scheduled_for timestamptz not null, status text not null default 'pending' check(status in ('pending','running','done','quarantined','failed')), attempts integer not null default 0, lease_until timestamptz, lease_token uuid, started_at timestamptz, duration_ms integer, queue_delay_ms integer, available_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(listing_id,scheduled_for));
create index source_jobs_ready on public.source_check_jobs(status,available_at);
create table public.watchlists(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, product_id uuid references public.products, listing_id uuid references public.listings, created_at timestamptz not null default now(), check((product_id is null)<>(listing_id is null)), unique nulls not distinct(user_id,product_id,listing_id));
create table public.alert_rules(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, definition jsonb not null, created_at timestamptz not null default now());
create table public.alert_match_jobs(event_id uuid primary key references public.stock_events, status text not null default 'pending' check(status in ('pending','running','done','failed')), lease_until timestamptz, lease_token uuid, attempts integer not null default 0);
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, rule_id uuid references public.alert_rules on delete set null, event_id uuid references public.stock_events, channel text not null check(channel in ('in_app','web_push')), created_at timestamptz not null default now(), read_at timestamptz, title text not null, body text not null, action_url text, evidence_type text, observed_at timestamptz, unique(user_id,rule_id,event_id,channel));
create table public.notification_deliveries(id uuid primary key default gen_random_uuid(), notification_id uuid not null unique references public.notifications on delete cascade, status text not null default 'pending' check(status in ('pending','attempted','sent','failed','suppressed')), attempts integer not null default 0, available_at timestamptz not null default now(), lease_until timestamptz, lease_token uuid, last_error_code text);
create table public.notification_suppressions(user_id uuid not null references public.profiles on delete cascade,rule_id uuid not null references public.alert_rules on delete cascade,event_id uuid not null references public.stock_events,channel text not null,reason text not null,created_at timestamptz not null default now(),primary key(user_id,rule_id,event_id,channel));
alter table public.notification_suppressions enable row level security;
revoke all on public.notification_suppressions from anon,authenticated;
grant all on public.notification_suppressions to service_role;
create table public.push_subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, endpoint text not null, keys jsonb not null, created_at timestamptz not null default now(), unique(user_id,endpoint));
create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users on delete set null, action text not null, entity_id text, created_at timestamptz not null default now());
create table public.privacy_jobs(id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles on delete set null, kind text not null check(kind in ('export','delete')), status text not null default 'pending' check(status in ('pending','running','completed','blocked','failed')), result jsonb, error_code text, created_at timestamptz not null default now(), completed_at timestamptz, expires_at timestamptz, lease_until timestamptz, lease_token uuid);
create table public.idempotency_keys(user_id uuid not null references public.profiles on delete cascade, key uuid not null, operation text not null, body jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(user_id,key));
create table public.rate_limits(subject text not null, action text not null, bucket timestamptz not null, count integer not null, primary key(subject,action,bucket));
alter table public.retailers enable row level security;
revoke all on public.retailers from anon,authenticated;
grant all on public.retailers to service_role;
alter table public.products enable row level security;
revoke all on public.products from anon,authenticated;
grant all on public.products to service_role;
alter table public.product_equivalences enable row level security;
revoke all on public.product_equivalences from anon,authenticated;
grant all on public.product_equivalences to service_role;
alter table public.listings enable row level security;
revoke all on public.listings from anon,authenticated;
grant all on public.listings to service_role;
alter table public.stock_observations enable row level security;
revoke all on public.stock_observations from anon,authenticated;
grant all on public.stock_observations to service_role;
alter table public.listing_current_state enable row level security;
revoke all on public.listing_current_state from anon,authenticated;
grant all on public.listing_current_state to service_role;
alter table public.stock_events enable row level security;
revoke all on public.stock_events from anon,authenticated;
grant all on public.stock_events to service_role;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon,authenticated;
grant all on public.profiles to service_role;
alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon,authenticated;
grant all on public.user_preferences to service_role;
alter table public.watchlists enable row level security;
revoke all on public.watchlists from anon,authenticated;
grant all on public.watchlists to service_role;
alter table public.alert_rules enable row level security;
revoke all on public.alert_rules from anon,authenticated;
grant all on public.alert_rules to service_role;
alter table public.notifications enable row level security;
revoke all on public.notifications from anon,authenticated;
grant all on public.notifications to service_role;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon,authenticated;
grant all on public.push_subscriptions to service_role;
alter table public.privacy_jobs enable row level security;
revoke all on public.privacy_jobs from anon,authenticated;
grant all on public.privacy_jobs to service_role;
alter table public.staff_members enable row level security;
revoke all on public.staff_members from anon,authenticated;
grant all on public.staff_members to service_role;
alter table public.source_permissions enable row level security;
revoke all on public.source_permissions from anon,authenticated;
grant all on public.source_permissions to service_role;
alter table public.source_health enable row level security;
revoke all on public.source_health from anon,authenticated;
grant all on public.source_health to service_role;
alter table public.mapping_reviews enable row level security;
revoke all on public.mapping_reviews from anon,authenticated;
grant all on public.mapping_reviews to service_role;
alter table public.source_check_jobs enable row level security;
revoke all on public.source_check_jobs from anon,authenticated;
grant all on public.source_check_jobs to service_role;
alter table public.alert_match_jobs enable row level security;
revoke all on public.alert_match_jobs from anon,authenticated;
grant all on public.alert_match_jobs to service_role;
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon,authenticated;
grant all on public.notification_deliveries to service_role;
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon,authenticated;
grant all on public.audit_logs to service_role;
alter table public.idempotency_keys enable row level security;
revoke all on public.idempotency_keys from anon,authenticated;
grant all on public.idempotency_keys to service_role;
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon,authenticated;
grant all on public.rate_limits to service_role;
grant select on public.retailers to anon,authenticated;
create policy public_read on public.retailers for select to anon,authenticated using (true);
grant select on public.products to anon,authenticated;
create policy public_read on public.products for select to anon,authenticated using (true);
grant select on public.profiles to authenticated;
create policy own_read on public.profiles for select to authenticated using (id=auth.uid());
grant select on public.user_preferences to authenticated;
create policy own_read on public.user_preferences for select to authenticated using (user_id=auth.uid());
grant select on public.watchlists to authenticated;
create policy own_read on public.watchlists for select to authenticated using (user_id=auth.uid());
grant select on public.alert_rules to authenticated;
create policy own_read on public.alert_rules for select to authenticated using (user_id=auth.uid());
grant select on public.notifications to authenticated;
create policy own_read on public.notifications for select to authenticated using (user_id=auth.uid());
grant select on public.push_subscriptions to authenticated;
create policy own_read on public.push_subscriptions for select to authenticated using (user_id=auth.uid());
grant select on public.privacy_jobs to authenticated;
create policy own_read on public.privacy_jobs for select to authenticated using (user_id=auth.uid());

-- Staff cannot grant themselves staff status; provision through trusted DB administration only.
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated,service_role;
revoke all on function public.create_profile() from public,anon,authenticated;
grant all on public.feature_flags to service_role;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261106010000','platform',array[$pp_source_20261106010000$-- A-02 through A-11. Forward-fix only after merge. See docs/runbooks/migrations.md.
begin;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now(), privacy text not null default 'private' check(privacy='private'));
create table public.staff_members (user_id uuid primary key references auth.users(id) on delete cascade);
create function public.is_staff() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.staff_members where user_id=auth.uid()) $$;
create table public.user_preferences (user_id uuid primary key references public.profiles on delete cascade, in_app boolean not null default false, web_push boolean not null default false, zip text check(zip ~ '^[0-9]{5}$'), time_zone text not null default 'UTC', quiet_hours jsonb, daily_cap integer not null default 20 check(daily_cap between 1 and 100));
create function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.profiles(id) values(new.id); insert into public.user_preferences(user_id) values(new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile();
insert into public.profiles(id) select id from auth.users on conflict do nothing;
insert into public.user_preferences(user_id) select id from public.profiles on conflict do nothing;
create table public.retailers(id uuid primary key default gen_random_uuid(), name text not null, website text not null check(website ~ '^https://'), is_demo boolean not null default false);
create table public.source_permissions(id text primary key, retailer_id uuid references public.retailers, status text not null default 'not_evaluated' check(status in ('not_evaluated','candidate','approved','denied','suspended')), enabled boolean not null default false, is_demo boolean not null default false, reviewer text, evidence_url text, allowed_hosts text[] not null default '{}', ttl_seconds integer not null default 900 check(ttl_seconds between 30 and 86400), unit_cost_micros bigint check(unit_cost_micros>=0), daily_budget_micros bigint check(daily_budget_micros>=0), quota_per_hour integer not null default 60 check(quota_per_hour between 1 and 10000), concurrency integer not null default 1 check(concurrency between 1 and 10), poll_seconds integer not null default 900 check(poll_seconds>=30), check(status <> 'approved' or (reviewer is not null and evidence_url ~ '^https://')));
create table public.source_health(source_id text primary key references public.source_permissions on delete cascade, failures integer not null default 0, attempts integer not null default 0, last_successful_check_at timestamptz, last_error_code text, circuit_until timestamptz, quota_window timestamptz not null default now(), used integer not null default 0, total_cost_micros bigint, budget_day date, cost_today_micros bigint not null default 0);
create table public.products(id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null, set_name text, era text, product_type text not null, language text, release_region text, edition text, pack_count integer check(pack_count>0), gtin text, release_date date, reference_price_minor integer check(reference_price_minor>=0), reference_price_currency text check(length(reference_price_currency)=3), reference_price_source text, reference_price_valid_from timestamptz, reference_price_valid_until timestamptz, image_url text, identity_key text unique not null, is_demo boolean not null default false, check(reference_price_minor is null or (reference_price_currency is not null and reference_price_source is not null and reference_price_valid_from is not null and reference_price_valid_until>reference_price_valid_from)));
create table public.product_equivalences(id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products on delete cascade, gtin text unique not null check(gtin ~ '^[0-9]{8,14}$'), reviewed_by uuid references auth.users on delete set null);
create table public.mapping_reviews(id uuid primary key default gen_random_uuid(), source_id text references public.source_permissions, source_item_id text not null, candidates uuid[] not null default '{}', reason text not null, state text not null default 'pending' check(state in ('pending','resolved','rejected')), created_at timestamptz not null default now());
create table public.listings(id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products, retailer_id uuid not null references public.retailers, source_id text not null references public.source_permissions, source_item_id text not null, retailer_url text not null check(retailer_url ~ '^https://'), seller_type text not null default 'unknown' check(seller_type in ('retailer','third_party','mixed','unknown')), seller_id text, channel text not null default 'unknown' check(channel in ('ship_to_home','pickup','in_store_report','unknown')), region_code text, price_minor integer check(price_minor>=0), currency text check(length(currency)=3), is_demo boolean not null default false, priority integer not null default 0, next_check_at timestamptz not null default now(), mapping_state text not null default 'approved' check(mapping_state in ('approved','quarantined')), unique nulls not distinct(source_id,source_item_id,region_code,channel,seller_id));
create table public.stock_observations(id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings, source_id text not null references public.source_permissions, check_key uuid not null, availability_status text not null check(availability_status in ('in_stock','out_of_stock','preorder','unknown')), observed_at timestamptz not null, ingested_at timestamptz not null default now(), stale_after timestamptz not null, evidence_type text not null check(evidence_type in ('retailer_api','permitted_partner','moderated_report','editorial')), price_minor integer check(price_minor>=0), currency text, seller_type text not null, seller_id text, channel text not null, region_code text, parser_version text not null, payload_hash text not null, unique(source_id,check_key), check(stale_after>observed_at));
create table public.listing_current_state(listing_id uuid primary key references public.listings, observation_id uuid not null references public.stock_observations, conflicted boolean not null default false, last_successful_check_at timestamptz not null);
create table public.stock_events(id uuid primary key default gen_random_uuid(), observation_id uuid unique references public.stock_observations, listing_id uuid references public.listings, event_type text not null check(event_type in ('restock','new_listing','price_drop','status_change','local_sighting','release_reminder')), occurred_at timestamptz not null, snapshot jsonb not null);
create table public.source_check_jobs(id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings, source_id text not null references public.source_permissions, scheduled_for timestamptz not null, status text not null default 'pending' check(status in ('pending','running','done','quarantined','failed')), attempts integer not null default 0, lease_until timestamptz, lease_token uuid, started_at timestamptz, duration_ms integer, queue_delay_ms integer, available_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(listing_id,scheduled_for));
create index source_jobs_ready on public.source_check_jobs(status,available_at);
create table public.watchlists(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, product_id uuid references public.products, listing_id uuid references public.listings, created_at timestamptz not null default now(), check((product_id is null)<>(listing_id is null)), unique nulls not distinct(user_id,product_id,listing_id));
create table public.alert_rules(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, definition jsonb not null, created_at timestamptz not null default now());
create table public.alert_match_jobs(event_id uuid primary key references public.stock_events, status text not null default 'pending' check(status in ('pending','running','done','failed')), lease_until timestamptz, lease_token uuid, attempts integer not null default 0);
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, rule_id uuid references public.alert_rules on delete set null, event_id uuid references public.stock_events, channel text not null check(channel in ('in_app','web_push')), created_at timestamptz not null default now(), read_at timestamptz, title text not null, body text not null, action_url text, evidence_type text, observed_at timestamptz, unique(user_id,rule_id,event_id,channel));
create table public.notification_deliveries(id uuid primary key default gen_random_uuid(), notification_id uuid not null unique references public.notifications on delete cascade, status text not null default 'pending' check(status in ('pending','attempted','sent','failed','suppressed')), attempts integer not null default 0, available_at timestamptz not null default now(), lease_until timestamptz, lease_token uuid, last_error_code text);
create table public.notification_suppressions(user_id uuid not null references public.profiles on delete cascade,rule_id uuid not null references public.alert_rules on delete cascade,event_id uuid not null references public.stock_events,channel text not null,reason text not null,created_at timestamptz not null default now(),primary key(user_id,rule_id,event_id,channel));
alter table public.notification_suppressions enable row level security;
revoke all on public.notification_suppressions from anon,authenticated;
grant all on public.notification_suppressions to service_role;
create table public.push_subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, endpoint text not null, keys jsonb not null, created_at timestamptz not null default now(), unique(user_id,endpoint));
create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users on delete set null, action text not null, entity_id text, created_at timestamptz not null default now());
create table public.privacy_jobs(id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles on delete set null, kind text not null check(kind in ('export','delete')), status text not null default 'pending' check(status in ('pending','running','completed','blocked','failed')), result jsonb, error_code text, created_at timestamptz not null default now(), completed_at timestamptz, expires_at timestamptz, lease_until timestamptz, lease_token uuid);
create table public.idempotency_keys(user_id uuid not null references public.profiles on delete cascade, key uuid not null, operation text not null, body jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(user_id,key));
create table public.rate_limits(subject text not null, action text not null, bucket timestamptz not null, count integer not null, primary key(subject,action,bucket));
alter table public.retailers enable row level security;
revoke all on public.retailers from anon,authenticated;
grant all on public.retailers to service_role;
alter table public.products enable row level security;
revoke all on public.products from anon,authenticated;
grant all on public.products to service_role;
alter table public.product_equivalences enable row level security;
revoke all on public.product_equivalences from anon,authenticated;
grant all on public.product_equivalences to service_role;
alter table public.listings enable row level security;
revoke all on public.listings from anon,authenticated;
grant all on public.listings to service_role;
alter table public.stock_observations enable row level security;
revoke all on public.stock_observations from anon,authenticated;
grant all on public.stock_observations to service_role;
alter table public.listing_current_state enable row level security;
revoke all on public.listing_current_state from anon,authenticated;
grant all on public.listing_current_state to service_role;
alter table public.stock_events enable row level security;
revoke all on public.stock_events from anon,authenticated;
grant all on public.stock_events to service_role;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon,authenticated;
grant all on public.profiles to service_role;
alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon,authenticated;
grant all on public.user_preferences to service_role;
alter table public.watchlists enable row level security;
revoke all on public.watchlists from anon,authenticated;
grant all on public.watchlists to service_role;
alter table public.alert_rules enable row level security;
revoke all on public.alert_rules from anon,authenticated;
grant all on public.alert_rules to service_role;
alter table public.notifications enable row level security;
revoke all on public.notifications from anon,authenticated;
grant all on public.notifications to service_role;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon,authenticated;
grant all on public.push_subscriptions to service_role;
alter table public.privacy_jobs enable row level security;
revoke all on public.privacy_jobs from anon,authenticated;
grant all on public.privacy_jobs to service_role;
alter table public.staff_members enable row level security;
revoke all on public.staff_members from anon,authenticated;
grant all on public.staff_members to service_role;
alter table public.source_permissions enable row level security;
revoke all on public.source_permissions from anon,authenticated;
grant all on public.source_permissions to service_role;
alter table public.source_health enable row level security;
revoke all on public.source_health from anon,authenticated;
grant all on public.source_health to service_role;
alter table public.mapping_reviews enable row level security;
revoke all on public.mapping_reviews from anon,authenticated;
grant all on public.mapping_reviews to service_role;
alter table public.source_check_jobs enable row level security;
revoke all on public.source_check_jobs from anon,authenticated;
grant all on public.source_check_jobs to service_role;
alter table public.alert_match_jobs enable row level security;
revoke all on public.alert_match_jobs from anon,authenticated;
grant all on public.alert_match_jobs to service_role;
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon,authenticated;
grant all on public.notification_deliveries to service_role;
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon,authenticated;
grant all on public.audit_logs to service_role;
alter table public.idempotency_keys enable row level security;
revoke all on public.idempotency_keys from anon,authenticated;
grant all on public.idempotency_keys to service_role;
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon,authenticated;
grant all on public.rate_limits to service_role;
grant select on public.retailers to anon,authenticated;
create policy public_read on public.retailers for select to anon,authenticated using (true);
grant select on public.products to anon,authenticated;
create policy public_read on public.products for select to anon,authenticated using (true);
grant select on public.profiles to authenticated;
create policy own_read on public.profiles for select to authenticated using (id=auth.uid());
grant select on public.user_preferences to authenticated;
create policy own_read on public.user_preferences for select to authenticated using (user_id=auth.uid());
grant select on public.watchlists to authenticated;
create policy own_read on public.watchlists for select to authenticated using (user_id=auth.uid());
grant select on public.alert_rules to authenticated;
create policy own_read on public.alert_rules for select to authenticated using (user_id=auth.uid());
grant select on public.notifications to authenticated;
create policy own_read on public.notifications for select to authenticated using (user_id=auth.uid());
grant select on public.push_subscriptions to authenticated;
create policy own_read on public.push_subscriptions for select to authenticated using (user_id=auth.uid());
grant select on public.privacy_jobs to authenticated;
create policy own_read on public.privacy_jobs for select to authenticated using (user_id=auth.uid());

-- Staff cannot grant themselves staff status; provision through trusted DB administration only.
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated,service_role;
revoke all on function public.create_profile() from public,anon,authenticated;
grant all on public.feature_flags to service_role;
commit;
$pp_source_20261106010000$]);

-- SOURCE 20261106020000_transactions.sql

-- Server-only workers call these functions with service credentials. Never exposed to browsers.
create function public.schedule_checks(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare n integer; begin
 insert into public.source_health(source_id) select id from public.source_permissions on conflict do nothing;
 insert into public.source_check_jobs(listing_id,source_id,scheduled_for,available_at)
 select l.id,l.source_id,l.next_check_at,p_now from public.listings l join public.source_permissions s on s.id=l.source_id
 where s.enabled and s.status='approved' and l.mapping_state='approved' and l.next_check_at<=p_now
 and not exists(select 1 from public.source_check_jobs j where j.listing_id=l.id and j.status in ('pending','running')) on conflict do nothing;
 get diagnostics n=row_count; return n;
end $$;
create function public.claim_check(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.source_check_jobs; s public.source_permissions; h public.source_health; begin
 -- Expired leases retry the same immutable check ID, never an invented observation.
 for j in select q.* from public.source_check_jobs q join public.listings l on l.id=q.listing_id
 where ((q.status='pending' and q.available_at<=p_now) or (q.status='running' and q.lease_until<p_now))
 order by l.priority + (select count(*) from public.watchlists w where w.listing_id=l.id or w.product_id=l.product_id) desc,q.created_at,q.id for update of q skip locked limit 100 loop
 if j.attempts>=8 then update public.source_check_jobs set status='failed',lease_until=null where id=j.id;continue;end if;
 select * into s from public.source_permissions where id=j.source_id for update;
 if not s.enabled or s.status<>'approved' then update public.source_check_jobs set status='quarantined' where id=j.id; continue; end if;
 select * into h from public.source_health where source_id=s.id for update;
 if h.quota_window<=p_now-interval '1 hour' then update public.source_health set quota_window=p_now,used=0 where source_id=s.id returning * into h; end if;
 if h.budget_day is distinct from (p_now at time zone 'UTC')::date then update public.source_health set budget_day=(p_now at time zone 'UTC')::date,cost_today_micros=0 where source_id=s.id returning * into h;end if;
 if s.daily_budget_micros is not null and (s.unit_cost_micros is null or h.cost_today_micros+s.unit_cost_micros>s.daily_budget_micros) then update public.source_check_jobs set status='pending',available_at=(date_trunc('day',p_now at time zone 'UTC') at time zone 'UTC')+interval '1 day' where id=j.id;continue;end if;
 if h.used>=s.quota_per_hour or h.circuit_until>p_now then
 update public.source_check_jobs set status='pending',available_at=greatest(h.quota_window+interval '1 hour',coalesce(h.circuit_until,p_now)) where id=j.id; continue; end if;
 if (select count(*) from public.source_check_jobs where source_id=s.id and status='running' and lease_until>p_now)>=s.concurrency then continue; end if;
 update public.source_check_jobs set status='running',attempts=attempts+1,lease_until=p_now+interval '60 seconds',lease_token=gen_random_uuid(),started_at=p_now,queue_delay_ms=least(2147483647,greatest(0,extract(epoch from p_now-j.scheduled_for)*1000))::integer where id=j.id returning * into j;
 update public.source_health set used=used+1,attempts=attempts+1,total_cost_micros=case when s.unit_cost_micros is null then total_cost_micros else coalesce(total_cost_micros,0)+s.unit_cost_micros end,cost_today_micros=cost_today_micros+coalesce(s.unit_cost_micros,0) where source_id=s.id;
 return to_jsonb(j);
 end loop; return null;
end $$;
create function public.finish_check(p_job uuid,p_token uuid,p_outcome jsonb,p_now timestamptz default now()) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.source_check_jobs; l public.listings; s public.source_permissions; prev public.stock_observations; obs public.stock_observations; o jsonb; eid uuid; et text; snapshot jsonb; delay integer; begin
 select * into j from public.source_check_jobs where id=p_job for update;
 if j.id is null or j.status<>'running' or j.lease_token is distinct from p_token or j.lease_until<p_now then raise exception 'CONFLICT'; end if;
 update public.source_check_jobs set duration_ms=least(2147483647,greatest(0,extract(epoch from p_now-j.started_at)*1000))::integer where id=j.id;
 select * into s from public.source_permissions where id=j.source_id for update;
 if s.status<>'approved' or not s.enabled then update public.source_check_jobs set status='quarantined' where id=j.id; return null; end if;
 select * into l from public.listings where id=j.listing_id for update;
 if p_outcome->>'kind'<>'observation' then
 delay=least(86400,greatest(coalesce((p_outcome->>'retry_after_seconds')::integer,0), (30*power(2,least(j.attempts,8)))::integer)) + floor(random()*10)::integer;
 update public.source_check_jobs set status=case when j.attempts>=8 or p_outcome->>'kind'='not_supported' then 'failed' else 'pending' end,available_at=p_now+make_interval(secs=>delay),lease_until=null where id=j.id;
 update public.source_health set failures=failures+1,last_error_code=left(coalesce(p_outcome->>'reason_code',p_outcome->>'reason','unsupported'),80),circuit_until=case when failures+1>=5 then p_now+interval '15 minutes' else circuit_until end where source_id=s.id;
 update public.listings set next_check_at=p_now+make_interval(secs=>greatest(delay,s.poll_seconds)) where id=l.id;
 return null;
 end if;
 o=p_outcome->'observation';
 if l.mapping_state<>'approved' or o->>'source_id'<>s.id or (o->>'listing_id')::uuid<>l.id or (o->>'observed_at')::timestamptz>p_now or o->>'seller_type'<>l.seller_type or (o->>'seller_id') is distinct from l.seller_id or o->>'channel'<>l.channel or (o->>'region_code') is distinct from l.region_code then raise exception 'VALIDATION_ERROR'; end if;
 if s.is_demo and o->>'evidence_type'<>'editorial' then raise exception 'RIGHTS_DISABLED'; end if;
 if not s.is_demo and o->>'evidence_type' not in ('retailer_api','permitted_partner') then raise exception 'VALIDATION_ERROR'; end if;
 insert into public.stock_observations(listing_id,source_id,check_key,availability_status,observed_at,ingested_at,stale_after,evidence_type,price_minor,currency,seller_type,seller_id,channel,region_code,parser_version,payload_hash)
 values(l.id,s.id,j.id,o->>'availability_status',(o->>'observed_at')::timestamptz,p_now,(o->>'observed_at')::timestamptz+make_interval(secs=>s.ttl_seconds),o->>'evidence_type',(o->>'price_minor')::integer,o->>'currency',l.seller_type,l.seller_id,l.channel,l.region_code,o->>'parser_version',o->>'payload_hash') on conflict(source_id,check_key) do nothing returning * into obs;
 if obs.id is not null then
 select so.* into prev from public.listing_current_state cs join public.stock_observations so on so.id=cs.observation_id where cs.listing_id=l.id;
 if prev.id is null or obs.observed_at>prev.observed_at then
 insert into public.listing_current_state(listing_id,observation_id,last_successful_check_at) values(l.id,obs.id,p_now) on conflict(listing_id) do update set observation_id=excluded.observation_id,conflicted=false,last_successful_check_at=p_now;
 et=case when prev.availability_status='out_of_stock' and obs.availability_status='in_stock' then 'restock' when (prev.id is null or prev.availability_status='unknown') and obs.availability_status='in_stock' then 'new_listing' when prev.price_minor is not null and obs.price_minor<prev.price_minor and obs.currency=prev.currency and obs.seller_id is not distinct from prev.seller_id and obs.seller_type=prev.seller_type and obs.channel=prev.channel then 'price_drop' when prev.availability_status is distinct from obs.availability_status then 'status_change' else null end;
 if et is not null then
 snapshot=to_jsonb(obs)||jsonb_build_object('product_id',l.product_id,'retailer_id',l.retailer_id,'source_url',l.retailer_url,'previous_status',coalesce(prev.availability_status,'unknown'),'current_status',obs.availability_status,'is_demo',l.is_demo,'event_type',et);
 snapshot=snapshot||(select jsonb_build_object('set_name',p.set_name,'product_type',p.product_type) from public.products p where p.id=l.product_id);
 insert into public.stock_events(observation_id,listing_id,event_type,occurred_at,snapshot) values(obs.id,l.id,et,obs.observed_at,snapshot) returning id into eid;
 insert into public.alert_match_jobs(event_id) values(eid) on conflict do nothing;
 end if;
 elsif obs.observed_at=prev.observed_at and (obs.availability_status<>prev.availability_status or obs.price_minor is distinct from prev.price_minor) then update public.listing_current_state set conflicted=true,last_successful_check_at=p_now where listing_id=l.id;
 end if;
 end if;
 update public.listing_current_state set last_successful_check_at=p_now where listing_id=l.id;
 update public.source_check_jobs set status='done',lease_until=null where id=j.id;
 update public.source_health set failures=0,last_error_code=null,circuit_until=null,last_successful_check_at=p_now where source_id=s.id;
 update public.listings set next_check_at=p_now+make_interval(secs=>s.poll_seconds * case when l.priority>0 or exists(select 1 from public.watchlists where listing_id=l.id or product_id=l.product_id) then 1 else 4 end) where id=l.id;
 return eid;
end $$;
create function public.take_rate_limit(p_subject text,p_action text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; b timestamptz; begin
 b=to_timestamp(floor(extract(epoch from now())/p_seconds)*p_seconds);
 insert into public.rate_limits(subject,action,bucket,count) values(p_subject,p_action,b,1) on conflict(subject,action,bucket) do update set count=public.rate_limits.count+1 returning count into n;
 return n<=p_limit;
end $$;
-- All private mutations derive the actor from the verified JWT in PostgreSQL.
create function public.account_write(p_operation text,p_key uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid(); existing public.idempotency_keys; result jsonb; rid uuid; n integer; begin
 if uid is null then raise exception 'UNAUTHENTICATED'; end if;
 perform 1 from public.profiles where id=uid for update;
 select * into existing from public.idempotency_keys where user_id=uid and key=p_key;
 if existing.key is not null then if existing.operation<>p_operation or existing.body<>p_body then raise exception 'CONFLICT'; end if; return existing.result; end if;
 if p_key is null or jsonb_typeof(p_body)<>'object' then raise exception 'VALIDATION_ERROR'; end if;
 if not public.take_rate_limit(uid::text,'account-write',60,60) then raise exception 'RATE_LIMITED'; end if;
 case p_operation
 when 'watch_create' then
 if (select count(*) from public.watchlists where user_id=uid)>=200 then raise exception 'RATE_LIMITED'; end if;
 insert into public.watchlists(user_id,product_id,listing_id) values(uid,(p_body->>'product_id')::uuid,(p_body->>'listing_id')::uuid) on conflict(user_id,product_id,listing_id) do update set user_id=excluded.user_id returning to_jsonb(watchlists)-'user_id' into result;
 when 'watch_delete' then delete from public.watchlists where id=(p_body->>'id')::uuid and user_id=uid returning jsonb_build_object('id',id) into result;
 when 'rule_create' then
 if (select count(*) from public.alert_rules where user_id=uid)>=50 then raise exception 'RATE_LIMITED'; end if;
 if not (p_body ?& array['enabled','product_ids','triggers','delivery_channels','daily_cap','cooldown_minutes']) or (p_body->>'daily_cap')::integer not between 1 and 100 or (p_body->>'cooldown_minutes')::integer not between 0 and 10080 then raise exception 'VALIDATION_ERROR'; end if;
 insert into public.alert_rules(user_id,definition) values(uid,p_body-'id') returning definition||jsonb_build_object('id',id) into result;
 when 'rule_update' then
 if not (p_body ?& array['id','enabled','product_ids','triggers','delivery_channels','daily_cap','cooldown_minutes']) or (p_body->>'daily_cap')::integer not between 1 and 100 or (p_body->>'cooldown_minutes')::integer not between 0 and 10080 then raise exception 'VALIDATION_ERROR'; end if;
 update public.alert_rules set definition=p_body-'id' where id=(p_body->>'id')::uuid and user_id=uid returning definition||jsonb_build_object('id',id) into result;
 when 'rule_delete' then delete from public.alert_rules where id=(p_body->>'id')::uuid and user_id=uid returning jsonb_build_object('id',id) into result;
 when 'notification_read' then update public.notifications set read_at=coalesce(read_at,now()) where id=(p_body->>'id')::uuid and user_id=uid returning to_jsonb(notifications)-'user_id' into result;
 when 'preferences' then
 if p_body ? 'time_zone' and not exists(select 1 from pg_timezone_names where name=p_body->>'time_zone') then raise exception 'VALIDATION_ERROR'; end if;
 update public.user_preferences set in_app=coalesce((p_body->>'in_app')::boolean,in_app),web_push=coalesce((p_body->>'web_push')::boolean,web_push),zip=case when p_body ? 'zip' then p_body->>'zip' else zip end,time_zone=coalesce(p_body->>'time_zone',time_zone),quiet_hours=case when p_body ? 'quiet_hours' then nullif(p_body->'quiet_hours','null'::jsonb) else quiet_hours end,daily_cap=coalesce((p_body->>'daily_cap')::integer,daily_cap) where user_id=uid returning to_jsonb(user_preferences)-'user_id' into result;
 when 'push_create' then
 if (select count(*) from public.push_subscriptions where user_id=uid)>=10 then raise exception 'RATE_LIMITED'; end if;
 if p_body->>'endpoint' !~ '^https://' or not (p_body->'keys' ?& array['p256dh','auth']) then raise exception 'VALIDATION_ERROR'; end if;
 insert into public.push_subscriptions(user_id,endpoint,keys) values(uid,p_body->>'endpoint',p_body->'keys') on conflict(user_id,endpoint) do update set keys=excluded.keys returning jsonb_build_object('id',id) into result;
 when 'push_delete' then delete from public.push_subscriptions where id=(p_body->>'id')::uuid and user_id=uid returning jsonb_build_object('id',id) into result;
 when 'export','delete' then
 if exists(select 1 from public.privacy_jobs where user_id=uid and kind=p_operation and status in ('pending','running','blocked')) then select jsonb_build_object('id',id,'status',status) into result from public.privacy_jobs where user_id=uid and kind=p_operation and status in ('pending','running','blocked') order by created_at limit 1;
 else insert into public.privacy_jobs(user_id,kind) values(uid,p_operation) returning jsonb_build_object('id',id,'status',status) into result; end if;
 else raise exception 'VALIDATION_ERROR';
 end case;
 if result is null then raise exception 'NOT_FOUND'; end if;
 insert into public.idempotency_keys(user_id,key,operation,body,result) values(uid,p_key,p_operation,p_body,result);
 return result;
end $$;
create function public.admin_source(p_id text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.source_permissions; begin
 if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
 select * into s from public.source_permissions where id=p_id for update; if s.id is null then raise exception 'NOT_FOUND'; end if;
 -- UI can suspend, deny, pause or degrade; approval is a separately reviewed DB operation.
 if p_body ? 'status' and p_body->>'status' not in ('suspended','denied','candidate') then raise exception 'VALIDATION_ERROR'; end if;
 update public.source_permissions set enabled=coalesce((p_body->>'enabled')::boolean,enabled),status=coalesce(p_body->>'status',status) where id=p_id returning * into s;
 if not s.enabled or s.status<>'approved' then update public.source_check_jobs set status='quarantined',lease_until=null where source_id=p_id and status in ('pending','running'); end if;
 insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'source_changed',p_id);
 return jsonb_build_object('id',s.id,'status',s.status,'enabled',s.enabled);
end $$;
create function public.admin_flag(p_name text,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
 if p_enabled and p_name in ('retailer_verification','licensed_card_art') then raise exception 'RIGHTS_DISABLED'; end if;
 update public.feature_flags set enabled=p_enabled where name=p_name; if not found then raise exception 'NOT_FOUND'; end if;
 insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'flag_changed',p_name);
 return jsonb_build_object('name',p_name,'enabled',p_enabled);
end $$;
create function public.event_is_current(p_event uuid,p_rule uuid,p_now timestamptz default now()) returns boolean language plpgsql security definer set search_path='' as $$
declare e public.stock_events; r public.alert_rules; o public.stock_observations; c public.listing_current_state; sp public.source_permissions; begin
 select * into e from public.stock_events where id=p_event;select * into r from public.alert_rules where id=p_rule;
 if e.id is null or r.id is null or not coalesce((r.definition->>'enabled')::boolean,false) then return false;end if;
 if e.snapshot->>'stale_after' is null or (e.snapshot->>'stale_after')::timestamptz<=p_now then return false;end if;
 if e.snapshot->>'source_id' is not null then
 select * into sp from public.source_permissions where id=e.snapshot->>'source_id';
 if sp.id is null or not sp.enabled or sp.status<>'approved' then return false;end if;
 if not sp.is_demo and not coalesce((select enabled from public.feature_flags where name='retailer_verification'),false) then return false;end if;
 end if;
 if e.listing_id is not null then
 select * into c from public.listing_current_state where listing_id=e.listing_id;
 select * into o from public.stock_observations where id=c.observation_id;
 if o.id is null or c.conflicted or o.stale_after<=p_now then return false;end if;
 if e.event_type in ('restock','new_listing') and o.availability_status<>'in_stock' then return false;end if;
 if r.definition->>'max_price_minor' is not null and (o.price_minor is null or o.currency is distinct from r.definition->>'currency' or o.price_minor>(r.definition->>'max_price_minor')::integer) then return false;end if;
 end if;return true;
end $$;
revoke all on function public.event_is_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.event_is_current(uuid,uuid,timestamptz) to service_role;
create function public.suppress_notification(p_user uuid,p_rule uuid,p_event uuid,p_channel text,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from public.alert_rules where id=p_rule and user_id=p_user) and exists(select 1 from public.stock_events where id=p_event) then
 insert into public.notification_suppressions(user_id,rule_id,event_id,channel,reason) values(p_user,p_rule,p_event,p_channel,p_reason) on conflict do nothing;end if;return null;end $$;
revoke all on function public.suppress_notification(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.suppress_notification(uuid,uuid,uuid,text,text) to service_role;
-- Durable inbox + outbox creation serialized per user. SQL independently enforces preferences/caps/dedup.
create function public.enqueue_notification(p_user uuid,p_rule uuid,p_event uuid,p_channel text,p_body jsonb,p_now timestamptz default now()) returns uuid language plpgsql security definer set search_path='' as $$
declare prefs public.user_preferences; rule public.alert_rules; ev public.stock_events; nid uuid; tz text; wall_time text; q jsonb; starttime text; endtime text; begin
 select * into prefs from public.user_preferences where user_id=p_user for update;
 select * into rule from public.alert_rules where id=p_rule and user_id=p_user for share;
 select * into ev from public.stock_events where id=p_event;
 if prefs.user_id is null or rule.id is null or ev.id is null or not prefs.in_app or not coalesce((rule.definition->>'enabled')::boolean,false) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'opt_in_or_rule_disabled'); end if;
 if p_channel='web_push' and (not prefs.web_push or not coalesce((select enabled from public.feature_flags where name='web_push'),false) or not (rule.definition->'delivery_channels' ? 'web_push')) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'push_disabled'); end if;
 if p_body ? 'rule_snapshot' and p_body->'rule_snapshot' is distinct from rule.definition then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'rule_changed');end if;
 if p_channel not in ('in_app','web_push') then raise exception 'VALIDATION_ERROR'; end if;
 select id into nid from public.notifications where user_id=p_user and rule_id=p_rule and event_id=p_event and channel=p_channel; if nid is not null then return nid; end if;
 if not public.event_is_current(p_event,p_rule,p_now) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'signal_no_longer_current');end if;
 if ev.snapshot->>'stale_after' is not null and (ev.snapshot->>'stale_after')::timestamptz<=p_now then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'stale'); end if;
 if ev.snapshot->>'source_id' is not null and not exists(select 1 from public.source_permissions where id=ev.snapshot->>'source_id' and status='approved' and enabled) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'source_disabled'); end if;
 if ev.listing_id is not null and exists(select 1 from public.listing_current_state where listing_id=ev.listing_id and conflicted) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'conflicting_evidence'); end if;
 -- Both account and rule quiet hours are respected, using PostgreSQL IANA/DST conversion.
 for q in select value from jsonb_array_elements(jsonb_build_array(prefs.quiet_hours,rule.definition->'quiet_hours')) loop
 if q is null or q='null'::jsonb then continue; end if;
 tz=coalesce(q->>'time_zone',prefs.time_zone); wall_time=to_char(p_now at time zone tz,'HH24:MI'); starttime=q->>'start'; endtime=q->>'end';
 if starttime=endtime or (starttime<endtime and wall_time>=starttime and wall_time<endtime) or (starttime>endtime and (wall_time>=starttime or wall_time<endtime)) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'quiet_hours'); end if;
 end loop;
 if (select count(distinct event_id) from public.notifications where user_id=p_user and created_at>=date_trunc('day',p_now at time zone prefs.time_zone) at time zone prefs.time_zone)>=prefs.daily_cap and not exists(select 1 from public.notifications where user_id=p_user and event_id=p_event) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'user_daily_cap'); end if;
 if (select count(distinct event_id) from public.notifications where user_id=p_user and rule_id=p_rule and created_at>=date_trunc('day',p_now at time zone prefs.time_zone) at time zone prefs.time_zone)>=(rule.definition->>'daily_cap')::integer and not exists(select 1 from public.notifications where user_id=p_user and rule_id=p_rule and event_id=p_event) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'rule_daily_cap'); end if;
 if exists(select 1 from public.notifications where user_id=p_user and rule_id=p_rule and event_id<>p_event and created_at>p_now-make_interval(mins=>(rule.definition->>'cooldown_minutes')::integer)) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'cooldown'); end if;
 insert into public.notifications(user_id,rule_id,event_id,channel,created_at,title,body,action_url,evidence_type,observed_at) values(p_user,p_rule,p_event,p_channel,p_now,left(p_body->>'title',160),left(p_body->>'body',1000),p_body->>'action_url',ev.snapshot->>'evidence_type',ev.occurred_at) returning id into nid;
 if p_channel='web_push' then insert into public.notification_deliveries(notification_id) values(nid); end if;
 return nid;
end $$;
-- Worker queue claims use leases and compare-and-swap completion tokens.
create function public.claim_alert() returns jsonb language plpgsql security definer set search_path='' as $$ declare j public.alert_match_jobs; begin
 select * into j from public.alert_match_jobs where status='pending' or (status='running' and lease_until<now()) order by event_id for update skip locked limit 1;
 if j.event_id is null then return null; end if;
 update public.alert_match_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where event_id=j.event_id returning * into j; return to_jsonb(j);
end $$;
create function public.claim_delivery() returns jsonb language plpgsql security definer set search_path='' as $$ declare j public.notification_deliveries; begin
 select * into j from public.notification_deliveries where (status in ('pending','failed') and available_at<=now() and attempts<5) or (status='attempted' and lease_until<now() and attempts<5) order by available_at,id for update skip locked limit 1;
 if j.id is null then return null; end if;
 update public.notification_deliveries set status='attempted',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=j.id returning * into j; return to_jsonb(j);
end $$;
create function public.claim_privacy() returns jsonb language plpgsql security definer set search_path='' as $$ declare j public.privacy_jobs; begin
 select * into j from public.privacy_jobs where status='pending' or (status='running' and lease_until<now()) order by created_at,id for update skip locked limit 1;
 if j.id is null then return null; end if;
 update public.privacy_jobs set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=j.id returning * into j; return to_jsonb(j);
end $$;

create function public.privacy_export(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; t text; rows jsonb; begin
 result=jsonb_build_object('version',1,'exported_at',now());
 foreach t in array array['profiles','user_preferences','watchlists','alert_rules','notifications','push_subscriptions','notification_suppressions'] loop
 execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from public.%I x where %I=$1',t,case when t='profiles' then 'id' else 'user_id' end) into rows using p_user;
 result=result||jsonb_build_object(t,rows);
 end loop; return result;
end $$;
revoke all on function public.schedule_checks(timestamptz) from public,anon,authenticated;
grant execute on function public.schedule_checks(timestamptz) to service_role;
revoke all on function public.claim_check(timestamptz) from public,anon,authenticated;
grant execute on function public.claim_check(timestamptz) to service_role;
revoke all on function public.finish_check(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.finish_check(uuid,uuid,jsonb,timestamptz) to service_role;
revoke all on function public.take_rate_limit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.take_rate_limit(text,text,integer,integer) to service_role;
revoke all on function public.account_write(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.account_write(text,uuid,jsonb) to authenticated,service_role;
revoke all on function public.admin_source(text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_source(text,jsonb) to authenticated,service_role;
revoke all on function public.admin_flag(text,boolean) from public,anon,authenticated;
grant execute on function public.admin_flag(text,boolean) to authenticated,service_role;
revoke all on function public.enqueue_notification(uuid,uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_notification(uuid,uuid,uuid,text,jsonb,timestamptz) to service_role;
revoke all on function public.claim_alert() from public,anon,authenticated;
grant execute on function public.claim_alert() to service_role;
revoke all on function public.claim_delivery() from public,anon,authenticated;
grant execute on function public.claim_delivery() to service_role;
revoke all on function public.claim_privacy() from public,anon,authenticated;
grant execute on function public.claim_privacy() to service_role;
revoke all on function public.privacy_export(uuid) from public,anon,authenticated;
grant execute on function public.privacy_export(uuid) to service_role;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261106020000','transactions',array[$pp_source_20261106020000$begin;
-- Server-only workers call these functions with service credentials. Never exposed to browsers.
create function public.schedule_checks(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare n integer; begin
 insert into public.source_health(source_id) select id from public.source_permissions on conflict do nothing;
 insert into public.source_check_jobs(listing_id,source_id,scheduled_for,available_at)
 select l.id,l.source_id,l.next_check_at,p_now from public.listings l join public.source_permissions s on s.id=l.source_id
 where s.enabled and s.status='approved' and l.mapping_state='approved' and l.next_check_at<=p_now
 and not exists(select 1 from public.source_check_jobs j where j.listing_id=l.id and j.status in ('pending','running')) on conflict do nothing;
 get diagnostics n=row_count; return n;
end $$;
create function public.claim_check(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.source_check_jobs; s public.source_permissions; h public.source_health; begin
 -- Expired leases retry the same immutable check ID, never an invented observation.
 for j in select q.* from public.source_check_jobs q join public.listings l on l.id=q.listing_id
 where ((q.status='pending' and q.available_at<=p_now) or (q.status='running' and q.lease_until<p_now))
 order by l.priority + (select count(*) from public.watchlists w where w.listing_id=l.id or w.product_id=l.product_id) desc,q.created_at,q.id for update of q skip locked limit 100 loop
 if j.attempts>=8 then update public.source_check_jobs set status='failed',lease_until=null where id=j.id;continue;end if;
 select * into s from public.source_permissions where id=j.source_id for update;
 if not s.enabled or s.status<>'approved' then update public.source_check_jobs set status='quarantined' where id=j.id; continue; end if;
 select * into h from public.source_health where source_id=s.id for update;
 if h.quota_window<=p_now-interval '1 hour' then update public.source_health set quota_window=p_now,used=0 where source_id=s.id returning * into h; end if;
 if h.budget_day is distinct from (p_now at time zone 'UTC')::date then update public.source_health set budget_day=(p_now at time zone 'UTC')::date,cost_today_micros=0 where source_id=s.id returning * into h;end if;
 if s.daily_budget_micros is not null and (s.unit_cost_micros is null or h.cost_today_micros+s.unit_cost_micros>s.daily_budget_micros) then update public.source_check_jobs set status='pending',available_at=(date_trunc('day',p_now at time zone 'UTC') at time zone 'UTC')+interval '1 day' where id=j.id;continue;end if;
 if h.used>=s.quota_per_hour or h.circuit_until>p_now then
 update public.source_check_jobs set status='pending',available_at=greatest(h.quota_window+interval '1 hour',coalesce(h.circuit_until,p_now)) where id=j.id; continue; end if;
 if (select count(*) from public.source_check_jobs where source_id=s.id and status='running' and lease_until>p_now)>=s.concurrency then continue; end if;
 update public.source_check_jobs set status='running',attempts=attempts+1,lease_until=p_now+interval '60 seconds',lease_token=gen_random_uuid(),started_at=p_now,queue_delay_ms=least(2147483647,greatest(0,extract(epoch from p_now-j.scheduled_for)*1000))::integer where id=j.id returning * into j;
 update public.source_health set used=used+1,attempts=attempts+1,total_cost_micros=case when s.unit_cost_micros is null then total_cost_micros else coalesce(total_cost_micros,0)+s.unit_cost_micros end,cost_today_micros=cost_today_micros+coalesce(s.unit_cost_micros,0) where source_id=s.id;
 return to_jsonb(j);
 end loop; return null;
end $$;
create function public.finish_check(p_job uuid,p_token uuid,p_outcome jsonb,p_now timestamptz default now()) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.source_check_jobs; l public.listings; s public.source_permissions; prev public.stock_observations; obs public.stock_observations; o jsonb; eid uuid; et text; snapshot jsonb; delay integer; begin
 select * into j from public.source_check_jobs where id=p_job for update;
 if j.id is null or j.status<>'running' or j.lease_token is distinct from p_token or j.lease_until<p_now then raise exception 'CONFLICT'; end if;
 update public.source_check_jobs set duration_ms=least(2147483647,greatest(0,extract(epoch from p_now-j.started_at)*1000))::integer where id=j.id;
 select * into s from public.source_permissions where id=j.source_id for update;
 if s.status<>'approved' or not s.enabled then update public.source_check_jobs set status='quarantined' where id=j.id; return null; end if;
 select * into l from public.listings where id=j.listing_id for update;
 if p_outcome->>'kind'<>'observation' then
 delay=least(86400,greatest(coalesce((p_outcome->>'retry_after_seconds')::integer,0), (30*power(2,least(j.attempts,8)))::integer)) + floor(random()*10)::integer;
 update public.source_check_jobs set status=case when j.attempts>=8 or p_outcome->>'kind'='not_supported' then 'failed' else 'pending' end,available_at=p_now+make_interval(secs=>delay),lease_until=null where id=j.id;
 update public.source_health set failures=failures+1,last_error_code=left(coalesce(p_outcome->>'reason_code',p_outcome->>'reason','unsupported'),80),circuit_until=case when failures+1>=5 then p_now+interval '15 minutes' else circuit_until end where source_id=s.id;
 update public.listings set next_check_at=p_now+make_interval(secs=>greatest(delay,s.poll_seconds)) where id=l.id;
 return null;
 end if;
 o=p_outcome->'observation';
 if l.mapping_state<>'approved' or o->>'source_id'<>s.id or (o->>'listing_id')::uuid<>l.id or (o->>'observed_at')::timestamptz>p_now or o->>'seller_type'<>l.seller_type or (o->>'seller_id') is distinct from l.seller_id or o->>'channel'<>l.channel or (o->>'region_code') is distinct from l.region_code then raise exception 'VALIDATION_ERROR'; end if;
 if s.is_demo and o->>'evidence_type'<>'editorial' then raise exception 'RIGHTS_DISABLED'; end if;
 if not s.is_demo and o->>'evidence_type' not in ('retailer_api','permitted_partner') then raise exception 'VALIDATION_ERROR'; end if;
 insert into public.stock_observations(listing_id,source_id,check_key,availability_status,observed_at,ingested_at,stale_after,evidence_type,price_minor,currency,seller_type,seller_id,channel,region_code,parser_version,payload_hash)
 values(l.id,s.id,j.id,o->>'availability_status',(o->>'observed_at')::timestamptz,p_now,(o->>'observed_at')::timestamptz+make_interval(secs=>s.ttl_seconds),o->>'evidence_type',(o->>'price_minor')::integer,o->>'currency',l.seller_type,l.seller_id,l.channel,l.region_code,o->>'parser_version',o->>'payload_hash') on conflict(source_id,check_key) do nothing returning * into obs;
 if obs.id is not null then
 select so.* into prev from public.listing_current_state cs join public.stock_observations so on so.id=cs.observation_id where cs.listing_id=l.id;
 if prev.id is null or obs.observed_at>prev.observed_at then
 insert into public.listing_current_state(listing_id,observation_id,last_successful_check_at) values(l.id,obs.id,p_now) on conflict(listing_id) do update set observation_id=excluded.observation_id,conflicted=false,last_successful_check_at=p_now;
 et=case when prev.availability_status='out_of_stock' and obs.availability_status='in_stock' then 'restock' when (prev.id is null or prev.availability_status='unknown') and obs.availability_status='in_stock' then 'new_listing' when prev.price_minor is not null and obs.price_minor<prev.price_minor and obs.currency=prev.currency and obs.seller_id is not distinct from prev.seller_id and obs.seller_type=prev.seller_type and obs.channel=prev.channel then 'price_drop' when prev.availability_status is distinct from obs.availability_status then 'status_change' else null end;
 if et is not null then
 snapshot=to_jsonb(obs)||jsonb_build_object('product_id',l.product_id,'retailer_id',l.retailer_id,'source_url',l.retailer_url,'previous_status',coalesce(prev.availability_status,'unknown'),'current_status',obs.availability_status,'is_demo',l.is_demo,'event_type',et);
 snapshot=snapshot||(select jsonb_build_object('set_name',p.set_name,'product_type',p.product_type) from public.products p where p.id=l.product_id);
 insert into public.stock_events(observation_id,listing_id,event_type,occurred_at,snapshot) values(obs.id,l.id,et,obs.observed_at,snapshot) returning id into eid;
 insert into public.alert_match_jobs(event_id) values(eid) on conflict do nothing;
 end if;
 elsif obs.observed_at=prev.observed_at and (obs.availability_status<>prev.availability_status or obs.price_minor is distinct from prev.price_minor) then update public.listing_current_state set conflicted=true,last_successful_check_at=p_now where listing_id=l.id;
 end if;
 end if;
 update public.listing_current_state set last_successful_check_at=p_now where listing_id=l.id;
 update public.source_check_jobs set status='done',lease_until=null where id=j.id;
 update public.source_health set failures=0,last_error_code=null,circuit_until=null,last_successful_check_at=p_now where source_id=s.id;
 update public.listings set next_check_at=p_now+make_interval(secs=>s.poll_seconds * case when l.priority>0 or exists(select 1 from public.watchlists where listing_id=l.id or product_id=l.product_id) then 1 else 4 end) where id=l.id;
 return eid;
end $$;
create function public.take_rate_limit(p_subject text,p_action text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; b timestamptz; begin
 b=to_timestamp(floor(extract(epoch from now())/p_seconds)*p_seconds);
 insert into public.rate_limits(subject,action,bucket,count) values(p_subject,p_action,b,1) on conflict(subject,action,bucket) do update set count=public.rate_limits.count+1 returning count into n;
 return n<=p_limit;
end $$;
-- All private mutations derive the actor from the verified JWT in PostgreSQL.
create function public.account_write(p_operation text,p_key uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid(); existing public.idempotency_keys; result jsonb; rid uuid; n integer; begin
 if uid is null then raise exception 'UNAUTHENTICATED'; end if;
 perform 1 from public.profiles where id=uid for update;
 select * into existing from public.idempotency_keys where user_id=uid and key=p_key;
 if existing.key is not null then if existing.operation<>p_operation or existing.body<>p_body then raise exception 'CONFLICT'; end if; return existing.result; end if;
 if p_key is null or jsonb_typeof(p_body)<>'object' then raise exception 'VALIDATION_ERROR'; end if;
 if not public.take_rate_limit(uid::text,'account-write',60,60) then raise exception 'RATE_LIMITED'; end if;
 case p_operation
 when 'watch_create' then
 if (select count(*) from public.watchlists where user_id=uid)>=200 then raise exception 'RATE_LIMITED'; end if;
 insert into public.watchlists(user_id,product_id,listing_id) values(uid,(p_body->>'product_id')::uuid,(p_body->>'listing_id')::uuid) on conflict(user_id,product_id,listing_id) do update set user_id=excluded.user_id returning to_jsonb(watchlists)-'user_id' into result;
 when 'watch_delete' then delete from public.watchlists where id=(p_body->>'id')::uuid and user_id=uid returning jsonb_build_object('id',id) into result;
 when 'rule_create' then
 if (select count(*) from public.alert_rules where user_id=uid)>=50 then raise exception 'RATE_LIMITED'; end if;
 if not (p_body ?& array['enabled','product_ids','triggers','delivery_channels','daily_cap','cooldown_minutes']) or (p_body->>'daily_cap')::integer not between 1 and 100 or (p_body->>'cooldown_minutes')::integer not between 0 and 10080 then raise exception 'VALIDATION_ERROR'; end if;
 insert into public.alert_rules(user_id,definition) values(uid,p_body-'id') returning definition||jsonb_build_object('id',id) into result;
 when 'rule_update' then
 if not (p_body ?& array['id','enabled','product_ids','triggers','delivery_channels','daily_cap','cooldown_minutes']) or (p_body->>'daily_cap')::integer not between 1 and 100 or (p_body->>'cooldown_minutes')::integer not between 0 and 10080 then raise exception 'VALIDATION_ERROR'; end if;
 update public.alert_rules set definition=p_body-'id' where id=(p_body->>'id')::uuid and user_id=uid returning definition||jsonb_build_object('id',id) into result;
 when 'rule_delete' then delete from public.alert_rules where id=(p_body->>'id')::uuid and user_id=uid returning jsonb_build_object('id',id) into result;
 when 'notification_read' then update public.notifications set read_at=coalesce(read_at,now()) where id=(p_body->>'id')::uuid and user_id=uid returning to_jsonb(notifications)-'user_id' into result;
 when 'preferences' then
 if p_body ? 'time_zone' and not exists(select 1 from pg_timezone_names where name=p_body->>'time_zone') then raise exception 'VALIDATION_ERROR'; end if;
 update public.user_preferences set in_app=coalesce((p_body->>'in_app')::boolean,in_app),web_push=coalesce((p_body->>'web_push')::boolean,web_push),zip=case when p_body ? 'zip' then p_body->>'zip' else zip end,time_zone=coalesce(p_body->>'time_zone',time_zone),quiet_hours=case when p_body ? 'quiet_hours' then nullif(p_body->'quiet_hours','null'::jsonb) else quiet_hours end,daily_cap=coalesce((p_body->>'daily_cap')::integer,daily_cap) where user_id=uid returning to_jsonb(user_preferences)-'user_id' into result;
 when 'push_create' then
 if (select count(*) from public.push_subscriptions where user_id=uid)>=10 then raise exception 'RATE_LIMITED'; end if;
 if p_body->>'endpoint' !~ '^https://' or not (p_body->'keys' ?& array['p256dh','auth']) then raise exception 'VALIDATION_ERROR'; end if;
 insert into public.push_subscriptions(user_id,endpoint,keys) values(uid,p_body->>'endpoint',p_body->'keys') on conflict(user_id,endpoint) do update set keys=excluded.keys returning jsonb_build_object('id',id) into result;
 when 'push_delete' then delete from public.push_subscriptions where id=(p_body->>'id')::uuid and user_id=uid returning jsonb_build_object('id',id) into result;
 when 'export','delete' then
 if exists(select 1 from public.privacy_jobs where user_id=uid and kind=p_operation and status in ('pending','running','blocked')) then select jsonb_build_object('id',id,'status',status) into result from public.privacy_jobs where user_id=uid and kind=p_operation and status in ('pending','running','blocked') order by created_at limit 1;
 else insert into public.privacy_jobs(user_id,kind) values(uid,p_operation) returning jsonb_build_object('id',id,'status',status) into result; end if;
 else raise exception 'VALIDATION_ERROR';
 end case;
 if result is null then raise exception 'NOT_FOUND'; end if;
 insert into public.idempotency_keys(user_id,key,operation,body,result) values(uid,p_key,p_operation,p_body,result);
 return result;
end $$;
create function public.admin_source(p_id text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.source_permissions; begin
 if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
 select * into s from public.source_permissions where id=p_id for update; if s.id is null then raise exception 'NOT_FOUND'; end if;
 -- UI can suspend, deny, pause or degrade; approval is a separately reviewed DB operation.
 if p_body ? 'status' and p_body->>'status' not in ('suspended','denied','candidate') then raise exception 'VALIDATION_ERROR'; end if;
 update public.source_permissions set enabled=coalesce((p_body->>'enabled')::boolean,enabled),status=coalesce(p_body->>'status',status) where id=p_id returning * into s;
 if not s.enabled or s.status<>'approved' then update public.source_check_jobs set status='quarantined',lease_until=null where source_id=p_id and status in ('pending','running'); end if;
 insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'source_changed',p_id);
 return jsonb_build_object('id',s.id,'status',s.status,'enabled',s.enabled);
end $$;
create function public.admin_flag(p_name text,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
 if p_enabled and p_name in ('retailer_verification','licensed_card_art') then raise exception 'RIGHTS_DISABLED'; end if;
 update public.feature_flags set enabled=p_enabled where name=p_name; if not found then raise exception 'NOT_FOUND'; end if;
 insert into public.audit_logs(actor_id,action,entity_id) values(auth.uid(),'flag_changed',p_name);
 return jsonb_build_object('name',p_name,'enabled',p_enabled);
end $$;
create function public.event_is_current(p_event uuid,p_rule uuid,p_now timestamptz default now()) returns boolean language plpgsql security definer set search_path='' as $$
declare e public.stock_events; r public.alert_rules; o public.stock_observations; c public.listing_current_state; sp public.source_permissions; begin
 select * into e from public.stock_events where id=p_event;select * into r from public.alert_rules where id=p_rule;
 if e.id is null or r.id is null or not coalesce((r.definition->>'enabled')::boolean,false) then return false;end if;
 if e.snapshot->>'stale_after' is null or (e.snapshot->>'stale_after')::timestamptz<=p_now then return false;end if;
 if e.snapshot->>'source_id' is not null then
 select * into sp from public.source_permissions where id=e.snapshot->>'source_id';
 if sp.id is null or not sp.enabled or sp.status<>'approved' then return false;end if;
 if not sp.is_demo and not coalesce((select enabled from public.feature_flags where name='retailer_verification'),false) then return false;end if;
 end if;
 if e.listing_id is not null then
 select * into c from public.listing_current_state where listing_id=e.listing_id;
 select * into o from public.stock_observations where id=c.observation_id;
 if o.id is null or c.conflicted or o.stale_after<=p_now then return false;end if;
 if e.event_type in ('restock','new_listing') and o.availability_status<>'in_stock' then return false;end if;
 if r.definition->>'max_price_minor' is not null and (o.price_minor is null or o.currency is distinct from r.definition->>'currency' or o.price_minor>(r.definition->>'max_price_minor')::integer) then return false;end if;
 end if;return true;
end $$;
revoke all on function public.event_is_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.event_is_current(uuid,uuid,timestamptz) to service_role;
create function public.suppress_notification(p_user uuid,p_rule uuid,p_event uuid,p_channel text,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from public.alert_rules where id=p_rule and user_id=p_user) and exists(select 1 from public.stock_events where id=p_event) then
 insert into public.notification_suppressions(user_id,rule_id,event_id,channel,reason) values(p_user,p_rule,p_event,p_channel,p_reason) on conflict do nothing;end if;return null;end $$;
revoke all on function public.suppress_notification(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.suppress_notification(uuid,uuid,uuid,text,text) to service_role;
-- Durable inbox + outbox creation serialized per user. SQL independently enforces preferences/caps/dedup.
create function public.enqueue_notification(p_user uuid,p_rule uuid,p_event uuid,p_channel text,p_body jsonb,p_now timestamptz default now()) returns uuid language plpgsql security definer set search_path='' as $$
declare prefs public.user_preferences; rule public.alert_rules; ev public.stock_events; nid uuid; tz text; wall_time text; q jsonb; starttime text; endtime text; begin
 select * into prefs from public.user_preferences where user_id=p_user for update;
 select * into rule from public.alert_rules where id=p_rule and user_id=p_user for share;
 select * into ev from public.stock_events where id=p_event;
 if prefs.user_id is null or rule.id is null or ev.id is null or not prefs.in_app or not coalesce((rule.definition->>'enabled')::boolean,false) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'opt_in_or_rule_disabled'); end if;
 if p_channel='web_push' and (not prefs.web_push or not coalesce((select enabled from public.feature_flags where name='web_push'),false) or not (rule.definition->'delivery_channels' ? 'web_push')) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'push_disabled'); end if;
 if p_body ? 'rule_snapshot' and p_body->'rule_snapshot' is distinct from rule.definition then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'rule_changed');end if;
 if p_channel not in ('in_app','web_push') then raise exception 'VALIDATION_ERROR'; end if;
 select id into nid from public.notifications where user_id=p_user and rule_id=p_rule and event_id=p_event and channel=p_channel; if nid is not null then return nid; end if;
 if not public.event_is_current(p_event,p_rule,p_now) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'signal_no_longer_current');end if;
 if ev.snapshot->>'stale_after' is not null and (ev.snapshot->>'stale_after')::timestamptz<=p_now then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'stale'); end if;
 if ev.snapshot->>'source_id' is not null and not exists(select 1 from public.source_permissions where id=ev.snapshot->>'source_id' and status='approved' and enabled) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'source_disabled'); end if;
 if ev.listing_id is not null and exists(select 1 from public.listing_current_state where listing_id=ev.listing_id and conflicted) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'conflicting_evidence'); end if;
 -- Both account and rule quiet hours are respected, using PostgreSQL IANA/DST conversion.
 for q in select value from jsonb_array_elements(jsonb_build_array(prefs.quiet_hours,rule.definition->'quiet_hours')) loop
 if q is null or q='null'::jsonb then continue; end if;
 tz=coalesce(q->>'time_zone',prefs.time_zone); wall_time=to_char(p_now at time zone tz,'HH24:MI'); starttime=q->>'start'; endtime=q->>'end';
 if starttime=endtime or (starttime<endtime and wall_time>=starttime and wall_time<endtime) or (starttime>endtime and (wall_time>=starttime or wall_time<endtime)) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'quiet_hours'); end if;
 end loop;
 if (select count(distinct event_id) from public.notifications where user_id=p_user and created_at>=date_trunc('day',p_now at time zone prefs.time_zone) at time zone prefs.time_zone)>=prefs.daily_cap and not exists(select 1 from public.notifications where user_id=p_user and event_id=p_event) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'user_daily_cap'); end if;
 if (select count(distinct event_id) from public.notifications where user_id=p_user and rule_id=p_rule and created_at>=date_trunc('day',p_now at time zone prefs.time_zone) at time zone prefs.time_zone)>=(rule.definition->>'daily_cap')::integer and not exists(select 1 from public.notifications where user_id=p_user and rule_id=p_rule and event_id=p_event) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'rule_daily_cap'); end if;
 if exists(select 1 from public.notifications where user_id=p_user and rule_id=p_rule and event_id<>p_event and created_at>p_now-make_interval(mins=>(rule.definition->>'cooldown_minutes')::integer)) then return public.suppress_notification(p_user,p_rule,p_event,p_channel,'cooldown'); end if;
 insert into public.notifications(user_id,rule_id,event_id,channel,created_at,title,body,action_url,evidence_type,observed_at) values(p_user,p_rule,p_event,p_channel,p_now,left(p_body->>'title',160),left(p_body->>'body',1000),p_body->>'action_url',ev.snapshot->>'evidence_type',ev.occurred_at) returning id into nid;
 if p_channel='web_push' then insert into public.notification_deliveries(notification_id) values(nid); end if;
 return nid;
end $$;
-- Worker queue claims use leases and compare-and-swap completion tokens.
create function public.claim_alert() returns jsonb language plpgsql security definer set search_path='' as $$ declare j public.alert_match_jobs; begin
 select * into j from public.alert_match_jobs where status='pending' or (status='running' and lease_until<now()) order by event_id for update skip locked limit 1;
 if j.event_id is null then return null; end if;
 update public.alert_match_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where event_id=j.event_id returning * into j; return to_jsonb(j);
end $$;
create function public.claim_delivery() returns jsonb language plpgsql security definer set search_path='' as $$ declare j public.notification_deliveries; begin
 select * into j from public.notification_deliveries where (status in ('pending','failed') and available_at<=now() and attempts<5) or (status='attempted' and lease_until<now() and attempts<5) order by available_at,id for update skip locked limit 1;
 if j.id is null then return null; end if;
 update public.notification_deliveries set status='attempted',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=j.id returning * into j; return to_jsonb(j);
end $$;
create function public.claim_privacy() returns jsonb language plpgsql security definer set search_path='' as $$ declare j public.privacy_jobs; begin
 select * into j from public.privacy_jobs where status='pending' or (status='running' and lease_until<now()) order by created_at,id for update skip locked limit 1;
 if j.id is null then return null; end if;
 update public.privacy_jobs set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=j.id returning * into j; return to_jsonb(j);
end $$;

create function public.privacy_export(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; t text; rows jsonb; begin
 result=jsonb_build_object('version',1,'exported_at',now());
 foreach t in array array['profiles','user_preferences','watchlists','alert_rules','notifications','push_subscriptions','notification_suppressions'] loop
 execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from public.%I x where %I=$1',t,case when t='profiles' then 'id' else 'user_id' end) into rows using p_user;
 result=result||jsonb_build_object(t,rows);
 end loop; return result;
end $$;
revoke all on function public.schedule_checks(timestamptz) from public,anon,authenticated;
grant execute on function public.schedule_checks(timestamptz) to service_role;
revoke all on function public.claim_check(timestamptz) from public,anon,authenticated;
grant execute on function public.claim_check(timestamptz) to service_role;
revoke all on function public.finish_check(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.finish_check(uuid,uuid,jsonb,timestamptz) to service_role;
revoke all on function public.take_rate_limit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.take_rate_limit(text,text,integer,integer) to service_role;
revoke all on function public.account_write(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.account_write(text,uuid,jsonb) to authenticated,service_role;
revoke all on function public.admin_source(text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_source(text,jsonb) to authenticated,service_role;
revoke all on function public.admin_flag(text,boolean) from public,anon,authenticated;
grant execute on function public.admin_flag(text,boolean) to authenticated,service_role;
revoke all on function public.enqueue_notification(uuid,uuid,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_notification(uuid,uuid,uuid,text,jsonb,timestamptz) to service_role;
revoke all on function public.claim_alert() from public,anon,authenticated;
grant execute on function public.claim_alert() to service_role;
revoke all on function public.claim_delivery() from public,anon,authenticated;
grant execute on function public.claim_delivery() to service_role;
revoke all on function public.claim_privacy() from public,anon,authenticated;
grant execute on function public.claim_privacy() to service_role;
revoke all on function public.privacy_export(uuid) from public,anon,authenticated;
grant execute on function public.privacy_export(uuid) to service_role;
commit;
$pp_source_20261106020000$]);

-- SOURCE 20261106030000_cross_lane_and_retention.sql

create function public.publish_local_event(p_event jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid=(p_event->>'event_id')::uuid; snapshot jsonb; old jsonb; begin
 if p_event->>'event_type'<>'sighting_approved' or p_event->>'evidence_type'<>'moderated_report' or (p_event->>'payload_version')::integer<>1 or (p_event->>'occurred_at')::timestamptz>now() or (p_event->'payload'->>'expires_at')::timestamptz<=now() then raise exception 'VALIDATION_ERROR'; end if;
 snapshot=(p_event->'payload')||jsonb_build_object('evidence_type','moderated_report','channel','in_store_report','seller_type','unknown','region_code',p_event->>'region_code','stale_after',p_event->'payload'->>'expires_at');
 select stock_events.snapshot into old from public.stock_events where id=eid;
 if old is not null then if old<>snapshot then raise exception 'CONFLICT'; end if; return eid; end if;
 insert into public.stock_events(id,event_type,occurred_at,snapshot) values(eid,'local_sighting',(p_event->>'occurred_at')::timestamptz,snapshot);
 insert into public.alert_match_jobs(event_id) values(eid);return eid;
end $$;
create function public.privacy_participants_required() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(name),'[]'::jsonb) from (values ('radar','sightings'),('binder','real_inventory'),('packs','pack_openings'),('packs','coin_ledger')) as p(name,table_name) where to_regclass('public.'||table_name) is not null
$$;
create function public.purge_expired_private_data() returns void language plpgsql security definer set search_path='' as $$ begin
 update public.privacy_jobs set result=null where expires_at<=now() and result is not null;
 delete from public.rate_limits where bucket<now()-interval '1 day';
 delete from public.idempotency_keys where created_at<now()-interval '30 days';
 delete from public.audit_logs where created_at<now()-interval '90 days';
 delete from public.privacy_jobs where created_at<now()-interval '30 days' and status in ('completed','failed');
end $$;
revoke all on function public.publish_local_event(jsonb),public.privacy_participants_required(),public.purge_expired_private_data() from public,anon,authenticated;
grant execute on function public.publish_local_event(jsonb),public.privacy_participants_required(),public.purge_expired_private_data() to service_role;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261106030000','cross_lane_and_retention',array[$pp_source_20261106030000$begin;
create function public.publish_local_event(p_event jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid=(p_event->>'event_id')::uuid; snapshot jsonb; old jsonb; begin
 if p_event->>'event_type'<>'sighting_approved' or p_event->>'evidence_type'<>'moderated_report' or (p_event->>'payload_version')::integer<>1 or (p_event->>'occurred_at')::timestamptz>now() or (p_event->'payload'->>'expires_at')::timestamptz<=now() then raise exception 'VALIDATION_ERROR'; end if;
 snapshot=(p_event->'payload')||jsonb_build_object('evidence_type','moderated_report','channel','in_store_report','seller_type','unknown','region_code',p_event->>'region_code','stale_after',p_event->'payload'->>'expires_at');
 select stock_events.snapshot into old from public.stock_events where id=eid;
 if old is not null then if old<>snapshot then raise exception 'CONFLICT'; end if; return eid; end if;
 insert into public.stock_events(id,event_type,occurred_at,snapshot) values(eid,'local_sighting',(p_event->>'occurred_at')::timestamptz,snapshot);
 insert into public.alert_match_jobs(event_id) values(eid);return eid;
end $$;
create function public.privacy_participants_required() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(name),'[]'::jsonb) from (values ('radar','sightings'),('binder','real_inventory'),('packs','pack_openings'),('packs','coin_ledger')) as p(name,table_name) where to_regclass('public.'||table_name) is not null
$$;
create function public.purge_expired_private_data() returns void language plpgsql security definer set search_path='' as $$ begin
 update public.privacy_jobs set result=null where expires_at<=now() and result is not null;
 delete from public.rate_limits where bucket<now()-interval '1 day';
 delete from public.idempotency_keys where created_at<now()-interval '30 days';
 delete from public.audit_logs where created_at<now()-interval '90 days';
 delete from public.privacy_jobs where created_at<now()-interval '30 days' and status in ('completed','failed');
end $$;
revoke all on function public.publish_local_event(jsonb),public.privacy_participants_required(),public.purge_expired_private_data() from public,anon,authenticated;
grant execute on function public.publish_local_event(jsonb),public.privacy_participants_required(),public.purge_expired_private_data() to service_role;
commit;
$pp_source_20261106030000$]);

-- SOURCE 20261106040000_immutable_evidence.sql

create function public.reject_evidence_mutation() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'IMMUTABLE_EVIDENCE'; end $$;
create trigger immutable_observation before update or delete on public.stock_observations for each row execute function public.reject_evidence_mutation();
create trigger immutable_event before update or delete on public.stock_events for each row execute function public.reject_evidence_mutation();
revoke all on function public.reject_evidence_mutation() from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261106040000','immutable_evidence',array[$pp_source_20261106040000$begin;
create function public.reject_evidence_mutation() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'IMMUTABLE_EVIDENCE'; end $$;
create trigger immutable_observation before update or delete on public.stock_observations for each row execute function public.reject_evidence_mutation();
create trigger immutable_event before update or delete on public.stock_events for each row execute function public.reject_evidence_mutation();
revoke all on function public.reject_evidence_mutation() from public,anon,authenticated;
commit;
$pp_source_20261106040000$]);

-- SOURCE 20261106050000_indexes.sql

create index listings_product on public.listings(product_id);
create index observations_listing_time on public.stock_observations(listing_id,observed_at desc);
create index events_listing_time on public.stock_events(listing_id,occurred_at desc);
create index rules_user on public.alert_rules(user_id);
create index inbox_user_created on public.notifications(user_id,created_at desc);
create index inbox_rule_created on public.notifications(user_id,rule_id,created_at desc);
create index privacy_user on public.privacy_jobs(user_id);
create index push_user on public.push_subscriptions(user_id);

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261106050000','indexes',array[$pp_source_20261106050000$begin;
create index listings_product on public.listings(product_id);
create index observations_listing_time on public.stock_observations(listing_id,observed_at desc);
create index events_listing_time on public.stock_events(listing_id,occurred_at desc);
create index rules_user on public.alert_rules(user_id);
create index inbox_user_created on public.notifications(user_id,created_at desc);
create index inbox_rule_created on public.notifications(user_id,rule_id,created_at desc);
create index privacy_user on public.privacy_jobs(user_id);
create index push_user on public.push_subscriptions(user_id);
commit;
$pp_source_20261106050000$]);

-- SOURCE 20261106060000_health_and_delivery_dedup.sql

create function public.initialize_source_health() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.source_health(source_id) values(new.id) on conflict do nothing;return new;end $$;
create trigger source_health_created after insert on public.source_permissions for each row execute function public.initialize_source_health();
insert into public.source_health(source_id) select id from public.source_permissions on conflict do nothing;
-- At-most-once push attempt per subscription. A crash after reserve may lose a push;
-- inbox remains durable. Do not retry an ambiguous network send and create duplicates.
create table public.push_delivery_attempts(notification_id uuid not null references public.notifications on delete cascade, subscription_id uuid not null references public.push_subscriptions on delete cascade, status text not null default 'reserved' check(status in ('reserved','sent','failed','expired')), created_at timestamptz not null default now(),primary key(notification_id,subscription_id));
alter table public.push_delivery_attempts enable row level security;
revoke all on public.push_delivery_attempts from anon,authenticated;
grant all on public.push_delivery_attempts to service_role;
revoke all on function public.initialize_source_health() from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261106060000','health_and_delivery_dedup',array[$pp_source_20261106060000$begin;
create function public.initialize_source_health() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.source_health(source_id) values(new.id) on conflict do nothing;return new;end $$;
create trigger source_health_created after insert on public.source_permissions for each row execute function public.initialize_source_health();
insert into public.source_health(source_id) select id from public.source_permissions on conflict do nothing;
-- At-most-once push attempt per subscription. A crash after reserve may lose a push;
-- inbox remains durable. Do not retry an ambiguous network send and create duplicates.
create table public.push_delivery_attempts(notification_id uuid not null references public.notifications on delete cascade, subscription_id uuid not null references public.push_subscriptions on delete cascade, status text not null default 'reserved' check(status in ('reserved','sent','failed','expired')), created_at timestamptz not null default now(),primary key(notification_id,subscription_id));
alter table public.push_delivery_attempts enable row level security;
revoke all on public.push_delivery_attempts from anon,authenticated;
grant all on public.push_delivery_attempts to service_role;
revoke all on function public.initialize_source_health() from public,anon,authenticated;
commit;
$pp_source_20261106060000$]);

-- SOURCE 20261106070000_operator_metrics.sql

create function public.operator_metrics() returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb;begin
 if not public.is_staff() then raise exception 'FORBIDDEN';end if;
 select jsonb_build_object('queue_backlog',(select count(*) from public.source_check_jobs where status in ('pending','running')),'pending_mapping_reviews',(select count(*) from public.mapping_reviews where state='pending'),'push_failures',(select count(*) from public.notification_deliveries where status='failed'),'privacy_blocked',(select count(*) from public.privacy_jobs where status in ('failed','blocked')),'fresh',(select count(*) from public.listing_current_state c join public.stock_observations o on o.id=c.observation_id join public.source_permissions s on s.id=o.source_id where o.stale_after>now() and not c.conflicted and s.enabled and s.status='approved'),'stale',(select count(*) from public.listing_current_state c join public.stock_observations o on o.id=c.observation_id where o.stale_after<=now()),'p95_check_duration_ms',(select percentile_cont(0.95) within group(order by duration_ms) from public.source_check_jobs where duration_ms is not null)) into result;return result;
end $$;
revoke all on function public.operator_metrics() from public,anon;
grant execute on function public.operator_metrics() to authenticated;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261106070000','operator_metrics',array[$pp_source_20261106070000$begin;
create function public.operator_metrics() returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb;begin
 if not public.is_staff() then raise exception 'FORBIDDEN';end if;
 select jsonb_build_object('queue_backlog',(select count(*) from public.source_check_jobs where status in ('pending','running')),'pending_mapping_reviews',(select count(*) from public.mapping_reviews where state='pending'),'push_failures',(select count(*) from public.notification_deliveries where status='failed'),'privacy_blocked',(select count(*) from public.privacy_jobs where status in ('failed','blocked')),'fresh',(select count(*) from public.listing_current_state c join public.stock_observations o on o.id=c.observation_id join public.source_permissions s on s.id=o.source_id where o.stale_after>now() and not c.conflicted and s.enabled and s.status='approved'),'stale',(select count(*) from public.listing_current_state c join public.stock_observations o on o.id=c.observation_id where o.stale_after<=now()),'p95_check_duration_ms',(select percentile_cont(0.95) within group(order by duration_ms) from public.source_check_jobs where duration_ms is not null)) into result;return result;
end $$;
revoke all on function public.operator_metrics() from public,anon;
grant execute on function public.operator_metrics() to authenticated;
commit;
$pp_source_20261106070000$]);

-- SOURCE 20261107000000_b_packs.sql
-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned proposal, NOT a merged migration. Requires Supabase auth.users/auth.uid().
-- No dependency on unmerged A-owned tables. A's pack_lab gate must also be enforced
-- in the eventual route adapter. Internal DB gates default OFF; no seed is included.
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

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261107000000','b_packs',array[$pp_source_20261107000000$-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
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
$pp_source_20261107000000$]);

-- SOURCE 20261107010000_b_radar.sql
-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned draft. Supabase auth.uid()/auth.jwt()/auth.users are platform prerequisites.
-- Staff convention is proposed app_metadata.pokepulse_staff=true; reconcile with A.
-- product_id's A-owned FK/canonical-product validation remains an integration task.
create table public.b_radar_settings (
  singleton boolean primary key default true check(singleton), enabled boolean not null default false,
  allow_demo boolean not null default false,
  report_ttl_minutes integer not null default 240 check(report_ttl_minutes between 1 and 1440),
  cooldown_seconds integer not null default 300 check(cooldown_seconds between 1 and 86400),
  daily_report_cap integer not null default 10 check(daily_report_cap between 1 and 100)
);
insert into public.b_radar_settings(singleton) values(true);
create table public.stores (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 160),
  address text, region text, zip text check(zip~'^[0-9]{5}$'),
  latitude double precision check(latitude between -90 and 90),
  longitude double precision check(longitude between -180 and 180),
  directory_source text not null check(length(directory_source) between 1 and 160),
  rights_approved boolean not null default false, is_demo boolean not null default true,
  check((latitude is null)=(longitude is null))
);
create table public.b_zip_centroids (
  zip text primary key check(zip~'^[0-9]{5}$'), latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  source text not null, rights_approved boolean not null default false, is_demo boolean not null default true
);
create table public.sightings (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id), product_id uuid references public.products(id),
  report_type text not null check(report_type in ('found_stock','shelf_empty')),
  submitted_at timestamptz not null default now(), observed_at timestamptz not null, expires_at timestamptz not null,
  moderation text not null default 'pending' check(moderation in ('pending','approved','rejected','expired')),
  private_notes text not null default '' check(length(private_notes)<=280), public_notes text check(length(public_notes)<=280),
  is_demo boolean not null default true, revision integer not null default 0 check(revision>=0),
  idempotency_key uuid not null, request_body jsonb not null,
  unique(reporter_id,idempotency_key),check(expires_at>observed_at)
);
create index b_sighting_public_store on public.sightings(store_id,observed_at desc,id) where moderation='approved';
create index b_sighting_owner_submitted on public.sightings(reporter_id,submitted_at desc);
create table public.sighting_confirmations (
  sighting_id uuid not null references public.sightings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(),
  primary key(sighting_id,user_id)
);
create table public.sighting_moderation_actions (
  id uuid primary key default gen_random_uuid(), sighting_id uuid not null references public.sightings(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  previous_state text not null, next_state text not null, revision integer not null,
  reason text not null check(length(reason) between 1 and 500), created_at timestamptz not null default now(),
  idempotency_key uuid, request_body jsonb not null,
  unique(actor_id,idempotency_key), unique(sighting_id,revision)
);
create table public.b_sighting_outbox (
  id uuid primary key default gen_random_uuid(), sighting_id uuid not null references public.sightings(id) on delete cascade,
  revision integer not null, event_type text not null check(event_type in ('sighting_approved','sighting_withdrawn')),
  envelope jsonb not null, created_at timestamptz not null default now(), delivered_at timestamptz,
  unique(sighting_id,revision,event_type)
);

create function public.b_is_staff() returns boolean language sql stable set search_path=pg_catalog,public as $$
  select public.is_staff()
$$;
revoke all on function public.b_is_staff() from public,anon,authenticated;
grant execute on function public.b_is_staff() to authenticated,service_role;

alter table public.b_radar_settings enable row level security;
alter table public.stores enable row level security;
alter table public.b_zip_centroids enable row level security;
alter table public.sightings enable row level security;
alter table public.sighting_confirmations enable row level security;
alter table public.sighting_moderation_actions enable row level security;
alter table public.b_sighting_outbox enable row level security;
revoke all on public.b_radar_settings,public.stores,public.b_zip_centroids,public.sightings,
  public.sighting_confirmations,public.sighting_moderation_actions,public.b_sighting_outbox from public,anon,authenticated;
grant all on public.b_radar_settings,public.stores,public.b_zip_centroids,public.sightings,
  public.sighting_confirmations,public.sighting_moderation_actions,public.b_sighting_outbox to service_role;
grant select on public.sightings,public.sighting_confirmations,public.sighting_moderation_actions to authenticated;
create policy b_private_reports on public.sightings for select to authenticated using(
  reporter_id=(select auth.uid()) or (select public.b_is_staff()));
create policy b_private_confirmations on public.sighting_confirmations for select to authenticated using(user_id=(select auth.uid()));
create policy b_moderation_staff on public.sighting_moderation_actions for select to authenticated using((select public.b_is_staff()));

create function public.b_safe_report_notes(p_notes text) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
  select p_notes is not null and length(p_notes)<=280 and p_notes !~ '[<>[:cntrl:]]' and
    p_notes !~* '(https?://|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[+]?[0-9][0-9 ().-]{7,}[0-9])'
$$;
revoke all on function public.b_safe_report_notes(text) from public,anon,authenticated;

-- This is the sole public report projection. No author, private notes, request body,
-- staff IDs or location trails. Expiry is evaluated at every read, independent of cron.
create function public.b_public_sightings(p_store_id uuid,p_limit integer default 20,
  p_before_observed timestamptz default null,p_before_id uuid default null)
returns table(id uuid,store_id uuid,product_id uuid,report_type text,submitted_at timestamptz,
  observed_at timestamptz,expires_at timestamptz,moderation text,independent_confirmations bigint,
  conflict_count bigint,is_demo boolean,public_notes text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_settings public.b_radar_settings%rowtype;
begin
  if p_store_id is null or p_limit is null or p_limit<1 or p_limit>50 or
    ((p_before_observed is null)<>(p_before_id is null)) then raise exception 'VALIDATION_ERROR'; end if;
  select * into strict v_settings from public.b_radar_settings where singleton;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  return query select s.id,s.store_id,s.product_id,s.report_type,s.submitted_at,s.observed_at,s.expires_at,s.moderation,
    (select count(distinct c.user_id) from public.sighting_confirmations c where c.sighting_id=s.id and c.user_id<>s.reporter_id),
    (select count(distinct other.reporter_id) from public.sightings other
      where other.store_id=s.store_id and other.product_id is not distinct from s.product_id and
      other.report_type<>s.report_type and other.reporter_id<>s.reporter_id and other.moderation='approved' and
      other.expires_at>statement_timestamp() and other.observed_at<=statement_timestamp() and (not other.is_demo or v_settings.allow_demo)),
    s.is_demo,s.public_notes from public.sightings s join public.stores st on st.id=s.store_id
    where s.store_id=p_store_id and s.moderation='approved' and s.expires_at>statement_timestamp() and s.observed_at<=statement_timestamp() and
      (not s.is_demo or v_settings.allow_demo) and st.rights_approved and (not st.is_demo or v_settings.allow_demo) and
      (p_before_observed is null or s.observed_at<p_before_observed or (s.observed_at=p_before_observed and s.id>p_before_id))
    order by s.observed_at desc,s.id limit p_limit;
end $$;
revoke all on function public.b_public_sightings(uuid,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.b_public_sightings(uuid,integer,timestamptz,uuid) to anon,authenticated,service_role;

create function public.b_submit_sighting(p_store_id uuid,p_product_id uuid,p_report_type text,
  p_observed_at timestamptz,p_notes text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_settings public.b_radar_settings%rowtype; v_store public.stores%rowtype;
  v_prior public.sightings%rowtype; v_body jsonb; v_id uuid:=gen_random_uuid(); v_now timestamptz:=transaction_timestamp();
begin
  if v_user is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_store_id is null or p_idempotency_key is null or p_report_type is null or p_report_type not in ('found_stock','shelf_empty') or
    p_observed_at is null or not public.b_safe_report_notes(p_notes) then raise exception 'VALIDATION_ERROR'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-sighting:'||v_user::text,0));
  v_body:=jsonb_build_object('store_id',p_store_id,'product_id',p_product_id,'report_type',p_report_type,
    'observed_at',to_char(p_observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'notes',btrim(p_notes));
  select * into v_prior from public.sightings where reporter_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_body<>v_body then raise exception 'CONFLICT'; end if;
    return jsonb_build_object('id',v_prior.id,'moderation',v_prior.moderation,'submitted_at',
      to_char(v_prior.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end if;
  if p_observed_at>v_now or p_observed_at<v_now-interval '24 hours' then raise exception 'VALIDATION_ERROR'; end if;
  perform public.b_assert_account_writable();
  select * into strict v_settings from public.b_radar_settings where singleton for share;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into v_store from public.stores where id=p_store_id for share;
  if not found or not v_store.rights_approved or (v_store.is_demo and not v_settings.allow_demo) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  if exists(select 1 from public.sightings where reporter_id=v_user and
      submitted_at>v_now-make_interval(secs=>v_settings.cooldown_seconds)) or
     (select count(*) from public.sightings where reporter_id=v_user and
       submitted_at>=((v_now at time zone 'UTC')::date::timestamp at time zone 'UTC'))>=v_settings.daily_report_cap
    then raise exception 'RATE_LIMITED'; end if;
  if exists(select 1 from public.sightings where reporter_id=v_user and store_id=p_store_id and
    product_id is not distinct from p_product_id and moderation<>'rejected' and expires_at>v_now) then raise exception 'CONFLICT'; end if;
  insert into public.sightings(id,reporter_id,store_id,product_id,report_type,submitted_at,observed_at,expires_at,
    private_notes,is_demo,idempotency_key,request_body)
    values(v_id,v_user,p_store_id,p_product_id,p_report_type,v_now,p_observed_at,
      p_observed_at+make_interval(mins=>v_settings.report_ttl_minutes),btrim(p_notes),v_store.is_demo,p_idempotency_key,v_body);
  return jsonb_build_object('id',v_id,'moderation','pending','submitted_at',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;
revoke all on function public.b_submit_sighting(uuid,uuid,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.b_submit_sighting(uuid,uuid,text,timestamptz,text,uuid) to authenticated;

create function public.b_moderate_sighting(p_sighting_id uuid,p_decision text,p_reason text,
  p_public_notes text,p_idempotency_key uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid(); v_report public.sightings%rowtype; v_prior public.sighting_moderation_actions%rowtype;
  v_body jsonb; v_revision integer; v_event_id uuid; v_event_type text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN'; end if;
  if p_sighting_id is null or p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0 or p_decision is null or p_decision not in ('approved','rejected') or
    p_reason is null or length(btrim(p_reason)) not between 1 and 500 or
    (p_public_notes is not null and not public.b_safe_report_notes(p_public_notes)) then raise exception 'VALIDATION_ERROR'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-moderator:'||v_actor::text,0));
  v_body:=jsonb_build_object('sighting_id',p_sighting_id,'decision',p_decision,'reason',btrim(p_reason),'public_notes',p_public_notes,'expected_revision',p_expected_revision);
  select * into v_prior from public.sighting_moderation_actions where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_body<>v_body then raise exception 'CONFLICT'; end if;
    return jsonb_build_object('id',v_prior.sighting_id,'moderation',v_prior.next_state,'revision',v_prior.revision);
  end if;
  perform public.b_assert_account_writable();
  select * into v_report from public.sightings where id=p_sighting_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_report.reporter_id=v_actor then raise exception 'FORBIDDEN'; end if;
  if v_report.revision<>p_expected_revision then raise exception 'CONFLICT';end if;
  if v_report.moderation=p_decision or v_report.moderation='expired' or
    (p_decision='approved' and v_report.expires_at<=clock_timestamp()) then raise exception 'CONFLICT'; end if;
  v_revision:=v_report.revision+1;
  update public.sightings set moderation=p_decision,revision=v_revision,
    public_notes=case when p_decision='approved' then nullif(btrim(p_public_notes),'') else null end where id=p_sighting_id;
  insert into public.sighting_moderation_actions(sighting_id,actor_id,previous_state,next_state,revision,reason,idempotency_key,request_body)
    values(p_sighting_id,v_actor,v_report.moderation,p_decision,v_revision,btrim(p_reason),p_idempotency_key,v_body);
  if p_decision='approved' or v_report.moderation='approved' then
    v_event_id:=gen_random_uuid();
    v_event_type:=case when p_decision='approved' then 'sighting_approved' else 'sighting_withdrawn' end;
    insert into public.b_sighting_outbox(id,sighting_id,revision,event_type,envelope) values(v_event_id,p_sighting_id,v_revision,v_event_type,
      jsonb_build_object('version',1,'type',v_event_type,'event_id',v_event_id,'sighting_id',p_sighting_id,
        'revision',v_revision,'store_id',v_report.store_id,'product_id',v_report.product_id,'report_type',v_report.report_type,
        'evidence_type','moderated_report','observed_at',to_char(v_report.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'expires_at',to_char(v_report.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'is_demo',v_report.is_demo));
  end if;
  return jsonb_build_object('id',p_sighting_id,'moderation',p_decision,'revision',v_revision);
end $$;
revoke all on function public.b_moderate_sighting(uuid,text,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.b_moderate_sighting(uuid,text,text,text,uuid,integer) to authenticated;

create function public.b_confirm_sighting(p_sighting_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_report public.sightings%rowtype; v_settings public.b_radar_settings%rowtype;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-sighting:'||v_user::text,0));
  perform public.b_assert_account_writable();
  select * into strict v_settings from public.b_radar_settings where singleton for share;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into v_report from public.sightings where id=p_sighting_id for share;
  if not found or v_report.moderation<>'approved' or v_report.expires_at<=clock_timestamp() or
    (v_report.is_demo and not v_settings.allow_demo) then raise exception 'NOT_FOUND'; end if;
  if not exists(select 1 from public.stores where id=v_report.store_id and rights_approved and
    (not is_demo or v_settings.allow_demo)) then raise exception 'NOT_FOUND'; end if;
  if v_report.reporter_id=v_user then raise exception 'FORBIDDEN'; end if;
  insert into public.sighting_confirmations(sighting_id,user_id) values(p_sighting_id,v_user) on conflict do nothing;
end $$;
revoke all on function public.b_confirm_sighting(uuid) from public,anon,authenticated;
grant execute on function public.b_confirm_sighting(uuid) to authenticated;

-- A's worker must recheck this signal before matching AND before sending. Never
-- infer fresh stock solely from a previously queued approval envelope.
create function public.b_current_sighting_signal(p_sighting_id uuid,p_revision integer) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.sightings s join public.b_radar_settings cfg on cfg.singleton
    join public.stores st on st.id=s.store_id
    where s.id=p_sighting_id and s.revision=p_revision and s.moderation='approved' and s.expires_at>statement_timestamp() and
      s.observed_at<=statement_timestamp() and cfg.enabled and exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) and st.rights_approved and
      (not s.is_demo or cfg.allow_demo) and (not st.is_demo or cfg.allow_demo))
$$;
revoke all on function public.b_current_sighting_signal(uuid,integer) from public,anon,authenticated;
grant execute on function public.b_current_sighting_signal(uuid,integer) to service_role;

create function public.b_expire_sightings(p_limit integer default 100) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_report public.sightings%rowtype; v_id uuid; v_count integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'VALIDATION_ERROR'; end if;
  for v_report in select * from public.sightings where moderation in ('pending','approved') and expires_at<=now()
    order by expires_at,id limit p_limit for update skip locked loop
    update public.sightings set moderation='expired',public_notes=null,revision=revision+1 where id=v_report.id;
    insert into public.sighting_moderation_actions(sighting_id,previous_state,next_state,revision,reason,request_body)
      values(v_report.id,v_report.moderation,'expired',v_report.revision+1,'Configured report expiry','{}');
    if v_report.moderation='approved' then
      v_id:=gen_random_uuid();
      insert into public.b_sighting_outbox(id,sighting_id,revision,event_type,envelope)
        values(v_id,v_report.id,v_report.revision+1,'sighting_withdrawn',jsonb_build_object(
          'version',1,'type','sighting_withdrawn','event_id',v_id,'sighting_id',v_report.id,'revision',v_report.revision+1,
          'evidence_type','moderated_report','expires_at',to_char(v_report.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'is_demo',v_report.is_demo));
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.b_expire_sightings(integer) from public,anon,authenticated;
grant execute on function public.b_expire_sightings(integer) to service_role;

create function public.b_nearby_stores(p_zip text,p_radius_mi integer,p_limit integer default 20,
  p_after_distance_milli integer default null,p_after_id uuid default null)
returns table(id uuid,name text,address text,region text,zip text,distance_mi numeric,
  latitude double precision,longitude double precision,directory_source text,is_demo boolean)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_settings public.b_radar_settings%rowtype; v_centroid public.b_zip_centroids%rowtype;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' or p_radius_mi is null or p_radius_mi<1 or p_radius_mi>100 or
    p_limit is null or p_limit<1 or p_limit>50 or ((p_after_distance_milli is null)<>(p_after_id is null)) or
    p_after_distance_milli<0 then raise exception 'VALIDATION_ERROR'; end if;
  select * into strict v_settings from public.b_radar_settings where singleton;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into v_centroid from public.b_zip_centroids z where z.zip=p_zip and z.rights_approved and
    (not z.is_demo or v_settings.allow_demo);
  if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
  return query with measured as (
    select st.*,3958.7613*acos(least(1.0,greatest(-1.0,
      sin(radians(v_centroid.latitude))*sin(radians(st.latitude))+
      cos(radians(v_centroid.latitude))*cos(radians(st.latitude))*cos(radians(st.longitude-v_centroid.longitude))))) miles
    from public.stores st where st.rights_approved and (not st.is_demo or v_settings.allow_demo) and st.latitude is not null
  ), located as (select measured.*,round((miles*1000)::numeric)::integer distance_milli from measured where miles<=p_radius_mi)
  select located.id,located.name,located.address,located.region,located.zip,located.distance_milli::numeric/1000,
    located.latitude,located.longitude,located.directory_source,located.is_demo from located
    where p_after_distance_milli is null or located.distance_milli>p_after_distance_milli or
      (located.distance_milli=p_after_distance_milli and located.id>p_after_id)
    order by located.distance_milli,located.id limit p_limit;
end $$;
revoke all on function public.b_nearby_stores(text,integer,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.b_nearby_stores(text,integer,integer,integer,uuid) to anon,authenticated,service_role;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261107010000','b_radar',array[$pp_source_20261107010000$-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned draft. Supabase auth.uid()/auth.jwt()/auth.users are platform prerequisites.
-- Staff convention is proposed app_metadata.pokepulse_staff=true; reconcile with A.
-- product_id's A-owned FK/canonical-product validation remains an integration task.
begin;
create table public.b_radar_settings (
  singleton boolean primary key default true check(singleton), enabled boolean not null default false,
  allow_demo boolean not null default false,
  report_ttl_minutes integer not null default 240 check(report_ttl_minutes between 1 and 1440),
  cooldown_seconds integer not null default 300 check(cooldown_seconds between 1 and 86400),
  daily_report_cap integer not null default 10 check(daily_report_cap between 1 and 100)
);
insert into public.b_radar_settings(singleton) values(true);
create table public.stores (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 160),
  address text, region text, zip text check(zip~'^[0-9]{5}$'),
  latitude double precision check(latitude between -90 and 90),
  longitude double precision check(longitude between -180 and 180),
  directory_source text not null check(length(directory_source) between 1 and 160),
  rights_approved boolean not null default false, is_demo boolean not null default true,
  check((latitude is null)=(longitude is null))
);
create table public.b_zip_centroids (
  zip text primary key check(zip~'^[0-9]{5}$'), latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  source text not null, rights_approved boolean not null default false, is_demo boolean not null default true
);
create table public.sightings (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id), product_id uuid references public.products(id),
  report_type text not null check(report_type in ('found_stock','shelf_empty')),
  submitted_at timestamptz not null default now(), observed_at timestamptz not null, expires_at timestamptz not null,
  moderation text not null default 'pending' check(moderation in ('pending','approved','rejected','expired')),
  private_notes text not null default '' check(length(private_notes)<=280), public_notes text check(length(public_notes)<=280),
  is_demo boolean not null default true, revision integer not null default 0 check(revision>=0),
  idempotency_key uuid not null, request_body jsonb not null,
  unique(reporter_id,idempotency_key),check(expires_at>observed_at)
);
create index b_sighting_public_store on public.sightings(store_id,observed_at desc,id) where moderation='approved';
create index b_sighting_owner_submitted on public.sightings(reporter_id,submitted_at desc);
create table public.sighting_confirmations (
  sighting_id uuid not null references public.sightings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(),
  primary key(sighting_id,user_id)
);
create table public.sighting_moderation_actions (
  id uuid primary key default gen_random_uuid(), sighting_id uuid not null references public.sightings(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  previous_state text not null, next_state text not null, revision integer not null,
  reason text not null check(length(reason) between 1 and 500), created_at timestamptz not null default now(),
  idempotency_key uuid, request_body jsonb not null,
  unique(actor_id,idempotency_key), unique(sighting_id,revision)
);
create table public.b_sighting_outbox (
  id uuid primary key default gen_random_uuid(), sighting_id uuid not null references public.sightings(id) on delete cascade,
  revision integer not null, event_type text not null check(event_type in ('sighting_approved','sighting_withdrawn')),
  envelope jsonb not null, created_at timestamptz not null default now(), delivered_at timestamptz,
  unique(sighting_id,revision,event_type)
);

create function public.b_is_staff() returns boolean language sql stable set search_path=pg_catalog,public as $$
  select public.is_staff()
$$;
revoke all on function public.b_is_staff() from public,anon,authenticated;
grant execute on function public.b_is_staff() to authenticated,service_role;

alter table public.b_radar_settings enable row level security;
alter table public.stores enable row level security;
alter table public.b_zip_centroids enable row level security;
alter table public.sightings enable row level security;
alter table public.sighting_confirmations enable row level security;
alter table public.sighting_moderation_actions enable row level security;
alter table public.b_sighting_outbox enable row level security;
revoke all on public.b_radar_settings,public.stores,public.b_zip_centroids,public.sightings,
  public.sighting_confirmations,public.sighting_moderation_actions,public.b_sighting_outbox from public,anon,authenticated;
grant all on public.b_radar_settings,public.stores,public.b_zip_centroids,public.sightings,
  public.sighting_confirmations,public.sighting_moderation_actions,public.b_sighting_outbox to service_role;
grant select on public.sightings,public.sighting_confirmations,public.sighting_moderation_actions to authenticated;
create policy b_private_reports on public.sightings for select to authenticated using(
  reporter_id=(select auth.uid()) or (select public.b_is_staff()));
create policy b_private_confirmations on public.sighting_confirmations for select to authenticated using(user_id=(select auth.uid()));
create policy b_moderation_staff on public.sighting_moderation_actions for select to authenticated using((select public.b_is_staff()));

create function public.b_safe_report_notes(p_notes text) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
  select p_notes is not null and length(p_notes)<=280 and p_notes !~ '[<>[:cntrl:]]' and
    p_notes !~* '(https?://|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[+]?[0-9][0-9 ().-]{7,}[0-9])'
$$;
revoke all on function public.b_safe_report_notes(text) from public,anon,authenticated;

-- This is the sole public report projection. No author, private notes, request body,
-- staff IDs or location trails. Expiry is evaluated at every read, independent of cron.
create function public.b_public_sightings(p_store_id uuid,p_limit integer default 20,
  p_before_observed timestamptz default null,p_before_id uuid default null)
returns table(id uuid,store_id uuid,product_id uuid,report_type text,submitted_at timestamptz,
  observed_at timestamptz,expires_at timestamptz,moderation text,independent_confirmations bigint,
  conflict_count bigint,is_demo boolean,public_notes text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_settings public.b_radar_settings%rowtype;
begin
  if p_store_id is null or p_limit is null or p_limit<1 or p_limit>50 or
    ((p_before_observed is null)<>(p_before_id is null)) then raise exception 'VALIDATION_ERROR'; end if;
  select * into strict v_settings from public.b_radar_settings where singleton;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  return query select s.id,s.store_id,s.product_id,s.report_type,s.submitted_at,s.observed_at,s.expires_at,s.moderation,
    (select count(distinct c.user_id) from public.sighting_confirmations c where c.sighting_id=s.id and c.user_id<>s.reporter_id),
    (select count(distinct other.reporter_id) from public.sightings other
      where other.store_id=s.store_id and other.product_id is not distinct from s.product_id and
      other.report_type<>s.report_type and other.reporter_id<>s.reporter_id and other.moderation='approved' and
      other.expires_at>statement_timestamp() and other.observed_at<=statement_timestamp() and (not other.is_demo or v_settings.allow_demo)),
    s.is_demo,s.public_notes from public.sightings s join public.stores st on st.id=s.store_id
    where s.store_id=p_store_id and s.moderation='approved' and s.expires_at>statement_timestamp() and s.observed_at<=statement_timestamp() and
      (not s.is_demo or v_settings.allow_demo) and st.rights_approved and (not st.is_demo or v_settings.allow_demo) and
      (p_before_observed is null or s.observed_at<p_before_observed or (s.observed_at=p_before_observed and s.id>p_before_id))
    order by s.observed_at desc,s.id limit p_limit;
end $$;
revoke all on function public.b_public_sightings(uuid,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.b_public_sightings(uuid,integer,timestamptz,uuid) to anon,authenticated,service_role;

create function public.b_submit_sighting(p_store_id uuid,p_product_id uuid,p_report_type text,
  p_observed_at timestamptz,p_notes text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_settings public.b_radar_settings%rowtype; v_store public.stores%rowtype;
  v_prior public.sightings%rowtype; v_body jsonb; v_id uuid:=gen_random_uuid(); v_now timestamptz:=transaction_timestamp();
begin
  if v_user is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_store_id is null or p_idempotency_key is null or p_report_type is null or p_report_type not in ('found_stock','shelf_empty') or
    p_observed_at is null or not public.b_safe_report_notes(p_notes) then raise exception 'VALIDATION_ERROR'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-sighting:'||v_user::text,0));
  v_body:=jsonb_build_object('store_id',p_store_id,'product_id',p_product_id,'report_type',p_report_type,
    'observed_at',to_char(p_observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'notes',btrim(p_notes));
  select * into v_prior from public.sightings where reporter_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_body<>v_body then raise exception 'CONFLICT'; end if;
    return jsonb_build_object('id',v_prior.id,'moderation',v_prior.moderation,'submitted_at',
      to_char(v_prior.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end if;
  if p_observed_at>v_now or p_observed_at<v_now-interval '24 hours' then raise exception 'VALIDATION_ERROR'; end if;
  perform public.b_assert_account_writable();
  select * into strict v_settings from public.b_radar_settings where singleton for share;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into v_store from public.stores where id=p_store_id for share;
  if not found or not v_store.rights_approved or (v_store.is_demo and not v_settings.allow_demo) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  if exists(select 1 from public.sightings where reporter_id=v_user and
      submitted_at>v_now-make_interval(secs=>v_settings.cooldown_seconds)) or
     (select count(*) from public.sightings where reporter_id=v_user and
       submitted_at>=((v_now at time zone 'UTC')::date::timestamp at time zone 'UTC'))>=v_settings.daily_report_cap
    then raise exception 'RATE_LIMITED'; end if;
  if exists(select 1 from public.sightings where reporter_id=v_user and store_id=p_store_id and
    product_id is not distinct from p_product_id and moderation<>'rejected' and expires_at>v_now) then raise exception 'CONFLICT'; end if;
  insert into public.sightings(id,reporter_id,store_id,product_id,report_type,submitted_at,observed_at,expires_at,
    private_notes,is_demo,idempotency_key,request_body)
    values(v_id,v_user,p_store_id,p_product_id,p_report_type,v_now,p_observed_at,
      p_observed_at+make_interval(mins=>v_settings.report_ttl_minutes),btrim(p_notes),v_store.is_demo,p_idempotency_key,v_body);
  return jsonb_build_object('id',v_id,'moderation','pending','submitted_at',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;
revoke all on function public.b_submit_sighting(uuid,uuid,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.b_submit_sighting(uuid,uuid,text,timestamptz,text,uuid) to authenticated;

create function public.b_moderate_sighting(p_sighting_id uuid,p_decision text,p_reason text,
  p_public_notes text,p_idempotency_key uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid(); v_report public.sightings%rowtype; v_prior public.sighting_moderation_actions%rowtype;
  v_body jsonb; v_revision integer; v_event_id uuid; v_event_type text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN'; end if;
  if p_sighting_id is null or p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0 or p_decision is null or p_decision not in ('approved','rejected') or
    p_reason is null or length(btrim(p_reason)) not between 1 and 500 or
    (p_public_notes is not null and not public.b_safe_report_notes(p_public_notes)) then raise exception 'VALIDATION_ERROR'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-moderator:'||v_actor::text,0));
  v_body:=jsonb_build_object('sighting_id',p_sighting_id,'decision',p_decision,'reason',btrim(p_reason),'public_notes',p_public_notes,'expected_revision',p_expected_revision);
  select * into v_prior from public.sighting_moderation_actions where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_body<>v_body then raise exception 'CONFLICT'; end if;
    return jsonb_build_object('id',v_prior.sighting_id,'moderation',v_prior.next_state,'revision',v_prior.revision);
  end if;
  perform public.b_assert_account_writable();
  select * into v_report from public.sightings where id=p_sighting_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_report.reporter_id=v_actor then raise exception 'FORBIDDEN'; end if;
  if v_report.revision<>p_expected_revision then raise exception 'CONFLICT';end if;
  if v_report.moderation=p_decision or v_report.moderation='expired' or
    (p_decision='approved' and v_report.expires_at<=clock_timestamp()) then raise exception 'CONFLICT'; end if;
  v_revision:=v_report.revision+1;
  update public.sightings set moderation=p_decision,revision=v_revision,
    public_notes=case when p_decision='approved' then nullif(btrim(p_public_notes),'') else null end where id=p_sighting_id;
  insert into public.sighting_moderation_actions(sighting_id,actor_id,previous_state,next_state,revision,reason,idempotency_key,request_body)
    values(p_sighting_id,v_actor,v_report.moderation,p_decision,v_revision,btrim(p_reason),p_idempotency_key,v_body);
  if p_decision='approved' or v_report.moderation='approved' then
    v_event_id:=gen_random_uuid();
    v_event_type:=case when p_decision='approved' then 'sighting_approved' else 'sighting_withdrawn' end;
    insert into public.b_sighting_outbox(id,sighting_id,revision,event_type,envelope) values(v_event_id,p_sighting_id,v_revision,v_event_type,
      jsonb_build_object('version',1,'type',v_event_type,'event_id',v_event_id,'sighting_id',p_sighting_id,
        'revision',v_revision,'store_id',v_report.store_id,'product_id',v_report.product_id,'report_type',v_report.report_type,
        'evidence_type','moderated_report','observed_at',to_char(v_report.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'expires_at',to_char(v_report.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'is_demo',v_report.is_demo));
  end if;
  return jsonb_build_object('id',p_sighting_id,'moderation',p_decision,'revision',v_revision);
end $$;
revoke all on function public.b_moderate_sighting(uuid,text,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.b_moderate_sighting(uuid,text,text,text,uuid,integer) to authenticated;

create function public.b_confirm_sighting(p_sighting_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_report public.sightings%rowtype; v_settings public.b_radar_settings%rowtype;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-sighting:'||v_user::text,0));
  perform public.b_assert_account_writable();
  select * into strict v_settings from public.b_radar_settings where singleton for share;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into v_report from public.sightings where id=p_sighting_id for share;
  if not found or v_report.moderation<>'approved' or v_report.expires_at<=clock_timestamp() or
    (v_report.is_demo and not v_settings.allow_demo) then raise exception 'NOT_FOUND'; end if;
  if not exists(select 1 from public.stores where id=v_report.store_id and rights_approved and
    (not is_demo or v_settings.allow_demo)) then raise exception 'NOT_FOUND'; end if;
  if v_report.reporter_id=v_user then raise exception 'FORBIDDEN'; end if;
  insert into public.sighting_confirmations(sighting_id,user_id) values(p_sighting_id,v_user) on conflict do nothing;
end $$;
revoke all on function public.b_confirm_sighting(uuid) from public,anon,authenticated;
grant execute on function public.b_confirm_sighting(uuid) to authenticated;

-- A's worker must recheck this signal before matching AND before sending. Never
-- infer fresh stock solely from a previously queued approval envelope.
create function public.b_current_sighting_signal(p_sighting_id uuid,p_revision integer) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.sightings s join public.b_radar_settings cfg on cfg.singleton
    join public.stores st on st.id=s.store_id
    where s.id=p_sighting_id and s.revision=p_revision and s.moderation='approved' and s.expires_at>statement_timestamp() and
      s.observed_at<=statement_timestamp() and cfg.enabled and exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) and st.rights_approved and
      (not s.is_demo or cfg.allow_demo) and (not st.is_demo or cfg.allow_demo))
$$;
revoke all on function public.b_current_sighting_signal(uuid,integer) from public,anon,authenticated;
grant execute on function public.b_current_sighting_signal(uuid,integer) to service_role;

create function public.b_expire_sightings(p_limit integer default 100) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_report public.sightings%rowtype; v_id uuid; v_count integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'VALIDATION_ERROR'; end if;
  for v_report in select * from public.sightings where moderation in ('pending','approved') and expires_at<=now()
    order by expires_at,id limit p_limit for update skip locked loop
    update public.sightings set moderation='expired',public_notes=null,revision=revision+1 where id=v_report.id;
    insert into public.sighting_moderation_actions(sighting_id,previous_state,next_state,revision,reason,request_body)
      values(v_report.id,v_report.moderation,'expired',v_report.revision+1,'Configured report expiry','{}');
    if v_report.moderation='approved' then
      v_id:=gen_random_uuid();
      insert into public.b_sighting_outbox(id,sighting_id,revision,event_type,envelope)
        values(v_id,v_report.id,v_report.revision+1,'sighting_withdrawn',jsonb_build_object(
          'version',1,'type','sighting_withdrawn','event_id',v_id,'sighting_id',v_report.id,'revision',v_report.revision+1,
          'evidence_type','moderated_report','expires_at',to_char(v_report.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'is_demo',v_report.is_demo));
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.b_expire_sightings(integer) from public,anon,authenticated;
grant execute on function public.b_expire_sightings(integer) to service_role;

create function public.b_nearby_stores(p_zip text,p_radius_mi integer,p_limit integer default 20,
  p_after_distance_milli integer default null,p_after_id uuid default null)
returns table(id uuid,name text,address text,region text,zip text,distance_mi numeric,
  latitude double precision,longitude double precision,directory_source text,is_demo boolean)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_settings public.b_radar_settings%rowtype; v_centroid public.b_zip_centroids%rowtype;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' or p_radius_mi is null or p_radius_mi<1 or p_radius_mi>100 or
    p_limit is null or p_limit<1 or p_limit>50 or ((p_after_distance_milli is null)<>(p_after_id is null)) or
    p_after_distance_milli<0 then raise exception 'VALIDATION_ERROR'; end if;
  select * into strict v_settings from public.b_radar_settings where singleton;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into v_centroid from public.b_zip_centroids z where z.zip=p_zip and z.rights_approved and
    (not z.is_demo or v_settings.allow_demo);
  if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
  return query with measured as (
    select st.*,3958.7613*acos(least(1.0,greatest(-1.0,
      sin(radians(v_centroid.latitude))*sin(radians(st.latitude))+
      cos(radians(v_centroid.latitude))*cos(radians(st.latitude))*cos(radians(st.longitude-v_centroid.longitude))))) miles
    from public.stores st where st.rights_approved and (not st.is_demo or v_settings.allow_demo) and st.latitude is not null
  ), located as (select measured.*,round((miles*1000)::numeric)::integer distance_milli from measured where miles<=p_radius_mi)
  select located.id,located.name,located.address,located.region,located.zip,located.distance_milli::numeric/1000,
    located.latitude,located.longitude,located.directory_source,located.is_demo from located
    where p_after_distance_milli is null or located.distance_milli>p_after_distance_milli or
      (located.distance_milli=p_after_distance_milli and located.id>p_after_id)
    order by located.distance_milli,located.id limit p_limit;
end $$;
revoke all on function public.b_nearby_stores(text,integer,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.b_nearby_stores(text,integer,integer,integer,uuid) to anon,authenticated,service_role;
commit;
$pp_source_20261107010000$]);

-- SOURCE 20261107020000_b_calendar.sql
-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned draft, requires the Radar proposal's trusted b_is_staff() helper.
-- Nullable unknown dates and demo provenance require the shared contract review.
-- No fabricated release seed data and no external fetches are included.
create table public.b_calendar_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,allow_demo boolean not null default false
);
insert into public.b_calendar_settings(singleton) values(true);
create table public.b_release_source_hosts (
  host text primary key check(host=lower(host) and host~'^[a-z0-9][a-z0-9.-]*[a-z0-9]$' and position('..' in host)=0),
  approved boolean not null default false, permission_notes text not null check(length(permission_notes) between 1 and 1000)
);
create table public.releases (
  id uuid primary key default gen_random_uuid(),product_id uuid references public.products(id),
  name text not null check(length(name) between 1 and 160),
  release_date date,date_precision text not null check(date_precision in ('day','month','unconfirmed')),
  event_type text not null check(event_type in ('release','preorder','announcement')),
  region text check(length(region) between 1 and 32),source_url text not null check(length(source_url)<=2048),
  source_host text not null references public.b_release_source_hosts(host),verified_at timestamptz not null,
  is_demo boolean not null default true,status text not null default 'published' check(status in ('published','withdrawn')),
  revision integer not null check(revision>0),updated_at timestamptz not null default now(),
  check((date_precision='unconfirmed' and release_date is null) or
    (date_precision='day' and release_date is not null) or
    (date_precision='month' and release_date is not null and extract(day from release_date)=1))
);
create index b_release_calendar_order on public.releases(release_date asc nulls last,id) where status='published';
create table public.release_edit_history (
  id uuid primary key default gen_random_uuid(),release_id uuid not null references public.releases(id),
  actor_id uuid references auth.users(id) on delete set null,
  revision integer not null,previous_record jsonb,next_record jsonb not null,reason text not null check(length(reason) between 1 and 500),
  idempotency_key uuid not null,request_body jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key),unique(release_id,revision)
);
alter table public.b_calendar_settings enable row level security;
alter table public.b_release_source_hosts enable row level security;
alter table public.releases enable row level security;
alter table public.release_edit_history enable row level security;
revoke all on public.b_calendar_settings,public.b_release_source_hosts,public.releases,public.release_edit_history from public,anon,authenticated;
grant all on public.b_calendar_settings,public.b_release_source_hosts,public.releases,public.release_edit_history to service_role;
grant select on public.release_edit_history to authenticated;
create policy b_release_history_staff on public.release_edit_history for select to authenticated using((select public.b_is_staff()));

create function public.b_release_projection(p_record public.releases) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',p_record.id,'product_id',p_record.product_id,'name',p_record.name,
    'date',to_char(p_record.release_date,'YYYY-MM-DD'),'date_precision',p_record.date_precision,
    'event_type',p_record.event_type,'region',p_record.region,'source_url',p_record.source_url,
    'verified_at',to_char(p_record.verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'is_demo',p_record.is_demo,'revision',p_record.revision)
$$;
revoke all on function public.b_release_projection(public.releases) from public,anon,authenticated;

-- p_input is a B proposal; the eventual route validates the approved shared Zod
-- schema first. SQL repeats validation for direct RPC callers.
create function public.b_curate_release(p_release_id uuid,p_expected_revision integer,
  p_input jsonb,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid();v_prior public.release_edit_history%rowtype;
  v_old public.releases%rowtype;v_new public.releases%rowtype;v_body jsonb;v_result jsonb;
  v_id uuid:=coalesce(p_release_id,gen_random_uuid());v_host text;v_url text;v_verified timestamptz;
  v_date date;v_product uuid;v_region text;v_demo boolean;v_status text;v_precision text;v_kind text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN';end if;
  if p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0 or
    jsonb_typeof(p_input) is distinct from 'object' or p_reason is null or length(btrim(p_reason)) not between 1 and 500
    then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in
    ('name','product_id','date','date_precision','event_type','region','source_url','verified_at','is_demo','status')) or
    not p_input ?& array['name','product_id','date','date_precision','event_type','region','source_url','verified_at','is_demo','status']
    then raise exception 'VALIDATION_ERROR';end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-release-editor:'||v_actor::text,0));
  -- Normalize date/UUID/time input before comparing idempotency identity.
  begin
    v_precision:=p_input->>'date_precision';v_kind:=p_input->>'event_type';v_status:=p_input->>'status';
    v_product:=(p_input->>'product_id')::uuid;v_date:=(p_input->>'date')::date;
    v_verified:=(p_input->>'verified_at')::timestamptz;v_demo:=(p_input->>'is_demo')::boolean;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'VALIDATION_ERROR';end;
  v_region:=nullif(btrim(p_input->>'region'),'');v_url:=p_input->>'source_url';
  if jsonb_typeof(p_input->'name') is distinct from 'string' or length(btrim(p_input->>'name')) not between 1 and 160 or
    v_precision is null or v_precision not in ('day','month','unconfirmed') or v_kind is null or v_kind not in ('release','preorder','announcement') or
    v_status is null or v_status not in ('published','withdrawn') or jsonb_typeof(p_input->'is_demo') is distinct from 'boolean' or
    (p_input->'product_id'<>'null'::jsonb and jsonb_typeof(p_input->'product_id')<>'string') or
    (p_input->'region'<>'null'::jsonb and jsonb_typeof(p_input->'region')<>'string') or length(v_region)>32 or
    (v_precision='unconfirmed' and v_date is not null) or (v_precision<>'unconfirmed' and v_date is null) or
    (v_date is not null and (jsonb_typeof(p_input->'date') is distinct from 'string' or (p_input->>'date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) or
    (v_precision='month' and extract(day from v_date)<>1) or v_verified is null or not isfinite(v_verified) or
    v_verified>clock_timestamp() or jsonb_typeof(p_input->'verified_at') is distinct from 'string' or
    (p_input->>'verified_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$' or
    v_url is null or length(v_url)>2048 or v_url !~ '^https://[a-z0-9.-]+(/[^[:space:]]*)?$'
    then raise exception 'VALIDATION_ERROR';end if;
  v_host:=substring(v_url from '^https://([^/]+)');
  v_body:=jsonb_build_object('release_id',p_release_id,'expected_revision',p_expected_revision,'reason',btrim(p_reason),
    'input',p_input||jsonb_build_object('name',btrim(p_input->>'name'),'product_id',v_product,'region',v_region,
      'verified_at',to_char(v_verified at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  select * into v_prior from public.release_edit_history where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_body<>v_body then raise exception 'CONFLICT';end if;return v_prior.result;end if;
  perform public.b_assert_account_writable();
  perform 1 from public.b_release_source_hosts where host=v_host and approved for share;
  if not found then raise exception 'SOURCE_UNAVAILABLE';end if;
  -- A shared row lock is unnecessary for creation: the UUID PK also resolves a
  -- competing explicit-ID create atomically. Existing edits use revision checks.
  select * into v_old from public.releases where id=v_id for update;
  if found then
    if p_release_id is null or v_old.revision<>p_expected_revision then raise exception 'CONFLICT';end if;
    update public.releases set product_id=v_product,name=btrim(p_input->>'name'),release_date=v_date,date_precision=v_precision,
      event_type=v_kind,region=v_region,source_url=v_url,source_host=v_host,verified_at=v_verified,is_demo=v_demo,
      status=v_status,revision=revision+1,updated_at=clock_timestamp() where id=v_id returning * into v_new;
  else
    if p_expected_revision<>0 then raise exception 'CONFLICT';end if;
    begin
      insert into public.releases(id,product_id,name,release_date,date_precision,event_type,region,source_url,source_host,verified_at,is_demo,status,revision)
        values(v_id,v_product,btrim(p_input->>'name'),v_date,v_precision,v_kind,v_region,v_url,v_host,v_verified,v_demo,v_status,1) returning * into v_new;
    exception when unique_violation then raise exception 'CONFLICT';end;
  end if;
  v_result:=public.b_release_projection(v_new);
  insert into public.release_edit_history(release_id,actor_id,revision,previous_record,next_record,reason,idempotency_key,request_body,result)
    values(v_id,v_actor,v_new.revision,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new),btrim(p_reason),p_idempotency_key,v_body,v_result);
  return v_result;
end $$;
revoke all on function public.b_curate_release(uuid,integer,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.b_curate_release(uuid,integer,jsonb,text,uuid) to authenticated;

create function public.b_public_releases(p_region text default null,p_event_type text default null,p_limit integer default 20,
  p_after_date date default null,p_after_id uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_cfg public.b_calendar_settings%rowtype;v_release public.releases%rowtype;
begin
  if p_limit is null or p_limit<1 or p_limit>50 or length(p_region)>32 or
    (p_event_type is not null and p_event_type not in ('release','preorder','announcement')) or
    (p_after_id is null and p_after_date is not null) then raise exception 'VALIDATION_ERROR';end if;
  select * into strict v_cfg from public.b_calendar_settings where singleton;
  if not v_cfg.enabled or not exists(select 1 from public.feature_flags f where f.name='calendar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE';end if;
  for v_release in select r.* from public.releases r join public.b_release_source_hosts h on h.host=r.source_host
    where r.status='published' and h.approved and (not r.is_demo or v_cfg.allow_demo) and
      (p_region is null or r.region=p_region) and (p_event_type is null or r.event_type=p_event_type) and
      (p_after_id is null or (p_after_date is not null and (r.release_date is null or r.release_date>p_after_date or
        (r.release_date=p_after_date and r.id>p_after_id))) or (p_after_date is null and r.release_date is null and r.id>p_after_id))
    order by r.release_date asc nulls last,r.id limit p_limit
  loop return next public.b_release_projection(v_release);end loop;
end $$;
revoke all on function public.b_public_releases(text,text,integer,date,uuid) from public,anon,authenticated;
grant execute on function public.b_public_releases(text,text,integer,date,uuid) to anon,authenticated,service_role;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261107020000','b_calendar',array[$pp_source_20261107020000$-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned draft, requires the Radar proposal's trusted b_is_staff() helper.
-- Nullable unknown dates and demo provenance require the shared contract review.
-- No fabricated release seed data and no external fetches are included.
begin;
create table public.b_calendar_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,allow_demo boolean not null default false
);
insert into public.b_calendar_settings(singleton) values(true);
create table public.b_release_source_hosts (
  host text primary key check(host=lower(host) and host~'^[a-z0-9][a-z0-9.-]*[a-z0-9]$' and position('..' in host)=0),
  approved boolean not null default false, permission_notes text not null check(length(permission_notes) between 1 and 1000)
);
create table public.releases (
  id uuid primary key default gen_random_uuid(),product_id uuid references public.products(id),
  name text not null check(length(name) between 1 and 160),
  release_date date,date_precision text not null check(date_precision in ('day','month','unconfirmed')),
  event_type text not null check(event_type in ('release','preorder','announcement')),
  region text check(length(region) between 1 and 32),source_url text not null check(length(source_url)<=2048),
  source_host text not null references public.b_release_source_hosts(host),verified_at timestamptz not null,
  is_demo boolean not null default true,status text not null default 'published' check(status in ('published','withdrawn')),
  revision integer not null check(revision>0),updated_at timestamptz not null default now(),
  check((date_precision='unconfirmed' and release_date is null) or
    (date_precision='day' and release_date is not null) or
    (date_precision='month' and release_date is not null and extract(day from release_date)=1))
);
create index b_release_calendar_order on public.releases(release_date asc nulls last,id) where status='published';
create table public.release_edit_history (
  id uuid primary key default gen_random_uuid(),release_id uuid not null references public.releases(id),
  actor_id uuid references auth.users(id) on delete set null,
  revision integer not null,previous_record jsonb,next_record jsonb not null,reason text not null check(length(reason) between 1 and 500),
  idempotency_key uuid not null,request_body jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key),unique(release_id,revision)
);
alter table public.b_calendar_settings enable row level security;
alter table public.b_release_source_hosts enable row level security;
alter table public.releases enable row level security;
alter table public.release_edit_history enable row level security;
revoke all on public.b_calendar_settings,public.b_release_source_hosts,public.releases,public.release_edit_history from public,anon,authenticated;
grant all on public.b_calendar_settings,public.b_release_source_hosts,public.releases,public.release_edit_history to service_role;
grant select on public.release_edit_history to authenticated;
create policy b_release_history_staff on public.release_edit_history for select to authenticated using((select public.b_is_staff()));

create function public.b_release_projection(p_record public.releases) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',p_record.id,'product_id',p_record.product_id,'name',p_record.name,
    'date',to_char(p_record.release_date,'YYYY-MM-DD'),'date_precision',p_record.date_precision,
    'event_type',p_record.event_type,'region',p_record.region,'source_url',p_record.source_url,
    'verified_at',to_char(p_record.verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'is_demo',p_record.is_demo,'revision',p_record.revision)
$$;
revoke all on function public.b_release_projection(public.releases) from public,anon,authenticated;

-- p_input is a B proposal; the eventual route validates the approved shared Zod
-- schema first. SQL repeats validation for direct RPC callers.
create function public.b_curate_release(p_release_id uuid,p_expected_revision integer,
  p_input jsonb,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid();v_prior public.release_edit_history%rowtype;
  v_old public.releases%rowtype;v_new public.releases%rowtype;v_body jsonb;v_result jsonb;
  v_id uuid:=coalesce(p_release_id,gen_random_uuid());v_host text;v_url text;v_verified timestamptz;
  v_date date;v_product uuid;v_region text;v_demo boolean;v_status text;v_precision text;v_kind text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN';end if;
  if p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0 or
    jsonb_typeof(p_input) is distinct from 'object' or p_reason is null or length(btrim(p_reason)) not between 1 and 500
    then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in
    ('name','product_id','date','date_precision','event_type','region','source_url','verified_at','is_demo','status')) or
    not p_input ?& array['name','product_id','date','date_precision','event_type','region','source_url','verified_at','is_demo','status']
    then raise exception 'VALIDATION_ERROR';end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-release-editor:'||v_actor::text,0));
  -- Normalize date/UUID/time input before comparing idempotency identity.
  begin
    v_precision:=p_input->>'date_precision';v_kind:=p_input->>'event_type';v_status:=p_input->>'status';
    v_product:=(p_input->>'product_id')::uuid;v_date:=(p_input->>'date')::date;
    v_verified:=(p_input->>'verified_at')::timestamptz;v_demo:=(p_input->>'is_demo')::boolean;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'VALIDATION_ERROR';end;
  v_region:=nullif(btrim(p_input->>'region'),'');v_url:=p_input->>'source_url';
  if jsonb_typeof(p_input->'name') is distinct from 'string' or length(btrim(p_input->>'name')) not between 1 and 160 or
    v_precision is null or v_precision not in ('day','month','unconfirmed') or v_kind is null or v_kind not in ('release','preorder','announcement') or
    v_status is null or v_status not in ('published','withdrawn') or jsonb_typeof(p_input->'is_demo') is distinct from 'boolean' or
    (p_input->'product_id'<>'null'::jsonb and jsonb_typeof(p_input->'product_id')<>'string') or
    (p_input->'region'<>'null'::jsonb and jsonb_typeof(p_input->'region')<>'string') or length(v_region)>32 or
    (v_precision='unconfirmed' and v_date is not null) or (v_precision<>'unconfirmed' and v_date is null) or
    (v_date is not null and (jsonb_typeof(p_input->'date') is distinct from 'string' or (p_input->>'date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) or
    (v_precision='month' and extract(day from v_date)<>1) or v_verified is null or not isfinite(v_verified) or
    v_verified>clock_timestamp() or jsonb_typeof(p_input->'verified_at') is distinct from 'string' or
    (p_input->>'verified_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$' or
    v_url is null or length(v_url)>2048 or v_url !~ '^https://[a-z0-9.-]+(/[^[:space:]]*)?$'
    then raise exception 'VALIDATION_ERROR';end if;
  v_host:=substring(v_url from '^https://([^/]+)');
  v_body:=jsonb_build_object('release_id',p_release_id,'expected_revision',p_expected_revision,'reason',btrim(p_reason),
    'input',p_input||jsonb_build_object('name',btrim(p_input->>'name'),'product_id',v_product,'region',v_region,
      'verified_at',to_char(v_verified at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  select * into v_prior from public.release_edit_history where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_body<>v_body then raise exception 'CONFLICT';end if;return v_prior.result;end if;
  perform public.b_assert_account_writable();
  perform 1 from public.b_release_source_hosts where host=v_host and approved for share;
  if not found then raise exception 'SOURCE_UNAVAILABLE';end if;
  -- A shared row lock is unnecessary for creation: the UUID PK also resolves a
  -- competing explicit-ID create atomically. Existing edits use revision checks.
  select * into v_old from public.releases where id=v_id for update;
  if found then
    if p_release_id is null or v_old.revision<>p_expected_revision then raise exception 'CONFLICT';end if;
    update public.releases set product_id=v_product,name=btrim(p_input->>'name'),release_date=v_date,date_precision=v_precision,
      event_type=v_kind,region=v_region,source_url=v_url,source_host=v_host,verified_at=v_verified,is_demo=v_demo,
      status=v_status,revision=revision+1,updated_at=clock_timestamp() where id=v_id returning * into v_new;
  else
    if p_expected_revision<>0 then raise exception 'CONFLICT';end if;
    begin
      insert into public.releases(id,product_id,name,release_date,date_precision,event_type,region,source_url,source_host,verified_at,is_demo,status,revision)
        values(v_id,v_product,btrim(p_input->>'name'),v_date,v_precision,v_kind,v_region,v_url,v_host,v_verified,v_demo,v_status,1) returning * into v_new;
    exception when unique_violation then raise exception 'CONFLICT';end;
  end if;
  v_result:=public.b_release_projection(v_new);
  insert into public.release_edit_history(release_id,actor_id,revision,previous_record,next_record,reason,idempotency_key,request_body,result)
    values(v_id,v_actor,v_new.revision,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new),btrim(p_reason),p_idempotency_key,v_body,v_result);
  return v_result;
end $$;
revoke all on function public.b_curate_release(uuid,integer,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.b_curate_release(uuid,integer,jsonb,text,uuid) to authenticated;

create function public.b_public_releases(p_region text default null,p_event_type text default null,p_limit integer default 20,
  p_after_date date default null,p_after_id uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_cfg public.b_calendar_settings%rowtype;v_release public.releases%rowtype;
begin
  if p_limit is null or p_limit<1 or p_limit>50 or length(p_region)>32 or
    (p_event_type is not null and p_event_type not in ('release','preorder','announcement')) or
    (p_after_id is null and p_after_date is not null) then raise exception 'VALIDATION_ERROR';end if;
  select * into strict v_cfg from public.b_calendar_settings where singleton;
  if not v_cfg.enabled or not exists(select 1 from public.feature_flags f where f.name='calendar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE';end if;
  for v_release in select r.* from public.releases r join public.b_release_source_hosts h on h.host=r.source_host
    where r.status='published' and h.approved and (not r.is_demo or v_cfg.allow_demo) and
      (p_region is null or r.region=p_region) and (p_event_type is null or r.event_type=p_event_type) and
      (p_after_id is null or (p_after_date is not null and (r.release_date is null or r.release_date>p_after_date or
        (r.release_date=p_after_date and r.id>p_after_id))) or (p_after_date is null and r.release_date is null and r.id>p_after_id))
    order by r.release_date asc nulls last,r.id limit p_limit
  loop return next public.b_release_projection(v_release);end loop;
end $$;
revoke all on function public.b_public_releases(text,text,integer,date,uuid) from public,anon,authenticated;
grant execute on function public.b_public_releases(text,text,integer,date,uuid) to anon,authenticated,service_role;
commit;
$pp_source_20261107020000$]);

-- SOURCE 20261107030000_b_manifests.sql
-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned draft; requires pack tables and Radar's trusted b_is_staff() helper.
-- Publication snapshots are immutable. No denominators inferred from card totals.
alter table public.tcg_sets add column catalog_complete boolean not null default false;
alter table public.cards add column inclusion_class text not null default 'unknown'
  check(inclusion_class in ('in_set','promo','special','unknown'));
alter table public.cards add column variant_scope_complete boolean not null default false;
alter table public.card_variants add column manifest_scope text not null default 'unknown'
  check(manifest_scope in ('in_set','extended_only','unknown'));
alter table public.master_set_manifests add column withdrawn_at timestamptz;
alter table public.master_set_manifests add column withdrawal_reason text;
alter table public.master_set_manifests add constraint b_manifest_publication_state check(
  (not validated or published_at is not null) and
  ((withdrawn_at is null and withdrawal_reason is null) or
   (validated and withdrawn_at is not null and withdrawal_reason is not null and length(btrim(withdrawal_reason)) between 1 and 500)));
create table public.b_manifest_actions (
  id uuid primary key default gen_random_uuid(),manifest_id uuid not null references public.master_set_manifests(id),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in ('publish','withdraw')),reason text not null check(length(reason) between 1 and 500),
  idempotency_key uuid not null,request_body jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key)
);
alter table public.b_manifest_actions enable row level security;
revoke all on public.b_manifest_actions from public,anon,authenticated;
grant all on public.b_manifest_actions to service_role;
grant select on public.b_manifest_actions to authenticated;
create policy b_manifest_staff_audit on public.b_manifest_actions for select to authenticated using((select public.b_is_staff()));

-- Serialize publication against catalog writes at statement start, before row
-- locks are taken. This avoids update-row -> set-lock inversions with pack draws.
create function public.b_catalog_publication_lock() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin perform pg_advisory_xact_lock(hashtextextended('pp-catalog-publication',0));return null;end $$;
create trigger b_sets_publication_lock before insert or update or delete on public.tcg_sets
  for each statement execute function public.b_catalog_publication_lock();
create trigger b_cards_publication_lock before insert or update or delete on public.cards
  for each statement execute function public.b_catalog_publication_lock();
create trigger b_variants_publication_lock before insert or update or delete on public.card_variants
  for each statement execute function public.b_catalog_publication_lock();

create function public.b_validate_manifest(p_id uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare v_manifest public.master_set_manifests%rowtype;v_set public.tcg_sets%rowtype;v_goal text;
begin
  select * into strict v_manifest from public.master_set_manifests where id=p_id;
  select * into strict v_set from public.tcg_sets where id=v_manifest.set_id;
  if not v_set.catalog_complete or v_set.rights_status='disabled' or
    not ('base'=any(v_manifest.supported_goals)) or
    cardinality(v_manifest.supported_goals)<>(select count(distinct x) from unnest(v_manifest.supported_goals) x) or
    exists(select 1 from public.cards where set_id=v_set.id and inclusion_class='unknown')
    then raise exception 'INCOMPLETE_MANIFEST';end if;
  foreach v_goal in array v_manifest.supported_goals loop
    if not exists(select 1 from public.master_set_requirements where manifest_id=p_id and scope=v_goal)
      then raise exception 'EMPTY_GOAL';end if;
  end loop;
  if exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
    join public.cards c on c.id=cv.card_id where r.manifest_id=p_id and
    ((r.scope in ('base','master') and (c.inclusion_class<>'in_set' or cv.manifest_scope<>'in_set')) or
      (r.scope='extended' and (c.inclusion_class='unknown' or cv.manifest_scope='unknown')) or
      not (r.scope=any(v_manifest.supported_goals)))) then raise exception 'INVALID_REQUIREMENT';end if;
  -- One Base group is one numbered card, with alternatives only for that card.
  if exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
    where r.manifest_id=p_id and r.scope='base' group by r.collectible_key having count(distinct cv.card_id)<>1) or
    exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
    where r.manifest_id=p_id and r.scope='base' group by cv.card_id having count(distinct r.collectible_key)<>1)
    then raise exception 'INVALID_BASE_GROUP';end if;
  if exists(select 1 from public.cards c where c.set_id=v_set.id and c.inclusion_class='in_set' and
    not exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
      where r.manifest_id=p_id and r.scope='base' and cv.card_id=c.id)) or
    exists(select 1 from public.card_variants cv join public.cards c on c.id=cv.card_id
      where cv.set_id=v_set.id and c.inclusion_class='in_set' and cv.manifest_scope='in_set' and
      not exists(select 1 from public.master_set_requirements r where r.manifest_id=p_id and r.scope='base' and r.variant_id=cv.id))
    then raise exception 'INCOMPLETE_BASE';end if;
  if 'master'=any(v_manifest.supported_goals) and (
    exists(select 1 from public.cards where set_id=v_set.id and inclusion_class='in_set' and not variant_scope_complete) or
    exists(select 1 from public.card_variants cv join public.cards c on c.id=cv.card_id where cv.set_id=v_set.id and c.inclusion_class='in_set' and cv.manifest_scope='unknown') or
    exists(select 1 from public.card_variants cv join public.cards c on c.id=cv.card_id where cv.set_id=v_set.id and c.inclusion_class='in_set' and cv.manifest_scope='in_set' and
      not exists(select 1 from public.master_set_requirements r where r.manifest_id=p_id and r.scope='master' and r.variant_id=cv.id)))
    then raise exception 'INCOMPLETE_MASTER';end if;
end $$;

create function public.b_manifest_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' then
    if new.validated or new.published_at is not null or new.withdrawn_at is not null then raise exception 'DRAFT_REQUIRED';end if;
    return new;
  end if;
  if old.validated then
    if tg_op='DELETE' then raise exception 'IMMUTABLE_MANIFEST';end if;
    if (to_jsonb(new)-'withdrawn_at'-'withdrawal_reason') is distinct from (to_jsonb(old)-'withdrawn_at'-'withdrawal_reason') or
      old.withdrawn_at is not null or new.withdrawn_at is null then raise exception 'IMMUTABLE_MANIFEST';end if;
  elsif tg_op='UPDATE' and new.validated then
    if (to_jsonb(new)-'validated'-'published_at') is distinct from (to_jsonb(old)-'validated'-'published_at') then raise exception 'DRAFT_CHANGES_REQUIRED';end if;
    perform public.b_validate_manifest(old.id);
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_manifest_immutable before insert or update or delete on public.master_set_manifests
  for each row execute function public.b_manifest_guard();
create function public.b_requirement_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare v_id uuid;v_validated boolean;
begin
  if tg_op='UPDATE' and new.manifest_id<>old.manifest_id then raise exception 'IMMUTABLE_MANIFEST_REFERENCE';end if;
  v_id:=case when tg_op='DELETE' then old.manifest_id else new.manifest_id end;
  select validated into v_validated from public.master_set_manifests where id=v_id for update;
  if v_validated then raise exception 'IMMUTABLE_MANIFEST';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_requirement_immutable before insert or update or delete on public.master_set_requirements
  for each row execute function public.b_requirement_guard();

create function public.b_variant_identity_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.master_set_requirements r join public.master_set_manifests m on m.id=r.manifest_id
    where r.variant_id=old.id and m.validated) and (tg_op='DELETE' or
      (to_jsonb(new)-'image_url'-'image_rights_cleared'-'eligible_for_packs'-'rarity') is distinct from
      (to_jsonb(old)-'image_url'-'image_rights_cleared'-'eligible_for_packs'-'rarity')) then raise exception 'IMMUTABLE_VARIANT_IDENTITY';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_variant_identity before update or delete on public.card_variants for each row execute function public.b_variant_identity_guard();
create function public.b_card_identity_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.card_variants cv join public.master_set_requirements r on r.variant_id=cv.id
    join public.master_set_manifests m on m.id=r.manifest_id where cv.card_id=old.id and m.validated) and
    (tg_op='DELETE' or (to_jsonb(new)-'card_name'-'variant_scope_complete') is distinct from (to_jsonb(old)-'card_name'-'variant_scope_complete'))
    then raise exception 'IMMUTABLE_CARD_IDENTITY';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_card_identity before update or delete on public.cards for each row execute function public.b_card_identity_guard();

create function public.b_publish_manifest(p_id uuid,p_reason text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_prior public.b_manifest_actions%rowtype;v_manifest public.master_set_manifests%rowtype;v_body jsonb;v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN';end if;
  if p_id is null or p_idempotency_key is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'VALIDATION_ERROR';end if;
  v_body:=jsonb_build_object('manifest_id',p_id,'reason',btrim(p_reason),'action','publish');
  perform pg_advisory_xact_lock(hashtextextended('pp-manifest-editor:'||v_user::text,0));
  select * into v_prior from public.b_manifest_actions where actor_id=v_user and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_body<>v_body then raise exception 'CONFLICT';end if;return v_prior.result;end if;
  perform public.b_assert_account_writable();
  perform pg_advisory_xact_lock(hashtextextended('pp-catalog-publication',0));
  select * into v_manifest from public.master_set_manifests where id=p_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if v_manifest.validated or v_manifest.withdrawn_at is not null then raise exception 'CONFLICT';end if;
  update public.master_set_manifests set validated=true,published_at=clock_timestamp() where id=p_id;
  v_result:=jsonb_build_object('manifest_id',p_id,'set_id',v_manifest.set_id,'version',v_manifest.version,'status','published');
  insert into public.b_manifest_actions(manifest_id,actor_id,action,reason,idempotency_key,request_body,result)
    values(p_id,v_user,'publish',btrim(p_reason),p_idempotency_key,v_body,v_result);
  return v_result;
end $$;

create function public.b_withdraw_manifest(p_id uuid,p_reason text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_prior public.b_manifest_actions%rowtype;v_manifest public.master_set_manifests%rowtype;v_body jsonb;v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN';end if;
  if p_id is null or p_idempotency_key is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'VALIDATION_ERROR';end if;
  v_body:=jsonb_build_object('manifest_id',p_id,'reason',btrim(p_reason),'action','withdraw');
  perform pg_advisory_xact_lock(hashtextextended('pp-manifest-editor:'||v_user::text,0));
  select * into v_prior from public.b_manifest_actions where actor_id=v_user and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_body<>v_body then raise exception 'CONFLICT';end if;return v_prior.result;end if;
  perform public.b_assert_account_writable();
  select * into v_manifest from public.master_set_manifests where id=p_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if not v_manifest.validated or v_manifest.withdrawn_at is not null then raise exception 'CONFLICT';end if;
  update public.master_set_manifests set withdrawn_at=clock_timestamp(),withdrawal_reason=btrim(p_reason) where id=p_id;
  v_result:=jsonb_build_object('manifest_id',p_id,'set_id',v_manifest.set_id,'version',v_manifest.version,'status','withdrawn');
  insert into public.b_manifest_actions(manifest_id,actor_id,action,reason,idempotency_key,request_body,result)
    values(p_id,v_user,'withdraw',btrim(p_reason),p_idempotency_key,v_body,v_result);
  return v_result;
end $$;

create function public.b_collection_progress(p_set_id uuid,p_manifest_version text,p_mode text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_manifest public.master_set_manifests%rowtype;v_goal text;v_required integer;v_collected integer;v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if p_set_id is null or p_manifest_version is null or p_mode is null or p_mode not in ('real','virtual') then raise exception 'VALIDATION_ERROR';end if;
  select * into v_manifest from public.master_set_manifests where set_id=p_set_id and version=p_manifest_version and validated and withdrawn_at is null;
  if not found then raise exception 'INCOMPLETE_MANIFEST';end if;
  if not exists(select 1 from public.tcg_sets where id=p_set_id and rights_status<>'disabled') then raise exception 'RIGHTS_DISABLED';end if;
  v_result:=jsonb_build_object('set_id',p_set_id,'mode',p_mode,'manifest_version',p_manifest_version);
  foreach v_goal in array array['base','master','extended'] loop
    v_required:=null;v_collected:=null;
    if v_goal=any(v_manifest.supported_goals) then
      with owned as (
        select card_variant_id from public.real_inventory where p_mode='real' and user_id=v_user and quantity>0
        union all select card_variant_id from public.virtual_inventory where p_mode='virtual' and user_id=v_user and quantity>0
      ), grouped as (
        select r.collectible_key,bool_or(o.card_variant_id is not null) present from public.master_set_requirements r
        left join owned o on o.card_variant_id=r.variant_id where r.manifest_id=v_manifest.id and r.scope=v_goal group by r.collectible_key
      ) select count(*)::integer,count(*) filter(where present)::integer into v_required,v_collected from grouped;
    end if;
    v_result:=v_result||jsonb_build_object(v_goal||'_collected',v_collected,v_goal||'_required',v_required);
  end loop;
  return v_result;
end $$;
create function public.b_missing_collection(p_set_id uuid,p_manifest_version text,p_mode text,p_goal text,
  p_limit integer default 20,p_after_key text default null)
returns table(collectible_key text,variant_ids uuid[])
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_manifest public.master_set_manifests%rowtype;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if p_set_id is null or p_manifest_version is null or p_mode is null or p_mode not in ('real','virtual') or
    p_goal is null or p_goal not in ('base','master','extended') or p_limit is null or p_limit<1 or p_limit>50 or length(p_after_key)>160
    then raise exception 'VALIDATION_ERROR';end if;
  select * into v_manifest from public.master_set_manifests where set_id=p_set_id and version=p_manifest_version and validated and withdrawn_at is null;
  if not found then raise exception 'INCOMPLETE_MANIFEST';end if;
  if not (p_goal=any(v_manifest.supported_goals)) then raise exception 'INCOMPLETE_GOAL';end if;
  if not exists(select 1 from public.tcg_sets where id=p_set_id and rights_status<>'disabled') then raise exception 'RIGHTS_DISABLED';end if;
  return query with owned as (
    select card_variant_id from public.real_inventory where p_mode='real' and user_id=v_user and quantity>0
    union all select card_variant_id from public.virtual_inventory where p_mode='virtual' and user_id=v_user and quantity>0
  ), grouped as (
    select r.collectible_key,array_agg(r.variant_id order by r.variant_id) variants,bool_or(o.card_variant_id is not null) present
    from public.master_set_requirements r left join owned o on o.card_variant_id=r.variant_id
    where r.manifest_id=v_manifest.id and r.scope=p_goal group by r.collectible_key
  ) select grouped.collectible_key,grouped.variants from grouped where not present and
    (p_after_key is null or grouped.collectible_key collate "C">p_after_key collate "C")
    order by grouped.collectible_key collate "C" limit p_limit;
end $$;
revoke all on function public.b_catalog_publication_lock(),public.b_validate_manifest(uuid),public.b_manifest_guard(),
  public.b_requirement_guard(),public.b_variant_identity_guard(),public.b_card_identity_guard() from public,anon,authenticated;
revoke all on function public.b_publish_manifest(uuid,text,uuid),public.b_withdraw_manifest(uuid,text,uuid),
  public.b_collection_progress(uuid,text,text),public.b_missing_collection(uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.b_publish_manifest(uuid,text,uuid),public.b_withdraw_manifest(uuid,text,uuid),
  public.b_collection_progress(uuid,text,text),public.b_missing_collection(uuid,text,text,text,integer,text) to authenticated;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261107030000','b_manifests',array[$pp_source_20261107030000$-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned draft; requires pack tables and Radar's trusted b_is_staff() helper.
-- Publication snapshots are immutable. No denominators inferred from card totals.
begin;
alter table public.tcg_sets add column catalog_complete boolean not null default false;
alter table public.cards add column inclusion_class text not null default 'unknown'
  check(inclusion_class in ('in_set','promo','special','unknown'));
alter table public.cards add column variant_scope_complete boolean not null default false;
alter table public.card_variants add column manifest_scope text not null default 'unknown'
  check(manifest_scope in ('in_set','extended_only','unknown'));
alter table public.master_set_manifests add column withdrawn_at timestamptz;
alter table public.master_set_manifests add column withdrawal_reason text;
alter table public.master_set_manifests add constraint b_manifest_publication_state check(
  (not validated or published_at is not null) and
  ((withdrawn_at is null and withdrawal_reason is null) or
   (validated and withdrawn_at is not null and withdrawal_reason is not null and length(btrim(withdrawal_reason)) between 1 and 500)));
create table public.b_manifest_actions (
  id uuid primary key default gen_random_uuid(),manifest_id uuid not null references public.master_set_manifests(id),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in ('publish','withdraw')),reason text not null check(length(reason) between 1 and 500),
  idempotency_key uuid not null,request_body jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key)
);
alter table public.b_manifest_actions enable row level security;
revoke all on public.b_manifest_actions from public,anon,authenticated;
grant all on public.b_manifest_actions to service_role;
grant select on public.b_manifest_actions to authenticated;
create policy b_manifest_staff_audit on public.b_manifest_actions for select to authenticated using((select public.b_is_staff()));

-- Serialize publication against catalog writes at statement start, before row
-- locks are taken. This avoids update-row -> set-lock inversions with pack draws.
create function public.b_catalog_publication_lock() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin perform pg_advisory_xact_lock(hashtextextended('pp-catalog-publication',0));return null;end $$;
create trigger b_sets_publication_lock before insert or update or delete on public.tcg_sets
  for each statement execute function public.b_catalog_publication_lock();
create trigger b_cards_publication_lock before insert or update or delete on public.cards
  for each statement execute function public.b_catalog_publication_lock();
create trigger b_variants_publication_lock before insert or update or delete on public.card_variants
  for each statement execute function public.b_catalog_publication_lock();

create function public.b_validate_manifest(p_id uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare v_manifest public.master_set_manifests%rowtype;v_set public.tcg_sets%rowtype;v_goal text;
begin
  select * into strict v_manifest from public.master_set_manifests where id=p_id;
  select * into strict v_set from public.tcg_sets where id=v_manifest.set_id;
  if not v_set.catalog_complete or v_set.rights_status='disabled' or
    not ('base'=any(v_manifest.supported_goals)) or
    cardinality(v_manifest.supported_goals)<>(select count(distinct x) from unnest(v_manifest.supported_goals) x) or
    exists(select 1 from public.cards where set_id=v_set.id and inclusion_class='unknown')
    then raise exception 'INCOMPLETE_MANIFEST';end if;
  foreach v_goal in array v_manifest.supported_goals loop
    if not exists(select 1 from public.master_set_requirements where manifest_id=p_id and scope=v_goal)
      then raise exception 'EMPTY_GOAL';end if;
  end loop;
  if exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
    join public.cards c on c.id=cv.card_id where r.manifest_id=p_id and
    ((r.scope in ('base','master') and (c.inclusion_class<>'in_set' or cv.manifest_scope<>'in_set')) or
      (r.scope='extended' and (c.inclusion_class='unknown' or cv.manifest_scope='unknown')) or
      not (r.scope=any(v_manifest.supported_goals)))) then raise exception 'INVALID_REQUIREMENT';end if;
  -- One Base group is one numbered card, with alternatives only for that card.
  if exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
    where r.manifest_id=p_id and r.scope='base' group by r.collectible_key having count(distinct cv.card_id)<>1) or
    exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
    where r.manifest_id=p_id and r.scope='base' group by cv.card_id having count(distinct r.collectible_key)<>1)
    then raise exception 'INVALID_BASE_GROUP';end if;
  if exists(select 1 from public.cards c where c.set_id=v_set.id and c.inclusion_class='in_set' and
    not exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
      where r.manifest_id=p_id and r.scope='base' and cv.card_id=c.id)) or
    exists(select 1 from public.card_variants cv join public.cards c on c.id=cv.card_id
      where cv.set_id=v_set.id and c.inclusion_class='in_set' and cv.manifest_scope='in_set' and
      not exists(select 1 from public.master_set_requirements r where r.manifest_id=p_id and r.scope='base' and r.variant_id=cv.id))
    then raise exception 'INCOMPLETE_BASE';end if;
  if 'master'=any(v_manifest.supported_goals) and (
    exists(select 1 from public.cards where set_id=v_set.id and inclusion_class='in_set' and not variant_scope_complete) or
    exists(select 1 from public.card_variants cv join public.cards c on c.id=cv.card_id where cv.set_id=v_set.id and c.inclusion_class='in_set' and cv.manifest_scope='unknown') or
    exists(select 1 from public.card_variants cv join public.cards c on c.id=cv.card_id where cv.set_id=v_set.id and c.inclusion_class='in_set' and cv.manifest_scope='in_set' and
      not exists(select 1 from public.master_set_requirements r where r.manifest_id=p_id and r.scope='master' and r.variant_id=cv.id)))
    then raise exception 'INCOMPLETE_MASTER';end if;
end $$;

create function public.b_manifest_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' then
    if new.validated or new.published_at is not null or new.withdrawn_at is not null then raise exception 'DRAFT_REQUIRED';end if;
    return new;
  end if;
  if old.validated then
    if tg_op='DELETE' then raise exception 'IMMUTABLE_MANIFEST';end if;
    if (to_jsonb(new)-'withdrawn_at'-'withdrawal_reason') is distinct from (to_jsonb(old)-'withdrawn_at'-'withdrawal_reason') or
      old.withdrawn_at is not null or new.withdrawn_at is null then raise exception 'IMMUTABLE_MANIFEST';end if;
  elsif tg_op='UPDATE' and new.validated then
    if (to_jsonb(new)-'validated'-'published_at') is distinct from (to_jsonb(old)-'validated'-'published_at') then raise exception 'DRAFT_CHANGES_REQUIRED';end if;
    perform public.b_validate_manifest(old.id);
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_manifest_immutable before insert or update or delete on public.master_set_manifests
  for each row execute function public.b_manifest_guard();
create function public.b_requirement_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare v_id uuid;v_validated boolean;
begin
  if tg_op='UPDATE' and new.manifest_id<>old.manifest_id then raise exception 'IMMUTABLE_MANIFEST_REFERENCE';end if;
  v_id:=case when tg_op='DELETE' then old.manifest_id else new.manifest_id end;
  select validated into v_validated from public.master_set_manifests where id=v_id for update;
  if v_validated then raise exception 'IMMUTABLE_MANIFEST';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_requirement_immutable before insert or update or delete on public.master_set_requirements
  for each row execute function public.b_requirement_guard();

create function public.b_variant_identity_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.master_set_requirements r join public.master_set_manifests m on m.id=r.manifest_id
    where r.variant_id=old.id and m.validated) and (tg_op='DELETE' or
      (to_jsonb(new)-'image_url'-'image_rights_cleared'-'eligible_for_packs'-'rarity') is distinct from
      (to_jsonb(old)-'image_url'-'image_rights_cleared'-'eligible_for_packs'-'rarity')) then raise exception 'IMMUTABLE_VARIANT_IDENTITY';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_variant_identity before update or delete on public.card_variants for each row execute function public.b_variant_identity_guard();
create function public.b_card_identity_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.card_variants cv join public.master_set_requirements r on r.variant_id=cv.id
    join public.master_set_manifests m on m.id=r.manifest_id where cv.card_id=old.id and m.validated) and
    (tg_op='DELETE' or (to_jsonb(new)-'card_name'-'variant_scope_complete') is distinct from (to_jsonb(old)-'card_name'-'variant_scope_complete'))
    then raise exception 'IMMUTABLE_CARD_IDENTITY';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_card_identity before update or delete on public.cards for each row execute function public.b_card_identity_guard();

create function public.b_publish_manifest(p_id uuid,p_reason text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_prior public.b_manifest_actions%rowtype;v_manifest public.master_set_manifests%rowtype;v_body jsonb;v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN';end if;
  if p_id is null or p_idempotency_key is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'VALIDATION_ERROR';end if;
  v_body:=jsonb_build_object('manifest_id',p_id,'reason',btrim(p_reason),'action','publish');
  perform pg_advisory_xact_lock(hashtextextended('pp-manifest-editor:'||v_user::text,0));
  select * into v_prior from public.b_manifest_actions where actor_id=v_user and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_body<>v_body then raise exception 'CONFLICT';end if;return v_prior.result;end if;
  perform public.b_assert_account_writable();
  perform pg_advisory_xact_lock(hashtextextended('pp-catalog-publication',0));
  select * into v_manifest from public.master_set_manifests where id=p_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if v_manifest.validated or v_manifest.withdrawn_at is not null then raise exception 'CONFLICT';end if;
  update public.master_set_manifests set validated=true,published_at=clock_timestamp() where id=p_id;
  v_result:=jsonb_build_object('manifest_id',p_id,'set_id',v_manifest.set_id,'version',v_manifest.version,'status','published');
  insert into public.b_manifest_actions(manifest_id,actor_id,action,reason,idempotency_key,request_body,result)
    values(p_id,v_user,'publish',btrim(p_reason),p_idempotency_key,v_body,v_result);
  return v_result;
end $$;

create function public.b_withdraw_manifest(p_id uuid,p_reason text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_prior public.b_manifest_actions%rowtype;v_manifest public.master_set_manifests%rowtype;v_body jsonb;v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN';end if;
  if p_id is null or p_idempotency_key is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'VALIDATION_ERROR';end if;
  v_body:=jsonb_build_object('manifest_id',p_id,'reason',btrim(p_reason),'action','withdraw');
  perform pg_advisory_xact_lock(hashtextextended('pp-manifest-editor:'||v_user::text,0));
  select * into v_prior from public.b_manifest_actions where actor_id=v_user and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_body<>v_body then raise exception 'CONFLICT';end if;return v_prior.result;end if;
  perform public.b_assert_account_writable();
  select * into v_manifest from public.master_set_manifests where id=p_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if not v_manifest.validated or v_manifest.withdrawn_at is not null then raise exception 'CONFLICT';end if;
  update public.master_set_manifests set withdrawn_at=clock_timestamp(),withdrawal_reason=btrim(p_reason) where id=p_id;
  v_result:=jsonb_build_object('manifest_id',p_id,'set_id',v_manifest.set_id,'version',v_manifest.version,'status','withdrawn');
  insert into public.b_manifest_actions(manifest_id,actor_id,action,reason,idempotency_key,request_body,result)
    values(p_id,v_user,'withdraw',btrim(p_reason),p_idempotency_key,v_body,v_result);
  return v_result;
end $$;

create function public.b_collection_progress(p_set_id uuid,p_manifest_version text,p_mode text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_manifest public.master_set_manifests%rowtype;v_goal text;v_required integer;v_collected integer;v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if p_set_id is null or p_manifest_version is null or p_mode is null or p_mode not in ('real','virtual') then raise exception 'VALIDATION_ERROR';end if;
  select * into v_manifest from public.master_set_manifests where set_id=p_set_id and version=p_manifest_version and validated and withdrawn_at is null;
  if not found then raise exception 'INCOMPLETE_MANIFEST';end if;
  if not exists(select 1 from public.tcg_sets where id=p_set_id and rights_status<>'disabled') then raise exception 'RIGHTS_DISABLED';end if;
  v_result:=jsonb_build_object('set_id',p_set_id,'mode',p_mode,'manifest_version',p_manifest_version);
  foreach v_goal in array array['base','master','extended'] loop
    v_required:=null;v_collected:=null;
    if v_goal=any(v_manifest.supported_goals) then
      with owned as (
        select card_variant_id from public.real_inventory where p_mode='real' and user_id=v_user and quantity>0
        union all select card_variant_id from public.virtual_inventory where p_mode='virtual' and user_id=v_user and quantity>0
      ), grouped as (
        select r.collectible_key,bool_or(o.card_variant_id is not null) present from public.master_set_requirements r
        left join owned o on o.card_variant_id=r.variant_id where r.manifest_id=v_manifest.id and r.scope=v_goal group by r.collectible_key
      ) select count(*)::integer,count(*) filter(where present)::integer into v_required,v_collected from grouped;
    end if;
    v_result:=v_result||jsonb_build_object(v_goal||'_collected',v_collected,v_goal||'_required',v_required);
  end loop;
  return v_result;
end $$;
create function public.b_missing_collection(p_set_id uuid,p_manifest_version text,p_mode text,p_goal text,
  p_limit integer default 20,p_after_key text default null)
returns table(collectible_key text,variant_ids uuid[])
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_manifest public.master_set_manifests%rowtype;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if p_set_id is null or p_manifest_version is null or p_mode is null or p_mode not in ('real','virtual') or
    p_goal is null or p_goal not in ('base','master','extended') or p_limit is null or p_limit<1 or p_limit>50 or length(p_after_key)>160
    then raise exception 'VALIDATION_ERROR';end if;
  select * into v_manifest from public.master_set_manifests where set_id=p_set_id and version=p_manifest_version and validated and withdrawn_at is null;
  if not found then raise exception 'INCOMPLETE_MANIFEST';end if;
  if not (p_goal=any(v_manifest.supported_goals)) then raise exception 'INCOMPLETE_GOAL';end if;
  if not exists(select 1 from public.tcg_sets where id=p_set_id and rights_status<>'disabled') then raise exception 'RIGHTS_DISABLED';end if;
  return query with owned as (
    select card_variant_id from public.real_inventory where p_mode='real' and user_id=v_user and quantity>0
    union all select card_variant_id from public.virtual_inventory where p_mode='virtual' and user_id=v_user and quantity>0
  ), grouped as (
    select r.collectible_key,array_agg(r.variant_id order by r.variant_id) variants,bool_or(o.card_variant_id is not null) present
    from public.master_set_requirements r left join owned o on o.card_variant_id=r.variant_id
    where r.manifest_id=v_manifest.id and r.scope=p_goal group by r.collectible_key
  ) select grouped.collectible_key,grouped.variants from grouped where not present and
    (p_after_key is null or grouped.collectible_key collate "C">p_after_key collate "C")
    order by grouped.collectible_key collate "C" limit p_limit;
end $$;
revoke all on function public.b_catalog_publication_lock(),public.b_validate_manifest(uuid),public.b_manifest_guard(),
  public.b_requirement_guard(),public.b_variant_identity_guard(),public.b_card_identity_guard() from public,anon,authenticated;
revoke all on function public.b_publish_manifest(uuid,text,uuid),public.b_withdraw_manifest(uuid,text,uuid),
  public.b_collection_progress(uuid,text,text),public.b_missing_collection(uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.b_publish_manifest(uuid,text,uuid),public.b_withdraw_manifest(uuid,text,uuid),
  public.b_collection_progress(uuid,text,text),public.b_missing_collection(uuid,text,text,text,integer,text) to authenticated;
commit;
$pp_source_20261107030000$]);

-- SOURCE 20261107040000_b_platform_bridge.sql
-- CONTRACT-02: bind B outbox and current-signal checks to A's transactional worker.
-- Preserve the original function OID for existing callers/cached plans. Clone
-- A's actual definition, then replace its body at the same function identity.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.event_is_current(uuid,uuid,timestamptz)'::regprocedure);
 execute regexp_replace(definition,'FUNCTION public[.]event_is_current[(]','FUNCTION public.b_platform_event_is_current(','i');
end $$;
revoke all on function public.b_platform_event_is_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.b_platform_event_is_current(uuid,uuid,timestamptz) to service_role;
create or replace function public.event_is_current(p_event uuid,p_rule uuid,p_now timestamptz default now()) returns boolean
language plpgsql security definer set search_path='' as $$
declare e public.stock_events; signal public.b_sighting_outbox;
begin
 if not public.b_platform_event_is_current(p_event,p_rule,p_now) then return false;end if;
 select * into e from public.stock_events where id=p_event;
 if e.event_type='local_sighting' then
  select * into signal from public.b_sighting_outbox where id=p_event and event_type='sighting_approved';
  if not found or not public.b_current_sighting_signal(signal.sighting_id,signal.revision) then return false;end if;
  if exists(select 1 from public.sightings where id=signal.sighting_id and report_type<>'found_stock') then return false;end if;
 end if;
 return true;
end $$;
revoke all on function public.event_is_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.event_is_current(uuid,uuid,timestamptz) to service_role;

-- Publishing and marking the outbox happen in one database transaction. Retried
-- worker calls deduplicate on A's event UUID. No independent push is sent by B.
create function public.b_dispatch_sighting_outbox(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare job public.b_sighting_outbox; report public.sightings; store public.stores; product public.products; n integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'VALIDATION_ERROR';end if;
 perform public.b_expire_sightings(p_limit);
 for job in select * from public.b_sighting_outbox where delivered_at is null order by created_at,id for update skip locked limit p_limit loop
  select * into report from public.sightings where id=job.sighting_id;
  if job.event_type='sighting_approved' and public.b_current_sighting_signal(job.sighting_id,job.revision) and report.report_type='found_stock' then
   select * into store from public.stores where id=report.store_id;
   select * into product from public.products where id=report.product_id;
   perform public.publish_local_event(jsonb_build_object(
    'event_id',job.id,'event_type','sighting_approved','occurred_at',report.observed_at,
    'evidence_type','moderated_report','entity_id',report.id,'region_code',store.region,'payload_version',1,
    'payload',jsonb_build_object('store_id',store.id,'product_id',report.product_id,'set_name',product.set_name,
      'product_type',product.product_type,'expires_at',report.expires_at,'store_zip',store.zip,
      'source_url',null,'is_demo',report.is_demo)));
  end if;
  update public.b_sighting_outbox set delivered_at=clock_timestamp() where id=job.id;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.b_dispatch_sighting_outbox(integer) from public,anon,authenticated;
grant execute on function public.b_dispatch_sighting_outbox(integer) to service_role;

create function public.b_withdraw_notifications() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if tg_op='DELETE' then
  update public.notifications set title='Community report no longer current',body='The report has been removed. Check Local Radar for current community evidence.',action_url='/local' where event_id in (select id from public.b_sighting_outbox where sighting_id=old.id);
  return old;
 end if;
 if old.moderation='approved' and (new.moderation<>'approved' or new.revision<>old.revision) then
  update public.notifications set title='Community report no longer current',
   body='The approved report was revised, withdrawn or expired. Check Local Radar for current community evidence.',action_url='/local'
   where event_id in (select id from public.b_sighting_outbox where sighting_id=old.id);
 end if;
 return new;
end $$;
revoke all on function public.b_withdraw_notifications() from public,anon,authenticated;
create trigger b_withdraw_inbox after update on public.sightings for each row execute function public.b_withdraw_notifications();
create trigger b_remove_inbox before delete on public.sightings for each row execute function public.b_withdraw_notifications();

-- Trusted, licensed ZIP centroids only; no network geocoding or GPS collection.
create function public.b_zip_distance(p_from text,p_to text) returns double precision
language sql stable security definer set search_path='' as $$
 select 3958.7613*acos(least(1.0,greatest(-1.0,sin(radians(a.latitude))*sin(radians(b.latitude))+
 cos(radians(a.latitude))*cos(radians(b.latitude))*cos(radians(b.longitude-a.longitude)))))
 from public.b_zip_centroids a,public.b_zip_centroids b,public.b_radar_settings cfg
 where a.zip=p_from and b.zip=p_to and a.rights_approved and b.rights_approved and cfg.singleton and cfg.enabled
 and (not a.is_demo or cfg.allow_demo) and (not b.is_demo or cfg.allow_demo)
 and exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled)
$$;
revoke all on function public.b_zip_distance(text,text) from public,anon,authenticated;
grant execute on function public.b_zip_distance(text,text) to service_role;

-- Erasure cleans any authored private audit prose before auth.users cascades.
create function public.b_erase_private(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(hashtextextended('pp-pack:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-real:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-sighting:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-moderator:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-release-editor:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-manifest-editor:'||p_user::text,0));
 if to_regclass('public.b_real_edit_requests') is not null then
  delete from public.b_real_edit_requests where user_id=p_user;
 end if;
 delete from public.sightings where reporter_id=p_user;
 delete from public.sighting_confirmations where user_id=p_user;
 update public.sighting_moderation_actions set actor_id=null,reason='Account erased',request_body='{}' where actor_id=p_user;
 update public.release_edit_history set actor_id=null,reason='Account erased',request_body='{}' where actor_id=p_user;
 update public.b_manifest_actions set actor_id=null,reason='Account erased',request_body='{}' where actor_id=p_user;
 delete from public.real_inventory where user_id=p_user;
 delete from public.virtual_inventory where user_id=p_user;
 delete from public.coin_ledger where user_id=p_user;
 delete from public.pack_openings where user_id=p_user;
 delete from public.wallets where user_id=p_user;
end $$;
revoke all on function public.b_erase_private(uuid) from public,anon,authenticated;
grant execute on function public.b_erase_private(uuid) to service_role;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261107040000','b_platform_bridge',array[$pp_source_20261107040000$-- CONTRACT-02: bind B outbox and current-signal checks to A's transactional worker.
begin;
-- Preserve the original function OID for existing callers/cached plans. Clone
-- A's actual definition, then replace its body at the same function identity.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.event_is_current(uuid,uuid,timestamptz)'::regprocedure);
 execute regexp_replace(definition,'FUNCTION public[.]event_is_current[(]','FUNCTION public.b_platform_event_is_current(','i');
end $$;
revoke all on function public.b_platform_event_is_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.b_platform_event_is_current(uuid,uuid,timestamptz) to service_role;
create or replace function public.event_is_current(p_event uuid,p_rule uuid,p_now timestamptz default now()) returns boolean
language plpgsql security definer set search_path='' as $$
declare e public.stock_events; signal public.b_sighting_outbox;
begin
 if not public.b_platform_event_is_current(p_event,p_rule,p_now) then return false;end if;
 select * into e from public.stock_events where id=p_event;
 if e.event_type='local_sighting' then
  select * into signal from public.b_sighting_outbox where id=p_event and event_type='sighting_approved';
  if not found or not public.b_current_sighting_signal(signal.sighting_id,signal.revision) then return false;end if;
  if exists(select 1 from public.sightings where id=signal.sighting_id and report_type<>'found_stock') then return false;end if;
 end if;
 return true;
end $$;
revoke all on function public.event_is_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.event_is_current(uuid,uuid,timestamptz) to service_role;

-- Publishing and marking the outbox happen in one database transaction. Retried
-- worker calls deduplicate on A's event UUID. No independent push is sent by B.
create function public.b_dispatch_sighting_outbox(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare job public.b_sighting_outbox; report public.sightings; store public.stores; product public.products; n integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'VALIDATION_ERROR';end if;
 perform public.b_expire_sightings(p_limit);
 for job in select * from public.b_sighting_outbox where delivered_at is null order by created_at,id for update skip locked limit p_limit loop
  select * into report from public.sightings where id=job.sighting_id;
  if job.event_type='sighting_approved' and public.b_current_sighting_signal(job.sighting_id,job.revision) and report.report_type='found_stock' then
   select * into store from public.stores where id=report.store_id;
   select * into product from public.products where id=report.product_id;
   perform public.publish_local_event(jsonb_build_object(
    'event_id',job.id,'event_type','sighting_approved','occurred_at',report.observed_at,
    'evidence_type','moderated_report','entity_id',report.id,'region_code',store.region,'payload_version',1,
    'payload',jsonb_build_object('store_id',store.id,'product_id',report.product_id,'set_name',product.set_name,
      'product_type',product.product_type,'expires_at',report.expires_at,'store_zip',store.zip,
      'source_url',null,'is_demo',report.is_demo)));
  end if;
  update public.b_sighting_outbox set delivered_at=clock_timestamp() where id=job.id;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.b_dispatch_sighting_outbox(integer) from public,anon,authenticated;
grant execute on function public.b_dispatch_sighting_outbox(integer) to service_role;

create function public.b_withdraw_notifications() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if tg_op='DELETE' then
  update public.notifications set title='Community report no longer current',body='The report has been removed. Check Local Radar for current community evidence.',action_url='/local' where event_id in (select id from public.b_sighting_outbox where sighting_id=old.id);
  return old;
 end if;
 if old.moderation='approved' and (new.moderation<>'approved' or new.revision<>old.revision) then
  update public.notifications set title='Community report no longer current',
   body='The approved report was revised, withdrawn or expired. Check Local Radar for current community evidence.',action_url='/local'
   where event_id in (select id from public.b_sighting_outbox where sighting_id=old.id);
 end if;
 return new;
end $$;
revoke all on function public.b_withdraw_notifications() from public,anon,authenticated;
create trigger b_withdraw_inbox after update on public.sightings for each row execute function public.b_withdraw_notifications();
create trigger b_remove_inbox before delete on public.sightings for each row execute function public.b_withdraw_notifications();

-- Trusted, licensed ZIP centroids only; no network geocoding or GPS collection.
create function public.b_zip_distance(p_from text,p_to text) returns double precision
language sql stable security definer set search_path='' as $$
 select 3958.7613*acos(least(1.0,greatest(-1.0,sin(radians(a.latitude))*sin(radians(b.latitude))+
 cos(radians(a.latitude))*cos(radians(b.latitude))*cos(radians(b.longitude-a.longitude)))))
 from public.b_zip_centroids a,public.b_zip_centroids b,public.b_radar_settings cfg
 where a.zip=p_from and b.zip=p_to and a.rights_approved and b.rights_approved and cfg.singleton and cfg.enabled
 and (not a.is_demo or cfg.allow_demo) and (not b.is_demo or cfg.allow_demo)
 and exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled)
$$;
revoke all on function public.b_zip_distance(text,text) from public,anon,authenticated;
grant execute on function public.b_zip_distance(text,text) to service_role;

-- Erasure cleans any authored private audit prose before auth.users cascades.
create function public.b_erase_private(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(hashtextextended('pp-pack:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-real:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-sighting:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-moderator:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-release-editor:'||p_user::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pp-manifest-editor:'||p_user::text,0));
 if to_regclass('public.b_real_edit_requests') is not null then
  delete from public.b_real_edit_requests where user_id=p_user;
 end if;
 delete from public.sightings where reporter_id=p_user;
 delete from public.sighting_confirmations where user_id=p_user;
 update public.sighting_moderation_actions set actor_id=null,reason='Account erased',request_body='{}' where actor_id=p_user;
 update public.release_edit_history set actor_id=null,reason='Account erased',request_body='{}' where actor_id=p_user;
 update public.b_manifest_actions set actor_id=null,reason='Account erased',request_body='{}' where actor_id=p_user;
 delete from public.real_inventory where user_id=p_user;
 delete from public.virtual_inventory where user_id=p_user;
 delete from public.coin_ledger where user_id=p_user;
 delete from public.pack_openings where user_id=p_user;
 delete from public.wallets where user_id=p_user;
end $$;
revoke all on function public.b_erase_private(uuid) from public,anon,authenticated;
grant execute on function public.b_erase_private(uuid) to service_role;
commit;
$pp_source_20261107040000$]);

-- SOURCE 20261107050000_b_collection_snapshot.sql

-- A complete binder snapshot is read under the same account lock as its writes.
-- Pagination of a changing inventory must never create false missing-card counts.
create function public.b_collection_snapshot(p_set_id uuid,p_manifest_version text,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); entries jsonb; notes jsonb:='{}'; progress jsonb;
begin
 if owner is null then raise exception 'UNAUTHENTICATED';end if;
 if p_set_id is null or p_manifest_version is null or p_mode is null or p_mode not in ('real','virtual') then raise exception 'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended(case when p_mode='real' then 'pp-real:' else 'pp-pack:' end||owner::text,0));
 perform pg_advisory_xact_lock_shared(hashtextextended('pp-catalog-publication',0));
 progress:=public.b_collection_progress(p_set_id,p_manifest_version,p_mode);
 if p_mode='real' then
  select coalesce(jsonb_agg(jsonb_build_object('variant_id',i.card_variant_id,'quantity',i.quantity) order by i.card_variant_id),'[]'),
   coalesce(jsonb_object_agg(i.card_variant_id::text,i.notes),'{}') into entries,notes
  from public.real_inventory i join public.card_variants v on v.id=i.card_variant_id where i.user_id=owner and v.set_id=p_set_id;
 else
  select coalesce(jsonb_agg(jsonb_build_object('variant_id',i.card_variant_id,'quantity',i.quantity) order by i.card_variant_id),'[]') into entries
  from public.virtual_inventory i join public.card_variants v on v.id=i.card_variant_id where i.user_id=owner and v.set_id=p_set_id;
 end if;
 return jsonb_build_object('entries',entries,'realNotes',notes,'mode',p_mode,'progress',progress);
end $$;
revoke all on function public.b_collection_snapshot(uuid,text,text) from public,anon,authenticated;
grant execute on function public.b_collection_snapshot(uuid,text,text) to authenticated;


insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261107050000','b_collection_snapshot',array[$pp_source_20261107050000$begin;
-- A complete binder snapshot is read under the same account lock as its writes.
-- Pagination of a changing inventory must never create false missing-card counts.
create function public.b_collection_snapshot(p_set_id uuid,p_manifest_version text,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); entries jsonb; notes jsonb:='{}'; progress jsonb;
begin
 if owner is null then raise exception 'UNAUTHENTICATED';end if;
 if p_set_id is null or p_manifest_version is null or p_mode is null or p_mode not in ('real','virtual') then raise exception 'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended(case when p_mode='real' then 'pp-real:' else 'pp-pack:' end||owner::text,0));
 perform pg_advisory_xact_lock_shared(hashtextextended('pp-catalog-publication',0));
 progress:=public.b_collection_progress(p_set_id,p_manifest_version,p_mode);
 if p_mode='real' then
  select coalesce(jsonb_agg(jsonb_build_object('variant_id',i.card_variant_id,'quantity',i.quantity) order by i.card_variant_id),'[]'),
   coalesce(jsonb_object_agg(i.card_variant_id::text,i.notes),'{}') into entries,notes
  from public.real_inventory i join public.card_variants v on v.id=i.card_variant_id where i.user_id=owner and v.set_id=p_set_id;
 else
  select coalesce(jsonb_agg(jsonb_build_object('variant_id',i.card_variant_id,'quantity',i.quantity) order by i.card_variant_id),'[]') into entries
  from public.virtual_inventory i join public.card_variants v on v.id=i.card_variant_id where i.user_id=owner and v.set_id=p_set_id;
 end if;
 return jsonb_build_object('entries',entries,'realNotes',notes,'mode',p_mode,'progress',progress);
end $$;
revoke all on function public.b_collection_snapshot(uuid,text,text) from public,anon,authenticated;
grant execute on function public.b_collection_snapshot(uuid,text,text) to authenticated;
commit;
$pp_source_20261107050000$]);

-- SOURCE 20261107060000_b_metadata_provenance.sql

alter table public.tcg_sets add column metadata_source text not null default 'unreviewed' check(length(metadata_source) between 1 and 300);
alter table public.tcg_sets add column metadata_permission_evidence_url text;
alter table public.tcg_sets add column metadata_permission_checked_at timestamptz;
alter table public.tcg_sets add column simulation_permission_evidence_url text;
alter table public.tcg_sets add constraint b_non_demo_metadata_permission check(
 not public_metadata_allowed or is_demo or (metadata_source<>'unreviewed' and metadata_permission_evidence_url like 'https://%' and metadata_permission_evidence_url is not null and metadata_permission_checked_at is not null));
alter table public.tcg_sets add constraint b_non_demo_simulation_permission check(
 not enabled_for_simulation or is_demo or (simulation_permission_evidence_url is not null and simulation_permission_evidence_url like 'https://%'));


insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261107060000','b_metadata_provenance',array[$pp_source_20261107060000$begin;
alter table public.tcg_sets add column metadata_source text not null default 'unreviewed' check(length(metadata_source) between 1 and 300);
alter table public.tcg_sets add column metadata_permission_evidence_url text;
alter table public.tcg_sets add column metadata_permission_checked_at timestamptz;
alter table public.tcg_sets add column simulation_permission_evidence_url text;
alter table public.tcg_sets add constraint b_non_demo_metadata_permission check(
 not public_metadata_allowed or is_demo or (metadata_source<>'unreviewed' and metadata_permission_evidence_url like 'https://%' and metadata_permission_evidence_url is not null and metadata_permission_checked_at is not null));
alter table public.tcg_sets add constraint b_non_demo_simulation_permission check(
 not enabled_for_simulation or is_demo or (simulation_permission_evidence_url is not null and simulation_permission_evidence_url like 'https://%'));
commit;
$pp_source_20261107060000$]);

-- SOURCE 20261107070000_b_real_edit_idempotency.sql

create table public.b_real_edit_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 idempotency_key uuid not null, request_body jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(user_id,idempotency_key)
);
create index b_real_edit_rate on public.b_real_edit_requests(user_id,created_at);
alter table public.b_real_edit_requests enable row level security;
revoke all on public.b_real_edit_requests from public,anon,authenticated;
grant all on public.b_real_edit_requests to service_role;
grant select on public.b_real_edit_requests to authenticated;
create policy b_real_edit_owner on public.b_real_edit_requests for select to authenticated using(user_id=(select auth.uid()));
-- The original setter becomes an internal helper so direct authenticated RPC
-- callers cannot bypass request deduplication or manual-edit rate limits.
revoke execute on function public.b_edit_real_inventory(uuid,integer,text) from authenticated;
create function public.b_save_real_inventory(p_variant_id uuid,p_quantity integer,p_idempotency_key uuid,p_notes text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); body jsonb; prior public.b_real_edit_requests; result jsonb;
begin
 if owner is null then raise exception 'UNAUTHENTICATED';end if;
 if p_idempotency_key is null or p_variant_id is null or p_quantity is null then raise exception 'VALIDATION_ERROR';end if;
 body:=jsonb_build_object('card_variant_id',p_variant_id,'quantity',p_quantity,'notes',p_notes);
 perform pg_advisory_xact_lock(hashtextextended('pp-real:'||owner::text,0));
 select * into prior from public.b_real_edit_requests where user_id=owner and idempotency_key=p_idempotency_key;
 if found then if prior.request_body<>body then raise exception 'CONFLICT';end if;return prior.result;end if;
 perform public.b_assert_account_writable();
 if (select count(*) from public.b_real_edit_requests where user_id=owner and created_at>clock_timestamp()-interval '1 minute')>=50 or
    (select count(*) from public.b_real_edit_requests where user_id=owner and created_at>=((clock_timestamp() at time zone 'UTC')::date::timestamp at time zone 'UTC'))>=5000 then raise exception 'RATE_LIMITED';end if;
 perform public.b_edit_real_inventory(p_variant_id,p_quantity,p_notes);
 result:=jsonb_build_object('id',p_variant_id,'quantity',p_quantity);
 insert into public.b_real_edit_requests(user_id,idempotency_key,request_body,result) values(owner,p_idempotency_key,body,result);
 return result;
end $$;
revoke all on function public.b_save_real_inventory(uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.b_save_real_inventory(uuid,integer,uuid,text) to authenticated;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261107070000','b_real_edit_idempotency',array[$pp_source_20261107070000$begin;
create table public.b_real_edit_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 idempotency_key uuid not null, request_body jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(user_id,idempotency_key)
);
create index b_real_edit_rate on public.b_real_edit_requests(user_id,created_at);
alter table public.b_real_edit_requests enable row level security;
revoke all on public.b_real_edit_requests from public,anon,authenticated;
grant all on public.b_real_edit_requests to service_role;
grant select on public.b_real_edit_requests to authenticated;
create policy b_real_edit_owner on public.b_real_edit_requests for select to authenticated using(user_id=(select auth.uid()));
-- The original setter becomes an internal helper so direct authenticated RPC
-- callers cannot bypass request deduplication or manual-edit rate limits.
revoke execute on function public.b_edit_real_inventory(uuid,integer,text) from authenticated;
create function public.b_save_real_inventory(p_variant_id uuid,p_quantity integer,p_idempotency_key uuid,p_notes text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); body jsonb; prior public.b_real_edit_requests; result jsonb;
begin
 if owner is null then raise exception 'UNAUTHENTICATED';end if;
 if p_idempotency_key is null or p_variant_id is null or p_quantity is null then raise exception 'VALIDATION_ERROR';end if;
 body:=jsonb_build_object('card_variant_id',p_variant_id,'quantity',p_quantity,'notes',p_notes);
 perform pg_advisory_xact_lock(hashtextextended('pp-real:'||owner::text,0));
 select * into prior from public.b_real_edit_requests where user_id=owner and idempotency_key=p_idempotency_key;
 if found then if prior.request_body<>body then raise exception 'CONFLICT';end if;return prior.result;end if;
 perform public.b_assert_account_writable();
 if (select count(*) from public.b_real_edit_requests where user_id=owner and created_at>clock_timestamp()-interval '1 minute')>=50 or
    (select count(*) from public.b_real_edit_requests where user_id=owner and created_at>=((clock_timestamp() at time zone 'UTC')::date::timestamp at time zone 'UTC'))>=5000 then raise exception 'RATE_LIMITED';end if;
 perform public.b_edit_real_inventory(p_variant_id,p_quantity,p_notes);
 result:=jsonb_build_object('id',p_variant_id,'quantity',p_quantity);
 insert into public.b_real_edit_requests(user_id,idempotency_key,request_body,result) values(owner,p_idempotency_key,body,result);
 return result;
end $$;
revoke all on function public.b_save_real_inventory(uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.b_save_real_inventory(uuid,integer,uuid,text) to authenticated;
commit;
$pp_source_20261107070000$]);

-- ORIGINAL FICTIONAL STAGING SEED seed.sql
-- Local development only. Every seeded record is explicitly demo. Never load into production.
insert into public.retailers(id,name,website,is_demo) values ('00000000-0000-4000-8000-000000000020','Demo retailer','https://example.com/demo',true) on conflict do nothing;
insert into public.source_permissions(id,retailer_id,status,enabled,is_demo,allowed_hosts) values ('demo','00000000-0000-4000-8000-000000000020','candidate',false,true,array['example.com']) on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000001','demo-starlight-1','Demo Starlight 1','Original Demo Set 1',null,'multi_pack','en','US','exclusive variant 1',3,null,null,null,null,null,null,true,'acd739c06ff51d4fb9e39a00f60ffab3c41a395445180d9b23764904a44cacd9') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000002','demo-starlight-2','Demo Starlight 2','Original Demo Set 1',null,'booster_box','en','US','standard variant 2',12,null,null,null,null,null,null,true,'da1fd57e57d7ff80018df5631a086abf54300dcf27ace08265945bbfe815a44e') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000003','demo-starlight-3','Demo Starlight 3','Original Demo Set 1',null,'multi_pack','en','US','standard variant 3',3,null,null,null,null,null,null,true,'7a3a78099d1c80303b66e3f57394c5014cfa9c832ee4633223ac2af24e344ca7') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000004','demo-starlight-4','Demo Starlight 4','Original Demo Set 1',null,'booster_box','en','US','exclusive variant 4',12,null,null,null,null,null,null,true,'b952625ab86935a560512e21e18698bcaab59f4c9dfc13a23bb21f0abab0d602') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000005','demo-starlight-5','Demo Starlight 5','Original Demo Set 1',null,'multi_pack','en','US','standard variant 5',3,null,null,null,null,null,null,true,'e920fc221ec54d5cd156c2d2bd29c84427eb7898984073bbdaff1e13499d1e4c') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000006','demo-starlight-6','Demo Starlight 6','Original Demo Set 1',null,'booster_box','en','US','standard variant 6',12,null,null,null,null,null,null,true,'4e2e9740479aac2d3e449882ca23b76b897372810dfbcdd9665487454d4bd792') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000007','demo-starlight-7','Demo Starlight 7','Original Demo Set 1',null,'multi_pack','en','US','exclusive variant 7',3,null,null,null,null,null,null,true,'14589dcc34d7fef86c7cc810d4444a1865f58f8bf388b988f672a336b699470b') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000008','demo-starlight-8','Demo Starlight 8','Original Demo Set 1',null,'booster_box','en','US','standard variant 8',12,null,null,null,null,null,null,true,'5bc8b31700fe939ba70aa7977b9c6d0167a7bf53af792c1250db2c91b071d4b0') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000009','demo-starlight-9','Demo Starlight 9','Original Demo Set 1',null,'multi_pack','en','US','standard variant 9',3,null,null,null,null,null,null,true,'555d14537f3d432d577b6056775b9d52dae657333437305b5e03ea7d43221b51') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000010','demo-starlight-10','Demo Starlight 10','Original Demo Set 1',null,'booster_box','en','US','exclusive variant 10',12,null,null,null,null,null,null,true,'818f543932b1e9bd9a2ac71afbc77255591a74a618b411ceb4c9f972c19a9223') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000011','demo-starlight-11','Demo Starlight 11','Original Demo Set 2',null,'multi_pack','en','US','standard variant 11',3,null,null,null,null,null,null,true,'ae1a5d42a808d674d5293707345c9a68f5ce715cce68688973c4f48b59639744') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000012','demo-starlight-12','Demo Starlight 12','Original Demo Set 2',null,'booster_box','en','US','standard variant 12',12,null,null,null,null,null,null,true,'f10bad03b292433a25dd9e1b1a48098d188a2a7b5d2e642813b49e386be04864') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000013','demo-starlight-13','Demo Starlight 13','Original Demo Set 2',null,'multi_pack','en','US','exclusive variant 13',3,null,null,null,null,null,null,true,'74bdd7f2df51a1475b53ccd710417e49f34fc06b72ab2779134f09a028617cb8') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000014','demo-starlight-14','Demo Starlight 14','Original Demo Set 2',null,'booster_box','en','US','standard variant 14',12,null,null,null,null,null,null,true,'ea6ea4490ab24623c8c32403485817d7c33a0e4c4e3193c8383606acfd6b3072') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000015','demo-starlight-15','Demo Starlight 15','Original Demo Set 2',null,'multi_pack','en','US','standard variant 15',3,null,null,null,null,null,null,true,'aa739747d369d46aab80ff64e61b444b06699737d8c166c2f89cbac6a127c62b') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000016','demo-starlight-16','Demo Starlight 16','Original Demo Set 2',null,'booster_box','en','US','exclusive variant 16',12,null,null,null,null,null,null,true,'8bb5922d9389bb7c42b05dabe471294f8798a31597ebe4d9b8d292dc0fea3569') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000017','demo-starlight-17','Demo Starlight 17','Original Demo Set 2',null,'multi_pack','en','US','standard variant 17',3,null,null,null,null,null,null,true,'af266236f081ece25ad323996bf9a103245b05b545b6e0a00fa76f29926be03e') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000018','demo-starlight-18','Demo Starlight 18','Original Demo Set 2',null,'booster_box','en','US','standard variant 18',12,null,null,null,null,null,null,true,'0700462f13a4e46e3f0288b240444c4f656791175a89b770a173e78e2d31cc01') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000019','demo-starlight-19','Demo Starlight 19','Original Demo Set 2',null,'multi_pack','en','US','exclusive variant 19',3,null,null,null,null,null,null,true,'2340afadf4b38ab5539bc5fc54e74f0ce713323775679b0635c70a40502cdd5e') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000020','demo-starlight-20','Demo Starlight 20','Original Demo Set 2',null,'booster_box','en','US','standard variant 20',12,null,null,null,null,null,null,true,'06bd4962f63befed6c571c92412b9fccc241ec09b40b5f394c53c34aee7c511c') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000021','demo-starlight-21','Demo Starlight 21','Original Demo Set 3',null,'multi_pack','en','US','standard variant 21',3,null,null,null,null,null,null,true,'b0eea32d18b746dbcb1df4be76f579984d6a471102726b66c06fbe899e1273a0') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000022','demo-starlight-22','Demo Starlight 22','Original Demo Set 3',null,'booster_box','en','US','exclusive variant 22',12,null,null,null,null,null,null,true,'aaba2bfd645173864c04606e796de0d97534478c0b1b47e01b63cda9625b8b9a') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000023','demo-starlight-23','Demo Starlight 23','Original Demo Set 3',null,'multi_pack','en','US','standard variant 23',3,null,null,null,null,null,null,true,'5b1adcd8dbd84c27eb8ef83b78781cd3581a7ec838e19e89a9cafb381fbe3aa3') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000024','demo-starlight-24','Demo Starlight 24','Original Demo Set 3',null,'booster_box','en','US','standard variant 24',12,null,null,null,null,null,null,true,'20b1889806800bb8cd2cdd879b7be56a0598d324e168814f18b2a329d7adf411') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000025','demo-starlight-25','Demo Starlight 25','Original Demo Set 3',null,'multi_pack','en','US','exclusive variant 25',3,null,null,null,null,null,null,true,'0b4a5c222e208afa43919064f2d3688c4be5085a73fa0568f50bc2a5fa9915c7') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000026','demo-starlight-26','Demo Starlight 26','Original Demo Set 3',null,'booster_box','en','US','standard variant 26',12,null,null,null,null,null,null,true,'2b97887816ecf2114ff1f3e4e4e148285e810d17b45eb0588173d70679578ebc') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000027','demo-starlight-27','Demo Starlight 27','Original Demo Set 3',null,'multi_pack','en','US','standard variant 27',3,null,null,null,null,null,null,true,'b7e90fa722e64e4d1e347efcb1c6d3da6ecfba4ffc635017072e7978815a5f1a') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000028','demo-starlight-28','Demo Starlight 28','Original Demo Set 3',null,'booster_box','en','US','exclusive variant 28',12,null,null,null,null,null,null,true,'400fe28539abbb9e8077ad66fc580a98f8390b902930f054ec19d0aaa3f466e8') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000029','demo-starlight-29','Demo Starlight 29','Original Demo Set 3',null,'multi_pack','en','US','standard variant 29',3,null,null,null,null,null,null,true,'dd6336148857e7511de3d810586cd5a957bef69f7973bd403ca0559e25d5cc7f') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000030','demo-starlight-30','Demo Starlight 30','Original Demo Set 3',null,'booster_box','en','US','standard variant 30',12,null,null,null,null,null,null,true,'3e6e1303bd8c78bf21ef1a1d1971074e6f06b280844dce65bf64927c5511594c') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000031','demo-starlight-31','Demo Starlight 31','Original Demo Set 4',null,'multi_pack','en','US','exclusive variant 31',3,null,null,null,null,null,null,true,'a3ddbad389ef1ef2ac6fa7c919d290a37d6f1ad0dca5e353333dd50e79e1e10e') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000032','demo-starlight-32','Demo Starlight 32','Original Demo Set 4',null,'booster_box','en','US','standard variant 32',12,null,null,null,null,null,null,true,'a0c24a9ede166b3fafc4ac488fdf3432c0df050fe41ede21aefc4cb643db38c9') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000033','demo-starlight-33','Demo Starlight 33','Original Demo Set 4',null,'multi_pack','en','US','standard variant 33',3,null,null,null,null,null,null,true,'8cc375d50aca4c855809b6dcce1fe35395b3d04b6bb3a8a548766a00ff0d01d3') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000034','demo-starlight-34','Demo Starlight 34','Original Demo Set 4',null,'booster_box','en','US','exclusive variant 34',12,null,null,null,null,null,null,true,'c25755ab27e6d6a3b07c9e44d1bc4674344f2bc147839ff684ab79878ee375ab') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000035','demo-starlight-35','Demo Starlight 35','Original Demo Set 4',null,'multi_pack','en','US','standard variant 35',3,null,null,null,null,null,null,true,'f9b564922176e259bae79bfac8e0a9cb22a7a6485db7d99bd05baace01a7cb0a') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000036','demo-starlight-36','Demo Starlight 36','Original Demo Set 4',null,'booster_box','en','US','standard variant 36',12,null,null,null,null,null,null,true,'2cc4653cf8c9d7f10a9360e24a332d681c5c34f4744b98b473ee90a2449d2d40') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000037','demo-starlight-37','Demo Starlight 37','Original Demo Set 4',null,'multi_pack','en','US','exclusive variant 37',3,null,null,null,null,null,null,true,'a8cac04d52e74e525412103483ea92a1b8888ab31863261582fb002dfca392fe') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000038','demo-starlight-38','Demo Starlight 38','Original Demo Set 4',null,'booster_box','en','US','standard variant 38',12,null,null,null,null,null,null,true,'99800f94e32a77e1081429e2665528ae6fffcbda5a28e1693f4dec1cfc713bf9') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000039','demo-starlight-39','Demo Starlight 39','Original Demo Set 4',null,'multi_pack','en','US','standard variant 39',3,null,null,null,null,null,null,true,'b642cc78187a8582376d45bbeb66c9a7d9aca18c2f022b69837934b448de2314') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000040','demo-starlight-40','Demo Starlight 40','Original Demo Set 4',null,'booster_box','en','US','exclusive variant 40',12,null,null,null,null,null,null,true,'a2ca09c0695ceed72765ddf659f895396e45cdbd5453ff5c33ec3e1326aea597') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000041','demo-starlight-41','Demo Starlight 41','Original Demo Set 5',null,'multi_pack','en','US','standard variant 41',3,null,null,null,null,null,null,true,'a6f5452a07d26c53ddebe345a74176b7ae3461bf49daf11b4ddcfdf62a15b30d') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000042','demo-starlight-42','Demo Starlight 42','Original Demo Set 5',null,'booster_box','en','US','standard variant 42',12,null,null,null,null,null,null,true,'ac8395f750b209595383e5a97b45d9dfb5d98d1fa6d75bee50c79649d1bd6b61') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000043','demo-starlight-43','Demo Starlight 43','Original Demo Set 5',null,'multi_pack','en','US','exclusive variant 43',3,null,null,null,null,null,null,true,'6994aca1dbc3479ebd604faef916d00f395cbb877d16fe9b5bc4efbbc8be4986') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000044','demo-starlight-44','Demo Starlight 44','Original Demo Set 5',null,'booster_box','en','US','standard variant 44',12,null,null,null,null,null,null,true,'ee919f0264c45547940fa0a7bc426dee30193fb9b5b8043f61e4182eb4301d9a') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000045','demo-starlight-45','Demo Starlight 45','Original Demo Set 5',null,'multi_pack','en','US','standard variant 45',3,null,null,null,null,null,null,true,'4026d788cbdb59af9046078b7ff321c982cf80bedec18e12b20ae8d091662d99') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000046','demo-starlight-46','Demo Starlight 46','Original Demo Set 5',null,'booster_box','en','US','exclusive variant 46',12,null,null,null,null,null,null,true,'d741aeff61fdc5c85c775c9a22a63f73cf849e7db06e7b57cafaf7fb4580392c') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000047','demo-starlight-47','Demo Starlight 47','Original Demo Set 5',null,'multi_pack','en','US','standard variant 47',3,null,null,null,null,null,null,true,'23c89726c91a5790956133003d659545f55ad5fbe10e65eb692dba4fe9e85973') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000048','demo-starlight-48','Demo Starlight 48','Original Demo Set 5',null,'booster_box','en','US','standard variant 48',12,null,null,null,null,null,null,true,'534e19c6ee27730b8c7326655976e6473d7bbf7cb1314e4369979baa078fbe21') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000049','demo-starlight-49','Demo Starlight 49','Original Demo Set 5',null,'multi_pack','en','US','exclusive variant 49',3,null,null,null,null,null,null,true,'799398c2de572cb45d322cdb10b672b1ed0f0baea289d6e868264ba27d145fea') on conflict do nothing;
insert into public.products(id,slug,name,set_name,era,product_type,language,release_region,edition,pack_count,gtin,release_date,reference_price_minor,reference_price_currency,reference_price_source,image_url,is_demo,identity_key) values ('10000000-0000-4000-8000-000000000050','demo-starlight-50','Demo Starlight 50','Original Demo Set 5',null,'booster_box','en','US','standard variant 50',12,null,null,null,null,null,null,true,'d4aeecb36080e7c240b132b0f2d1073ce77cc8233a63701b38baad8622af43ba') on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000001','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',null,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000002','https://example.com/demo','third_party','demo-marketplace','ship_to_home','US',null,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000003','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',2099,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000005','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',2199,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000007','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',2299,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000009','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',2399,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000011','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',2499,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000013','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',2599,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000015','10000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000015','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',null,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000017','10000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000017','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',2799,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000019','10000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000019','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',2899,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000021','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',2999,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000023','10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000023','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',3099,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000025','10000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000025','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',3199,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000027','10000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000027','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',3299,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000029','10000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000029','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',null,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000016','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000031','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',3499,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000033','10000000-0000-4000-8000-000000000017','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000033','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',3599,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000035','10000000-0000-4000-8000-000000000018','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000035','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',3699,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000037','10000000-0000-4000-8000-000000000019','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000037','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',3799,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000039','10000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000039','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',3899,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000041','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',3999,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000043','10000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000043','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',null,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000045','10000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000045','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',4199,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000047','10000000-0000-4000-8000-000000000024','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000047','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',4299,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000049','10000000-0000-4000-8000-000000000025','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000049','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',4399,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000026','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000051','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',4499,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000053','10000000-0000-4000-8000-000000000027','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000053','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',4599,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000055','10000000-0000-4000-8000-000000000028','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000055','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',4699,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000057','10000000-0000-4000-8000-000000000029','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000057','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',null,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000059','10000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000059','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',4899,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000061','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',4999,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000063','10000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000063','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',5099,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000065','10000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000065','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',5199,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000067','10000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000067','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',5299,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000069','10000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000069','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',5399,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000036','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000071','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',null,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000073','10000000-0000-4000-8000-000000000037','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000073','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',5599,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000075','10000000-0000-4000-8000-000000000038','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000075','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',5699,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000077','10000000-0000-4000-8000-000000000039','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000077','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',5799,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000079','10000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000079','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',5899,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000081','10000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000081','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',5999,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000083','10000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000083','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',6099,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000085','10000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000085','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',null,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000087','10000000-0000-4000-8000-000000000044','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000087','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',6299,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000089','10000000-0000-4000-8000-000000000045','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000089','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',6399,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000046','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000091','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',6499,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000093','10000000-0000-4000-8000-000000000047','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000093','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',6599,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000095','10000000-0000-4000-8000-000000000048','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000095','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',6699,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000097','10000000-0000-4000-8000-000000000049','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000097','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',6799,'USD',true) on conflict do nothing;
insert into public.listings(id,product_id,retailer_id,source_id,source_item_id,retailer_url,seller_type,seller_id,channel,region_code,price_minor,currency,is_demo) values ('20000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000020','demo','20000000-0000-4000-8000-000000000099','https://example.com/demo','retailer','demo-retailer','ship_to_home','US',null,'USD',true) on conflict do nothing;


-- ORIGINAL FICTIONAL STAGING SEED seed-b.sql
-- Original fictional local fixtures only. Public flags and B settings remain OFF.
insert into public.tcg_sets(id,name,rights_status,enabled_for_simulation,is_demo,public_metadata_allowed,catalog_complete,metadata_source) values('10000000-0000-4000-8000-000000000001','Lumen Grove','approved',true,true,true,true,'Original fictional PokéPulse demo') on conflict do nothing;
insert into public.cards(id,set_id,card_number,card_name,inclusion_class,variant_scope_complete) values('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','001','Moss Courier','in_set',true) on conflict do nothing;
insert into public.cards(id,set_id,card_number,card_name,inclusion_class,variant_scope_complete) values('80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','002','Harbor Lantern','in_set',true) on conflict do nothing;
insert into public.cards(id,set_id,card_number,card_name,inclusion_class,variant_scope_complete) values('80000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','003','Cloud Archivist','in_set',true) on conflict do nothing;
insert into public.cards(id,set_id,card_number,card_name,inclusion_class,variant_scope_complete) values('80000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','P01','Moss Courier — Festival','promo',true) on conflict do nothing;
insert into public.card_variants(id,set_id,card_id,finish,rarity,eligible_for_packs,manifest_scope) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','standard',null,true,'in_set') on conflict do nothing;
insert into public.card_variants(id,set_id,card_id,finish,rarity,eligible_for_packs,manifest_scope) values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','foil',null,true,'in_set') on conflict do nothing;
insert into public.card_variants(id,set_id,card_id,finish,rarity,eligible_for_packs,manifest_scope) values('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','standard',null,true,'in_set') on conflict do nothing;
insert into public.card_variants(id,set_id,card_id,finish,rarity,eligible_for_packs,manifest_scope) values('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000003','foil',null,true,'in_set') on conflict do nothing;
insert into public.card_variants(id,set_id,card_id,finish,rarity,eligible_for_packs,manifest_scope) values('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000004','etched',null,false,'extended_only') on conflict do nothing;
insert into public.master_set_manifests(id,set_id,version,supported_goals) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fictional-1',array['base','master','extended']) on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','base','10000000-0000-4000-8000-000000000001:001','Explicit original fictional base requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','base','10000000-0000-4000-8000-000000000001:001','Explicit original fictional base requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','base','10000000-0000-4000-8000-000000000001:002','Explicit original fictional base requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','base','10000000-0000-4000-8000-000000000001:003','Explicit original fictional base requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','master','20000000-0000-4000-8000-000000000001','Explicit original fictional master requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','master','20000000-0000-4000-8000-000000000002','Explicit original fictional master requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','master','20000000-0000-4000-8000-000000000003','Explicit original fictional master requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','master','20000000-0000-4000-8000-000000000004','Explicit original fictional master requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','extended','20000000-0000-4000-8000-000000000001','Explicit original fictional extended requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','extended','20000000-0000-4000-8000-000000000002','Explicit original fictional extended requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','extended','20000000-0000-4000-8000-000000000003','Explicit original fictional extended requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','extended','20000000-0000-4000-8000-000000000004','Explicit original fictional extended requirement.') on conflict do nothing;
insert into public.master_set_requirements(manifest_id,set_id,variant_id,scope,collectible_key,rationale) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005','extended','20000000-0000-4000-8000-000000000005','Explicit original fictional extended requirement.') on conflict do nothing;
update public.master_set_manifests set validated=true,published_at=now() where id='60000000-0000-4000-8000-000000000001' and not validated;
insert into public.pack_odds_versions(id,set_id,version,active,fictional,methodology,price_coins) values('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fictional-1',true,true,'Original fictional two-slot model; no relationship to physical pack odds.',10) on conflict do nothing;
insert into public.pack_slot_rules(odds_id,set_id,slot_index,variant_id,weight) values('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',0,'20000000-0000-4000-8000-000000000001',1) on conflict do nothing;
insert into public.pack_slot_rules(odds_id,set_id,slot_index,variant_id,weight) values('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',0,'20000000-0000-4000-8000-000000000003',1) on conflict do nothing;
insert into public.pack_slot_rules(odds_id,set_id,slot_index,variant_id,weight) values('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'20000000-0000-4000-8000-000000000001',70) on conflict do nothing;
insert into public.pack_slot_rules(odds_id,set_id,slot_index,variant_id,weight) values('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'20000000-0000-4000-8000-000000000002',25) on conflict do nothing;
insert into public.pack_slot_rules(odds_id,set_id,slot_index,variant_id,weight) values('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'20000000-0000-4000-8000-000000000004',5) on conflict do nothing;
insert into public.stores(id,name,address,region,zip,latitude,longitude,directory_source,rights_approved,is_demo) values('30000000-0000-4000-8000-000000000001','Lumen Demo Store','Fictional address — do not visit','DEMO','00000',0,0,'Original synthetic directory',true,true) on conflict do nothing;
insert into public.b_zip_centroids(zip,latitude,longitude,source,rights_approved,is_demo) values('00000',0,0,'Original synthetic centroid; not a real ZIP',true,true) on conflict do nothing;


commit;
select json_build_object(
 'migrations',(select count(*) from supabase_migrations.schema_migrations),
 'public_tables',(select count(*) from pg_tables where schemaname='public'),
 'tables_without_rls',(select count(*) from pg_tables where schemaname='public' and not rowsecurity),
 'demo_products',(select count(*) from public.products where is_demo),
 'demo_variants',(select count(*) from public.card_variants),
 'enabled_flags',(select count(*) from public.feature_flags where enabled),
 'pack_enabled',(select enabled from public.b_pack_settings),
 'radar_enabled',(select enabled from public.b_radar_settings)
) as initialization_verification;
