-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned draft. Supabase auth.uid()/auth.jwt()/auth.users are platform prerequisites.
-- Staff convention is proposed app_metadata.pokepulse_staff=true; reconcile with A.
-- product_id's A-owned FK/canonical-product validation remains an integration task.
begin;
create table public.b_radar_settings (
  singleton boolean primary key default true check(singleton), enabled boolean not null default false,
  allow_demo boolean not null default false,
  report_ttl_minutes integer not null default 240 check(report_ttl_minutes between 1 and 1440),
  cooldown_seconds integer not null default 300 check(cooldown_seconds between 1 and 86400),
  daily_report_cap integer not null default 10 check(daily_report_cap between 1 and 100)
);
insert into public.b_radar_settings(singleton) values(true);
create table public.stores (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 160),
  address text, region text, zip text check(zip~'^[0-9]{5}$'),
  latitude double precision check(latitude between -90 and 90),
  longitude double precision check(longitude between -180 and 180),
  directory_source text not null check(length(directory_source) between 1 and 160),
  rights_approved boolean not null default false, is_demo boolean not null default true,
  check((latitude is null)=(longitude is null))
);
create table public.b_zip_centroids (
  zip text primary key check(zip~'^[0-9]{5}$'), latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  source text not null, rights_approved boolean not null default false, is_demo boolean not null default true
);
create table public.sightings (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id), product_id uuid references public.products(id),
  report_type text not null check(report_type in ('found_stock','shelf_empty')),
  submitted_at timestamptz not null default now(), observed_at timestamptz not null, expires_at timestamptz not null,
  moderation text not null default 'pending' check(moderation in ('pending','approved','rejected','expired')),
  private_notes text not null default '' check(length(private_notes)<=280), public_notes text check(length(public_notes)<=280),
  is_demo boolean not null default true, revision integer not null default 0 check(revision>=0),
  idempotency_key uuid not null, request_body jsonb not null,
  unique(reporter_id,idempotency_key),check(expires_at>observed_at)
);
create index b_sighting_public_store on public.sightings(store_id,observed_at desc,id) where moderation='approved';
create index b_sighting_owner_submitted on public.sightings(reporter_id,submitted_at desc);
create table public.sighting_confirmations (
  sighting_id uuid not null references public.sightings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(),
  primary key(sighting_id,user_id)
);
create table public.sighting_moderation_actions (
  id uuid primary key default gen_random_uuid(), sighting_id uuid not null references public.sightings(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  previous_state text not null, next_state text not null, revision integer not null,
  reason text not null check(length(reason) between 1 and 500), created_at timestamptz not null default now(),
  idempotency_key uuid, request_body jsonb not null,
  unique(actor_id,idempotency_key), unique(sighting_id,revision)
);
create table public.b_sighting_outbox (
  id uuid primary key default gen_random_uuid(), sighting_id uuid not null references public.sightings(id) on delete cascade,
  revision integer not null, event_type text not null check(event_type in ('sighting_approved','sighting_withdrawn')),
  envelope jsonb not null, created_at timestamptz not null default now(), delivered_at timestamptz,
  unique(sighting_id,revision,event_type)
);

create function public.b_is_staff() returns boolean language sql stable set search_path=pg_catalog,public as $$
  select public.is_staff()
$$;
revoke all on function public.b_is_staff() from public,anon,authenticated;
grant execute on function public.b_is_staff() to authenticated,service_role;

alter table public.b_radar_settings enable row level security;
alter table public.stores enable row level security;
alter table public.b_zip_centroids enable row level security;
alter table public.sightings enable row level security;
alter table public.sighting_confirmations enable row level security;
alter table public.sighting_moderation_actions enable row level security;
alter table public.b_sighting_outbox enable row level security;
revoke all on public.b_radar_settings,public.stores,public.b_zip_centroids,public.sightings,
  public.sighting_confirmations,public.sighting_moderation_actions,public.b_sighting_outbox from public,anon,authenticated;
grant all on public.b_radar_settings,public.stores,public.b_zip_centroids,public.sightings,
  public.sighting_confirmations,public.sighting_moderation_actions,public.b_sighting_outbox to service_role;
grant select on public.sightings,public.sighting_confirmations,public.sighting_moderation_actions to authenticated;
create policy b_private_reports on public.sightings for select to authenticated using(
  reporter_id=(select auth.uid()) or (select public.b_is_staff()));
create policy b_private_confirmations on public.sighting_confirmations for select to authenticated using(user_id=(select auth.uid()));
create policy b_moderation_staff on public.sighting_moderation_actions for select to authenticated using((select public.b_is_staff()));

create function public.b_safe_report_notes(p_notes text) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
  select p_notes is not null and length(p_notes)<=280 and p_notes !~ '[<>[:cntrl:]]' and
    p_notes !~* '(https?://|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[+]?[0-9][0-9 ().-]{7,}[0-9])'
$$;
revoke all on function public.b_safe_report_notes(text) from public,anon,authenticated;

-- This is the sole public report projection. No author, private notes, request body,
-- staff IDs or location trails. Expiry is evaluated at every read, independent of cron.
create function public.b_public_sightings(p_store_id uuid,p_limit integer default 20,
  p_before_observed timestamptz default null,p_before_id uuid default null)
returns table(id uuid,store_id uuid,product_id uuid,report_type text,submitted_at timestamptz,
  observed_at timestamptz,expires_at timestamptz,moderation text,independent_confirmations bigint,
  conflict_count bigint,is_demo boolean,public_notes text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_settings public.b_radar_settings%rowtype;
begin
  if p_store_id is null or p_limit is null or p_limit<1 or p_limit>50 or
    ((p_before_observed is null)<>(p_before_id is null)) then raise exception 'VALIDATION_ERROR'; end if;
  select * into strict v_settings from public.b_radar_settings where singleton;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  return query select s.id,s.store_id,s.product_id,s.report_type,s.submitted_at,s.observed_at,s.expires_at,s.moderation,
    (select count(distinct c.user_id) from public.sighting_confirmations c where c.sighting_id=s.id and c.user_id<>s.reporter_id),
    (select count(distinct other.reporter_id) from public.sightings other
      where other.store_id=s.store_id and other.product_id is not distinct from s.product_id and
      other.report_type<>s.report_type and other.reporter_id<>s.reporter_id and other.moderation='approved' and
      other.expires_at>statement_timestamp() and other.observed_at<=statement_timestamp() and (not other.is_demo or v_settings.allow_demo)),
    s.is_demo,s.public_notes from public.sightings s join public.stores st on st.id=s.store_id
    where s.store_id=p_store_id and s.moderation='approved' and s.expires_at>statement_timestamp() and s.observed_at<=statement_timestamp() and
      (not s.is_demo or v_settings.allow_demo) and st.rights_approved and (not st.is_demo or v_settings.allow_demo) and
      (p_before_observed is null or s.observed_at<p_before_observed or (s.observed_at=p_before_observed and s.id>p_before_id))
    order by s.observed_at desc,s.id limit p_limit;
end $$;
revoke all on function public.b_public_sightings(uuid,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.b_public_sightings(uuid,integer,timestamptz,uuid) to anon,authenticated,service_role;

create function public.b_submit_sighting(p_store_id uuid,p_product_id uuid,p_report_type text,
  p_observed_at timestamptz,p_notes text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_settings public.b_radar_settings%rowtype; v_store public.stores%rowtype;
  v_prior public.sightings%rowtype; v_body jsonb; v_id uuid:=gen_random_uuid(); v_now timestamptz:=transaction_timestamp();
begin
  if v_user is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_store_id is null or p_idempotency_key is null or p_report_type is null or p_report_type not in ('found_stock','shelf_empty') or
    p_observed_at is null or not public.b_safe_report_notes(p_notes) then raise exception 'VALIDATION_ERROR'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-sighting:'||v_user::text,0));
  v_body:=jsonb_build_object('store_id',p_store_id,'product_id',p_product_id,'report_type',p_report_type,
    'observed_at',to_char(p_observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'notes',btrim(p_notes));
  select * into v_prior from public.sightings where reporter_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_body<>v_body then raise exception 'CONFLICT'; end if;
    return jsonb_build_object('id',v_prior.id,'moderation',v_prior.moderation,'submitted_at',
      to_char(v_prior.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end if;
  if p_observed_at>v_now or p_observed_at<v_now-interval '24 hours' then raise exception 'VALIDATION_ERROR'; end if;
  perform public.b_assert_account_writable();
  select * into strict v_settings from public.b_radar_settings where singleton for share;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into v_store from public.stores where id=p_store_id for share;
  if not found or not v_store.rights_approved or (v_store.is_demo and not v_settings.allow_demo) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  if exists(select 1 from public.sightings where reporter_id=v_user and
      submitted_at>v_now-make_interval(secs=>v_settings.cooldown_seconds)) or
     (select count(*) from public.sightings where reporter_id=v_user and
       submitted_at>=((v_now at time zone 'UTC')::date::timestamp at time zone 'UTC'))>=v_settings.daily_report_cap
    then raise exception 'RATE_LIMITED'; end if;
  if exists(select 1 from public.sightings where reporter_id=v_user and store_id=p_store_id and
    product_id is not distinct from p_product_id and moderation<>'rejected' and expires_at>v_now) then raise exception 'CONFLICT'; end if;
  insert into public.sightings(id,reporter_id,store_id,product_id,report_type,submitted_at,observed_at,expires_at,
    private_notes,is_demo,idempotency_key,request_body)
    values(v_id,v_user,p_store_id,p_product_id,p_report_type,v_now,p_observed_at,
      p_observed_at+make_interval(mins=>v_settings.report_ttl_minutes),btrim(p_notes),v_store.is_demo,p_idempotency_key,v_body);
  return jsonb_build_object('id',v_id,'moderation','pending','submitted_at',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;
revoke all on function public.b_submit_sighting(uuid,uuid,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.b_submit_sighting(uuid,uuid,text,timestamptz,text,uuid) to authenticated;

create function public.b_moderate_sighting(p_sighting_id uuid,p_decision text,p_reason text,
  p_public_notes text,p_idempotency_key uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid(); v_report public.sightings%rowtype; v_prior public.sighting_moderation_actions%rowtype;
  v_body jsonb; v_revision integer; v_event_id uuid; v_event_type text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN'; end if;
  if p_sighting_id is null or p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0 or p_decision is null or p_decision not in ('approved','rejected') or
    p_reason is null or length(btrim(p_reason)) not between 1 and 500 or
    (p_public_notes is not null and not public.b_safe_report_notes(p_public_notes)) then raise exception 'VALIDATION_ERROR'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-moderator:'||v_actor::text,0));
  v_body:=jsonb_build_object('sighting_id',p_sighting_id,'decision',p_decision,'reason',btrim(p_reason),'public_notes',p_public_notes,'expected_revision',p_expected_revision);
  select * into v_prior from public.sighting_moderation_actions where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_body<>v_body then raise exception 'CONFLICT'; end if;
    return jsonb_build_object('id',v_prior.sighting_id,'moderation',v_prior.next_state,'revision',v_prior.revision);
  end if;
  perform public.b_assert_account_writable();
  select * into v_report from public.sightings where id=p_sighting_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_report.reporter_id=v_actor then raise exception 'FORBIDDEN'; end if;
  if v_report.revision<>p_expected_revision then raise exception 'CONFLICT';end if;
  if v_report.moderation=p_decision or v_report.moderation='expired' or
    (p_decision='approved' and v_report.expires_at<=clock_timestamp()) then raise exception 'CONFLICT'; end if;
  v_revision:=v_report.revision+1;
  update public.sightings set moderation=p_decision,revision=v_revision,
    public_notes=case when p_decision='approved' then nullif(btrim(p_public_notes),'') else null end where id=p_sighting_id;
  insert into public.sighting_moderation_actions(sighting_id,actor_id,previous_state,next_state,revision,reason,idempotency_key,request_body)
    values(p_sighting_id,v_actor,v_report.moderation,p_decision,v_revision,btrim(p_reason),p_idempotency_key,v_body);
  if p_decision='approved' or v_report.moderation='approved' then
    v_event_id:=gen_random_uuid();
    v_event_type:=case when p_decision='approved' then 'sighting_approved' else 'sighting_withdrawn' end;
    insert into public.b_sighting_outbox(id,sighting_id,revision,event_type,envelope) values(v_event_id,p_sighting_id,v_revision,v_event_type,
      jsonb_build_object('version',1,'type',v_event_type,'event_id',v_event_id,'sighting_id',p_sighting_id,
        'revision',v_revision,'store_id',v_report.store_id,'product_id',v_report.product_id,'report_type',v_report.report_type,
        'evidence_type','moderated_report','observed_at',to_char(v_report.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'expires_at',to_char(v_report.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'is_demo',v_report.is_demo));
  end if;
  return jsonb_build_object('id',p_sighting_id,'moderation',p_decision,'revision',v_revision);
end $$;
revoke all on function public.b_moderate_sighting(uuid,text,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.b_moderate_sighting(uuid,text,text,text,uuid,integer) to authenticated;

create function public.b_confirm_sighting(p_sighting_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_report public.sightings%rowtype; v_settings public.b_radar_settings%rowtype;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-sighting:'||v_user::text,0));
  perform public.b_assert_account_writable();
  select * into strict v_settings from public.b_radar_settings where singleton for share;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into v_report from public.sightings where id=p_sighting_id for share;
  if not found or v_report.moderation<>'approved' or v_report.expires_at<=clock_timestamp() or
    (v_report.is_demo and not v_settings.allow_demo) then raise exception 'NOT_FOUND'; end if;
  if not exists(select 1 from public.stores where id=v_report.store_id and rights_approved and
    (not is_demo or v_settings.allow_demo)) then raise exception 'NOT_FOUND'; end if;
  if v_report.reporter_id=v_user then raise exception 'FORBIDDEN'; end if;
  insert into public.sighting_confirmations(sighting_id,user_id) values(p_sighting_id,v_user) on conflict do nothing;
end $$;
revoke all on function public.b_confirm_sighting(uuid) from public,anon,authenticated;
grant execute on function public.b_confirm_sighting(uuid) to authenticated;

-- A's worker must recheck this signal before matching AND before sending. Never
-- infer fresh stock solely from a previously queued approval envelope.
create function public.b_current_sighting_signal(p_sighting_id uuid,p_revision integer) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.sightings s join public.b_radar_settings cfg on cfg.singleton
    join public.stores st on st.id=s.store_id
    where s.id=p_sighting_id and s.revision=p_revision and s.moderation='approved' and s.expires_at>statement_timestamp() and
      s.observed_at<=statement_timestamp() and cfg.enabled and exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) and st.rights_approved and
      (not s.is_demo or cfg.allow_demo) and (not st.is_demo or cfg.allow_demo))
$$;
revoke all on function public.b_current_sighting_signal(uuid,integer) from public,anon,authenticated;
grant execute on function public.b_current_sighting_signal(uuid,integer) to service_role;

create function public.b_expire_sightings(p_limit integer default 100) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_report public.sightings%rowtype; v_id uuid; v_count integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'VALIDATION_ERROR'; end if;
  for v_report in select * from public.sightings where moderation in ('pending','approved') and expires_at<=now()
    order by expires_at,id limit p_limit for update skip locked loop
    update public.sightings set moderation='expired',public_notes=null,revision=revision+1 where id=v_report.id;
    insert into public.sighting_moderation_actions(sighting_id,previous_state,next_state,revision,reason,request_body)
      values(v_report.id,v_report.moderation,'expired',v_report.revision+1,'Configured report expiry','{}');
    if v_report.moderation='approved' then
      v_id:=gen_random_uuid();
      insert into public.b_sighting_outbox(id,sighting_id,revision,event_type,envelope)
        values(v_id,v_report.id,v_report.revision+1,'sighting_withdrawn',jsonb_build_object(
          'version',1,'type','sighting_withdrawn','event_id',v_id,'sighting_id',v_report.id,'revision',v_report.revision+1,
          'evidence_type','moderated_report','expires_at',to_char(v_report.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'is_demo',v_report.is_demo));
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.b_expire_sightings(integer) from public,anon,authenticated;
grant execute on function public.b_expire_sightings(integer) to service_role;

create function public.b_nearby_stores(p_zip text,p_radius_mi integer,p_limit integer default 20,
  p_after_distance_milli integer default null,p_after_id uuid default null)
returns table(id uuid,name text,address text,region text,zip text,distance_mi numeric,
  latitude double precision,longitude double precision,directory_source text,is_demo boolean)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_settings public.b_radar_settings%rowtype; v_centroid public.b_zip_centroids%rowtype;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' or p_radius_mi is null or p_radius_mi<1 or p_radius_mi>100 or
    p_limit is null or p_limit<1 or p_limit>50 or ((p_after_distance_milli is null)<>(p_after_id is null)) or
    p_after_distance_milli<0 then raise exception 'VALIDATION_ERROR'; end if;
  select * into strict v_settings from public.b_radar_settings where singleton;
  if not v_settings.enabled or not exists(select 1 from public.feature_flags f where f.name='local_radar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into v_centroid from public.b_zip_centroids z where z.zip=p_zip and z.rights_approved and
    (not z.is_demo or v_settings.allow_demo);
  if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
  return query with measured as (
    select st.*,3958.7613*acos(least(1.0,greatest(-1.0,
      sin(radians(v_centroid.latitude))*sin(radians(st.latitude))+
      cos(radians(v_centroid.latitude))*cos(radians(st.latitude))*cos(radians(st.longitude-v_centroid.longitude))))) miles
    from public.stores st where st.rights_approved and (not st.is_demo or v_settings.allow_demo) and st.latitude is not null
  ), located as (select measured.*,round((miles*1000)::numeric)::integer distance_milli from measured where miles<=p_radius_mi)
  select located.id,located.name,located.address,located.region,located.zip,located.distance_milli::numeric/1000,
    located.latitude,located.longitude,located.directory_source,located.is_demo from located
    where p_after_distance_milli is null or located.distance_milli>p_after_distance_milli or
      (located.distance_milli=p_after_distance_milli and located.id>p_after_id)
    order by located.distance_milli,located.id limit p_limit;
end $$;
revoke all on function public.b_nearby_stores(text,integer,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.b_nearby_stores(text,integer,integer,integer,uuid) to anon,authenticated,service_role;
commit;
