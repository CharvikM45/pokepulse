-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned draft, requires the Radar proposal's trusted b_is_staff() helper.
-- Nullable unknown dates and demo provenance require the shared contract review.
-- No fabricated release seed data and no external fetches are included.
begin;
create table public.b_calendar_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,allow_demo boolean not null default false
);
insert into public.b_calendar_settings(singleton) values(true);
create table public.b_release_source_hosts (
  host text primary key check(host=lower(host) and host~'^[a-z0-9][a-z0-9.-]*[a-z0-9]$' and position('..' in host)=0),
  approved boolean not null default false, permission_notes text not null check(length(permission_notes) between 1 and 1000)
);
create table public.releases (
  id uuid primary key default gen_random_uuid(),product_id uuid references public.products(id),
  name text not null check(length(name) between 1 and 160),
  release_date date,date_precision text not null check(date_precision in ('day','month','unconfirmed')),
  event_type text not null check(event_type in ('release','preorder','announcement')),
  region text check(length(region) between 1 and 32),source_url text not null check(length(source_url)<=2048),
  source_host text not null references public.b_release_source_hosts(host),verified_at timestamptz not null,
  is_demo boolean not null default true,status text not null default 'published' check(status in ('published','withdrawn')),
  revision integer not null check(revision>0),updated_at timestamptz not null default now(),
  check((date_precision='unconfirmed' and release_date is null) or
    (date_precision='day' and release_date is not null) or
    (date_precision='month' and release_date is not null and extract(day from release_date)=1))
);
create index b_release_calendar_order on public.releases(release_date asc nulls last,id) where status='published';
create table public.release_edit_history (
  id uuid primary key default gen_random_uuid(),release_id uuid not null references public.releases(id),
  actor_id uuid references auth.users(id) on delete set null,
  revision integer not null,previous_record jsonb,next_record jsonb not null,reason text not null check(length(reason) between 1 and 500),
  idempotency_key uuid not null,request_body jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key),unique(release_id,revision)
);
alter table public.b_calendar_settings enable row level security;
alter table public.b_release_source_hosts enable row level security;
alter table public.releases enable row level security;
alter table public.release_edit_history enable row level security;
revoke all on public.b_calendar_settings,public.b_release_source_hosts,public.releases,public.release_edit_history from public,anon,authenticated;
grant all on public.b_calendar_settings,public.b_release_source_hosts,public.releases,public.release_edit_history to service_role;
grant select on public.release_edit_history to authenticated;
create policy b_release_history_staff on public.release_edit_history for select to authenticated using((select public.b_is_staff()));

create function public.b_release_projection(p_record public.releases) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',p_record.id,'product_id',p_record.product_id,'name',p_record.name,
    'date',to_char(p_record.release_date,'YYYY-MM-DD'),'date_precision',p_record.date_precision,
    'event_type',p_record.event_type,'region',p_record.region,'source_url',p_record.source_url,
    'verified_at',to_char(p_record.verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'is_demo',p_record.is_demo,'revision',p_record.revision)
$$;
revoke all on function public.b_release_projection(public.releases) from public,anon,authenticated;

-- p_input is a B proposal; the eventual route validates the approved shared Zod
-- schema first. SQL repeats validation for direct RPC callers.
create function public.b_curate_release(p_release_id uuid,p_expected_revision integer,
  p_input jsonb,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid();v_prior public.release_edit_history%rowtype;
  v_old public.releases%rowtype;v_new public.releases%rowtype;v_body jsonb;v_result jsonb;
  v_id uuid:=coalesce(p_release_id,gen_random_uuid());v_host text;v_url text;v_verified timestamptz;
  v_date date;v_product uuid;v_region text;v_demo boolean;v_status text;v_precision text;v_kind text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN';end if;
  if p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0 or
    jsonb_typeof(p_input) is distinct from 'object' or p_reason is null or length(btrim(p_reason)) not between 1 and 500
    then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in
    ('name','product_id','date','date_precision','event_type','region','source_url','verified_at','is_demo','status')) or
    not p_input ?& array['name','product_id','date','date_precision','event_type','region','source_url','verified_at','is_demo','status']
    then raise exception 'VALIDATION_ERROR';end if;
  perform pg_advisory_xact_lock(hashtextextended('pp-release-editor:'||v_actor::text,0));
  -- Normalize date/UUID/time input before comparing idempotency identity.
  begin
    v_precision:=p_input->>'date_precision';v_kind:=p_input->>'event_type';v_status:=p_input->>'status';
    v_product:=(p_input->>'product_id')::uuid;v_date:=(p_input->>'date')::date;
    v_verified:=(p_input->>'verified_at')::timestamptz;v_demo:=(p_input->>'is_demo')::boolean;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'VALIDATION_ERROR';end;
  v_region:=nullif(btrim(p_input->>'region'),'');v_url:=p_input->>'source_url';
  if jsonb_typeof(p_input->'name') is distinct from 'string' or length(btrim(p_input->>'name')) not between 1 and 160 or
    v_precision is null or v_precision not in ('day','month','unconfirmed') or v_kind is null or v_kind not in ('release','preorder','announcement') or
    v_status is null or v_status not in ('published','withdrawn') or jsonb_typeof(p_input->'is_demo') is distinct from 'boolean' or
    (p_input->'product_id'<>'null'::jsonb and jsonb_typeof(p_input->'product_id')<>'string') or
    (p_input->'region'<>'null'::jsonb and jsonb_typeof(p_input->'region')<>'string') or length(v_region)>32 or
    (v_precision='unconfirmed' and v_date is not null) or (v_precision<>'unconfirmed' and v_date is null) or
    (v_date is not null and (jsonb_typeof(p_input->'date') is distinct from 'string' or (p_input->>'date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) or
    (v_precision='month' and extract(day from v_date)<>1) or v_verified is null or not isfinite(v_verified) or
    v_verified>clock_timestamp() or jsonb_typeof(p_input->'verified_at') is distinct from 'string' or
    (p_input->>'verified_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$' or
    v_url is null or length(v_url)>2048 or v_url !~ '^https://[a-z0-9.-]+(/[^[:space:]]*)?$'
    then raise exception 'VALIDATION_ERROR';end if;
  v_host:=substring(v_url from '^https://([^/]+)');
  v_body:=jsonb_build_object('release_id',p_release_id,'expected_revision',p_expected_revision,'reason',btrim(p_reason),
    'input',p_input||jsonb_build_object('name',btrim(p_input->>'name'),'product_id',v_product,'region',v_region,
      'verified_at',to_char(v_verified at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  select * into v_prior from public.release_edit_history where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_body<>v_body then raise exception 'CONFLICT';end if;return v_prior.result;end if;
  perform public.b_assert_account_writable();
  perform 1 from public.b_release_source_hosts where host=v_host and approved for share;
  if not found then raise exception 'SOURCE_UNAVAILABLE';end if;
  -- A shared row lock is unnecessary for creation: the UUID PK also resolves a
  -- competing explicit-ID create atomically. Existing edits use revision checks.
  select * into v_old from public.releases where id=v_id for update;
  if found then
    if p_release_id is null or v_old.revision<>p_expected_revision then raise exception 'CONFLICT';end if;
    update public.releases set product_id=v_product,name=btrim(p_input->>'name'),release_date=v_date,date_precision=v_precision,
      event_type=v_kind,region=v_region,source_url=v_url,source_host=v_host,verified_at=v_verified,is_demo=v_demo,
      status=v_status,revision=revision+1,updated_at=clock_timestamp() where id=v_id returning * into v_new;
  else
    if p_expected_revision<>0 then raise exception 'CONFLICT';end if;
    begin
      insert into public.releases(id,product_id,name,release_date,date_precision,event_type,region,source_url,source_host,verified_at,is_demo,status,revision)
        values(v_id,v_product,btrim(p_input->>'name'),v_date,v_precision,v_kind,v_region,v_url,v_host,v_verified,v_demo,v_status,1) returning * into v_new;
    exception when unique_violation then raise exception 'CONFLICT';end;
  end if;
  v_result:=public.b_release_projection(v_new);
  insert into public.release_edit_history(release_id,actor_id,revision,previous_record,next_record,reason,idempotency_key,request_body,result)
    values(v_id,v_actor,v_new.revision,case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new),btrim(p_reason),p_idempotency_key,v_body,v_result);
  return v_result;
end $$;
revoke all on function public.b_curate_release(uuid,integer,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.b_curate_release(uuid,integer,jsonb,text,uuid) to authenticated;

create function public.b_public_releases(p_region text default null,p_event_type text default null,p_limit integer default 20,
  p_after_date date default null,p_after_id uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_cfg public.b_calendar_settings%rowtype;v_release public.releases%rowtype;
begin
  if p_limit is null or p_limit<1 or p_limit>50 or length(p_region)>32 or
    (p_event_type is not null and p_event_type not in ('release','preorder','announcement')) or
    (p_after_id is null and p_after_date is not null) then raise exception 'VALIDATION_ERROR';end if;
  select * into strict v_cfg from public.b_calendar_settings where singleton;
  if not v_cfg.enabled or not exists(select 1 from public.feature_flags f where f.name='calendar' and f.enabled) then raise exception 'SOURCE_UNAVAILABLE';end if;
  for v_release in select r.* from public.releases r join public.b_release_source_hosts h on h.host=r.source_host
    where r.status='published' and h.approved and (not r.is_demo or v_cfg.allow_demo) and
      (p_region is null or r.region=p_region) and (p_event_type is null or r.event_type=p_event_type) and
      (p_after_id is null or (p_after_date is not null and (r.release_date is null or r.release_date>p_after_date or
        (r.release_date=p_after_date and r.id>p_after_id))) or (p_after_date is null and r.release_date is null and r.id>p_after_id))
    order by r.release_date asc nulls last,r.id limit p_limit
  loop return next public.b_release_projection(v_release);end loop;
end $$;
revoke all on function public.b_public_releases(text,text,integer,date,uuid) from public,anon,authenticated;
grant execute on function public.b_public_releases(text,text,integer,date,uuid) to anon,authenticated,service_role;
commit;
