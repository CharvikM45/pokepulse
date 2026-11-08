-- CONTRACT-02: bind B outbox and current-signal checks to A's transactional worker.
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
