begin;
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
