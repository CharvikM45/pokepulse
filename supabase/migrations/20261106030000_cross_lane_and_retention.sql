begin;
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
