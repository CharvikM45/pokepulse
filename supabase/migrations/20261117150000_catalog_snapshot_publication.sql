begin;
create function public.c_publish_catalog_snapshot(p_revision text,p_cards integer,p_variants integer,p_sets integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actual_cards bigint;actual_variants bigint;actual_sets bigint;begin
 if p_revision !~ '^[a-f0-9]{40}$' or p_cards<1 or p_variants<1 or p_sets<1 then raise exception 'INVALID_SNAPSHOT';end if;
 if not exists(select 1 from public.card_provider_permissions where id='tcgdex' and enabled and metadata_approved and retention_approved) then raise exception 'PROVIDER_NOT_APPROVED';end if;
 select count(*) into actual_cards from public.cards where provider_id='tcgdex' and metadata->>'source_revision'=p_revision;
 select count(*) into actual_variants from public.card_variants v join public.cards c on c.id=v.card_id where c.provider_id='tcgdex' and c.metadata->>'source_revision'=p_revision;
 select count(*) into actual_sets from public.tcg_sets where provider_id='tcgdex' and metadata_source='TCGdex metadata source '||p_revision;
 if (actual_cards,actual_variants,actual_sets) is distinct from (p_cards::bigint,p_variants::bigint,p_sets::bigint) then raise exception 'SNAPSHOT_COUNT_MISMATCH: cards %, variants %, sets %',actual_cards,actual_variants,actual_sets;end if;
 update public.tcg_sets set public_metadata_allowed=true where provider_id='tcgdex' and metadata_source='TCGdex metadata source '||p_revision;
 return public.c_catalog_coverage();
end $$;
revoke all on function public.c_publish_catalog_snapshot(text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.c_publish_catalog_snapshot(text,integer,integer,integer) to service_role;
commit;
