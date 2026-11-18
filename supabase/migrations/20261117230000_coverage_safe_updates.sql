begin;
create or replace function public.c_invalidate_catalog_coverage() returns trigger language plpgsql security definer set search_path='' as $$begin
 delete from public.card_catalog_coverage_snapshot where id=true;return null;
end $$;
commit;
