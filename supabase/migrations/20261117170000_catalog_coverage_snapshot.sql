begin;
create table public.card_catalog_coverage_snapshot (
 id boolean primary key default true check(id),metrics jsonb not null,permission_key text not null,observed_at timestamptz not null default now()
);
alter table public.card_catalog_coverage_snapshot enable row level security;
revoke all on public.card_catalog_coverage_snapshot from public,anon,authenticated;
grant all on public.card_catalog_coverage_snapshot to service_role;
create function public.c_compute_catalog_coverage() returns jsonb language sql stable security definer set search_path='' as $$
with visible as materialized (
 select id,set_id,language,artists from public.c_visible_cards
), totals as (
 select count(*) as printings,count(distinct set_id) as sets,jsonb_agg(distinct language) as languages from visible
), variants as (
 select count(*) as total from public.card_variants v join visible c on c.id=v.card_id
), artists as (
 select count(distinct a) as total from visible c cross join lateral unnest(c.artists) a
)
select jsonb_build_object('printings',t.printings,'variants',v.total,'sets',t.sets,'artists',a.total,
 'languages',coalesce(t.languages,'[]'::jsonb),
 'approved_providers',coalesce((select jsonb_agg(id) from public.card_provider_permissions where enabled and metadata_approved and retention_approved),'[]'::jsonb),
 'art_enabled',exists(select 1 from public.feature_flags where name='licensed_card_art' and enabled),'measured_at',now())
from totals t cross join variants v cross join artists a
$$;
revoke all on function public.c_compute_catalog_coverage() from public,anon,authenticated;
grant execute on function public.c_compute_catalog_coverage() to service_role;
create function public.c_catalog_permission_key() returns text language sql stable security definer set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(id,enabled,metadata_approved,retention_approved) order by id)::text,'[]')) from public.card_provider_permissions
$$;
revoke all on function public.c_catalog_permission_key() from public,anon,authenticated;
grant execute on function public.c_catalog_permission_key() to service_role;
create function public.c_refresh_catalog_coverage() returns jsonb language plpgsql security definer set search_path='' as $$
declare metrics jsonb;begin
 metrics:=public.c_compute_catalog_coverage();
 insert into public.card_catalog_coverage_snapshot(id,metrics,permission_key) values(true,metrics,public.c_catalog_permission_key()) on conflict(id) do update set metrics=excluded.metrics,permission_key=excluded.permission_key,observed_at=now();
 return metrics;
end $$;
revoke all on function public.c_refresh_catalog_coverage() from public,anon,authenticated;
grant execute on function public.c_refresh_catalog_coverage() to service_role;
create or replace function public.c_catalog_coverage() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare metrics jsonb;begin
 select s.metrics into metrics from public.card_catalog_coverage_snapshot s where id and permission_key=public.c_catalog_permission_key();
 if metrics is null then return public.c_compute_catalog_coverage();end if;
 return jsonb_set(metrics,'{art_enabled}',to_jsonb(exists(select 1 from public.feature_flags where name='licensed_card_art' and enabled)));
end $$;
create function public.c_invalidate_catalog_coverage() returns trigger language plpgsql security definer set search_path='' as $$begin
 delete from public.card_catalog_coverage_snapshot;return null;
end $$;
revoke all on function public.c_invalidate_catalog_coverage() from public,anon,authenticated;
create trigger c_coverage_cards after insert or update or delete on public.cards for each statement execute function public.c_invalidate_catalog_coverage();
create trigger c_coverage_variants after insert or update or delete on public.card_variants for each statement execute function public.c_invalidate_catalog_coverage();
create trigger c_coverage_sets after insert or update or delete on public.tcg_sets for each statement execute function public.c_invalidate_catalog_coverage();
commit;
