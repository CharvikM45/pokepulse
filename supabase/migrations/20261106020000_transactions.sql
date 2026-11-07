begin;
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
