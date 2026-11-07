-- A-01 only. No user tables; A-02 introduces profiles and their policies.
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
