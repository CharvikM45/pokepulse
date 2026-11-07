begin;
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
