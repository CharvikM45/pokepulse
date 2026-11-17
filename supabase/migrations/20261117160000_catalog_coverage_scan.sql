begin;
-- Reuse the gated visible-card projection instead of scanning the full catalog five times.
create or replace function public.c_catalog_coverage() returns jsonb language sql stable security definer set search_path='' as $$
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
commit;
