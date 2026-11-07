-- Developer B integration: additive migration on A platform e9dba87. Gates default off.
-- B-owned draft; requires pack tables and Radar's trusted b_is_staff() helper.
-- Publication snapshots are immutable. No denominators inferred from card totals.
begin;
alter table public.tcg_sets add column catalog_complete boolean not null default false;
alter table public.cards add column inclusion_class text not null default 'unknown'
  check(inclusion_class in ('in_set','promo','special','unknown'));
alter table public.cards add column variant_scope_complete boolean not null default false;
alter table public.card_variants add column manifest_scope text not null default 'unknown'
  check(manifest_scope in ('in_set','extended_only','unknown'));
alter table public.master_set_manifests add column withdrawn_at timestamptz;
alter table public.master_set_manifests add column withdrawal_reason text;
alter table public.master_set_manifests add constraint b_manifest_publication_state check(
  (not validated or published_at is not null) and
  ((withdrawn_at is null and withdrawal_reason is null) or
   (validated and withdrawn_at is not null and withdrawal_reason is not null and length(btrim(withdrawal_reason)) between 1 and 500)));
create table public.b_manifest_actions (
  id uuid primary key default gen_random_uuid(),manifest_id uuid not null references public.master_set_manifests(id),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in ('publish','withdraw')),reason text not null check(length(reason) between 1 and 500),
  idempotency_key uuid not null,request_body jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key)
);
alter table public.b_manifest_actions enable row level security;
revoke all on public.b_manifest_actions from public,anon,authenticated;
grant all on public.b_manifest_actions to service_role;
grant select on public.b_manifest_actions to authenticated;
create policy b_manifest_staff_audit on public.b_manifest_actions for select to authenticated using((select public.b_is_staff()));

-- Serialize publication against catalog writes at statement start, before row
-- locks are taken. This avoids update-row -> set-lock inversions with pack draws.
create function public.b_catalog_publication_lock() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin perform pg_advisory_xact_lock(hashtextextended('pp-catalog-publication',0));return null;end $$;
create trigger b_sets_publication_lock before insert or update or delete on public.tcg_sets
  for each statement execute function public.b_catalog_publication_lock();
create trigger b_cards_publication_lock before insert or update or delete on public.cards
  for each statement execute function public.b_catalog_publication_lock();
create trigger b_variants_publication_lock before insert or update or delete on public.card_variants
  for each statement execute function public.b_catalog_publication_lock();

create function public.b_validate_manifest(p_id uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare v_manifest public.master_set_manifests%rowtype;v_set public.tcg_sets%rowtype;v_goal text;
begin
  select * into strict v_manifest from public.master_set_manifests where id=p_id;
  select * into strict v_set from public.tcg_sets where id=v_manifest.set_id;
  if not v_set.catalog_complete or v_set.rights_status='disabled' or
    not ('base'=any(v_manifest.supported_goals)) or
    cardinality(v_manifest.supported_goals)<>(select count(distinct x) from unnest(v_manifest.supported_goals) x) or
    exists(select 1 from public.cards where set_id=v_set.id and inclusion_class='unknown')
    then raise exception 'INCOMPLETE_MANIFEST';end if;
  foreach v_goal in array v_manifest.supported_goals loop
    if not exists(select 1 from public.master_set_requirements where manifest_id=p_id and scope=v_goal)
      then raise exception 'EMPTY_GOAL';end if;
  end loop;
  if exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
    join public.cards c on c.id=cv.card_id where r.manifest_id=p_id and
    ((r.scope in ('base','master') and (c.inclusion_class<>'in_set' or cv.manifest_scope<>'in_set')) or
      (r.scope='extended' and (c.inclusion_class='unknown' or cv.manifest_scope='unknown')) or
      not (r.scope=any(v_manifest.supported_goals)))) then raise exception 'INVALID_REQUIREMENT';end if;
  -- One Base group is one numbered card, with alternatives only for that card.
  if exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
    where r.manifest_id=p_id and r.scope='base' group by r.collectible_key having count(distinct cv.card_id)<>1) or
    exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
    where r.manifest_id=p_id and r.scope='base' group by cv.card_id having count(distinct r.collectible_key)<>1)
    then raise exception 'INVALID_BASE_GROUP';end if;
  if exists(select 1 from public.cards c where c.set_id=v_set.id and c.inclusion_class='in_set' and
    not exists(select 1 from public.master_set_requirements r join public.card_variants cv on cv.id=r.variant_id
      where r.manifest_id=p_id and r.scope='base' and cv.card_id=c.id)) or
    exists(select 1 from public.card_variants cv join public.cards c on c.id=cv.card_id
      where cv.set_id=v_set.id and c.inclusion_class='in_set' and cv.manifest_scope='in_set' and
      not exists(select 1 from public.master_set_requirements r where r.manifest_id=p_id and r.scope='base' and r.variant_id=cv.id))
    then raise exception 'INCOMPLETE_BASE';end if;
  if 'master'=any(v_manifest.supported_goals) and (
    exists(select 1 from public.cards where set_id=v_set.id and inclusion_class='in_set' and not variant_scope_complete) or
    exists(select 1 from public.card_variants cv join public.cards c on c.id=cv.card_id where cv.set_id=v_set.id and c.inclusion_class='in_set' and cv.manifest_scope='unknown') or
    exists(select 1 from public.card_variants cv join public.cards c on c.id=cv.card_id where cv.set_id=v_set.id and c.inclusion_class='in_set' and cv.manifest_scope='in_set' and
      not exists(select 1 from public.master_set_requirements r where r.manifest_id=p_id and r.scope='master' and r.variant_id=cv.id)))
    then raise exception 'INCOMPLETE_MASTER';end if;
end $$;

create function public.b_manifest_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' then
    if new.validated or new.published_at is not null or new.withdrawn_at is not null then raise exception 'DRAFT_REQUIRED';end if;
    return new;
  end if;
  if old.validated then
    if tg_op='DELETE' then raise exception 'IMMUTABLE_MANIFEST';end if;
    if (to_jsonb(new)-'withdrawn_at'-'withdrawal_reason') is distinct from (to_jsonb(old)-'withdrawn_at'-'withdrawal_reason') or
      old.withdrawn_at is not null or new.withdrawn_at is null then raise exception 'IMMUTABLE_MANIFEST';end if;
  elsif tg_op='UPDATE' and new.validated then
    if (to_jsonb(new)-'validated'-'published_at') is distinct from (to_jsonb(old)-'validated'-'published_at') then raise exception 'DRAFT_CHANGES_REQUIRED';end if;
    perform public.b_validate_manifest(old.id);
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_manifest_immutable before insert or update or delete on public.master_set_manifests
  for each row execute function public.b_manifest_guard();
create function public.b_requirement_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare v_id uuid;v_validated boolean;
begin
  if tg_op='UPDATE' and new.manifest_id<>old.manifest_id then raise exception 'IMMUTABLE_MANIFEST_REFERENCE';end if;
  v_id:=case when tg_op='DELETE' then old.manifest_id else new.manifest_id end;
  select validated into v_validated from public.master_set_manifests where id=v_id for update;
  if v_validated then raise exception 'IMMUTABLE_MANIFEST';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_requirement_immutable before insert or update or delete on public.master_set_requirements
  for each row execute function public.b_requirement_guard();

create function public.b_variant_identity_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.master_set_requirements r join public.master_set_manifests m on m.id=r.manifest_id
    where r.variant_id=old.id and m.validated) and (tg_op='DELETE' or
      (to_jsonb(new)-'image_url'-'image_rights_cleared'-'eligible_for_packs'-'rarity') is distinct from
      (to_jsonb(old)-'image_url'-'image_rights_cleared'-'eligible_for_packs'-'rarity')) then raise exception 'IMMUTABLE_VARIANT_IDENTITY';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_variant_identity before update or delete on public.card_variants for each row execute function public.b_variant_identity_guard();
create function public.b_card_identity_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.card_variants cv join public.master_set_requirements r on r.variant_id=cv.id
    join public.master_set_manifests m on m.id=r.manifest_id where cv.card_id=old.id and m.validated) and
    (tg_op='DELETE' or (to_jsonb(new)-'card_name'-'variant_scope_complete') is distinct from (to_jsonb(old)-'card_name'-'variant_scope_complete'))
    then raise exception 'IMMUTABLE_CARD_IDENTITY';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger b_card_identity before update or delete on public.cards for each row execute function public.b_card_identity_guard();

create function public.b_publish_manifest(p_id uuid,p_reason text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_prior public.b_manifest_actions%rowtype;v_manifest public.master_set_manifests%rowtype;v_body jsonb;v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN';end if;
  if p_id is null or p_idempotency_key is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'VALIDATION_ERROR';end if;
  v_body:=jsonb_build_object('manifest_id',p_id,'reason',btrim(p_reason),'action','publish');
  perform pg_advisory_xact_lock(hashtextextended('pp-manifest-editor:'||v_user::text,0));
  select * into v_prior from public.b_manifest_actions where actor_id=v_user and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_body<>v_body then raise exception 'CONFLICT';end if;return v_prior.result;end if;
  perform public.b_assert_account_writable();
  perform pg_advisory_xact_lock(hashtextextended('pp-catalog-publication',0));
  select * into v_manifest from public.master_set_manifests where id=p_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if v_manifest.validated or v_manifest.withdrawn_at is not null then raise exception 'CONFLICT';end if;
  update public.master_set_manifests set validated=true,published_at=clock_timestamp() where id=p_id;
  v_result:=jsonb_build_object('manifest_id',p_id,'set_id',v_manifest.set_id,'version',v_manifest.version,'status','published');
  insert into public.b_manifest_actions(manifest_id,actor_id,action,reason,idempotency_key,request_body,result)
    values(p_id,v_user,'publish',btrim(p_reason),p_idempotency_key,v_body,v_result);
  return v_result;
end $$;

create function public.b_withdraw_manifest(p_id uuid,p_reason text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_prior public.b_manifest_actions%rowtype;v_manifest public.master_set_manifests%rowtype;v_body jsonb;v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.b_is_staff() then raise exception 'FORBIDDEN';end if;
  if p_id is null or p_idempotency_key is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'VALIDATION_ERROR';end if;
  v_body:=jsonb_build_object('manifest_id',p_id,'reason',btrim(p_reason),'action','withdraw');
  perform pg_advisory_xact_lock(hashtextextended('pp-manifest-editor:'||v_user::text,0));
  select * into v_prior from public.b_manifest_actions where actor_id=v_user and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_body<>v_body then raise exception 'CONFLICT';end if;return v_prior.result;end if;
  perform public.b_assert_account_writable();
  select * into v_manifest from public.master_set_manifests where id=p_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if not v_manifest.validated or v_manifest.withdrawn_at is not null then raise exception 'CONFLICT';end if;
  update public.master_set_manifests set withdrawn_at=clock_timestamp(),withdrawal_reason=btrim(p_reason) where id=p_id;
  v_result:=jsonb_build_object('manifest_id',p_id,'set_id',v_manifest.set_id,'version',v_manifest.version,'status','withdrawn');
  insert into public.b_manifest_actions(manifest_id,actor_id,action,reason,idempotency_key,request_body,result)
    values(p_id,v_user,'withdraw',btrim(p_reason),p_idempotency_key,v_body,v_result);
  return v_result;
end $$;

create function public.b_collection_progress(p_set_id uuid,p_manifest_version text,p_mode text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_manifest public.master_set_manifests%rowtype;v_goal text;v_required integer;v_collected integer;v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if p_set_id is null or p_manifest_version is null or p_mode is null or p_mode not in ('real','virtual') then raise exception 'VALIDATION_ERROR';end if;
  select * into v_manifest from public.master_set_manifests where set_id=p_set_id and version=p_manifest_version and validated and withdrawn_at is null;
  if not found then raise exception 'INCOMPLETE_MANIFEST';end if;
  if not exists(select 1 from public.tcg_sets where id=p_set_id and rights_status<>'disabled') then raise exception 'RIGHTS_DISABLED';end if;
  v_result:=jsonb_build_object('set_id',p_set_id,'mode',p_mode,'manifest_version',p_manifest_version);
  foreach v_goal in array array['base','master','extended'] loop
    v_required:=null;v_collected:=null;
    if v_goal=any(v_manifest.supported_goals) then
      with owned as (
        select card_variant_id from public.real_inventory where p_mode='real' and user_id=v_user and quantity>0
        union all select card_variant_id from public.virtual_inventory where p_mode='virtual' and user_id=v_user and quantity>0
      ), grouped as (
        select r.collectible_key,bool_or(o.card_variant_id is not null) present from public.master_set_requirements r
        left join owned o on o.card_variant_id=r.variant_id where r.manifest_id=v_manifest.id and r.scope=v_goal group by r.collectible_key
      ) select count(*)::integer,count(*) filter(where present)::integer into v_required,v_collected from grouped;
    end if;
    v_result:=v_result||jsonb_build_object(v_goal||'_collected',v_collected,v_goal||'_required',v_required);
  end loop;
  return v_result;
end $$;
create function public.b_missing_collection(p_set_id uuid,p_manifest_version text,p_mode text,p_goal text,
  p_limit integer default 20,p_after_key text default null)
returns table(collectible_key text,variant_ids uuid[])
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid();v_manifest public.master_set_manifests%rowtype;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED';end if;
  if p_set_id is null or p_manifest_version is null or p_mode is null or p_mode not in ('real','virtual') or
    p_goal is null or p_goal not in ('base','master','extended') or p_limit is null or p_limit<1 or p_limit>50 or length(p_after_key)>160
    then raise exception 'VALIDATION_ERROR';end if;
  select * into v_manifest from public.master_set_manifests where set_id=p_set_id and version=p_manifest_version and validated and withdrawn_at is null;
  if not found then raise exception 'INCOMPLETE_MANIFEST';end if;
  if not (p_goal=any(v_manifest.supported_goals)) then raise exception 'INCOMPLETE_GOAL';end if;
  if not exists(select 1 from public.tcg_sets where id=p_set_id and rights_status<>'disabled') then raise exception 'RIGHTS_DISABLED';end if;
  return query with owned as (
    select card_variant_id from public.real_inventory where p_mode='real' and user_id=v_user and quantity>0
    union all select card_variant_id from public.virtual_inventory where p_mode='virtual' and user_id=v_user and quantity>0
  ), grouped as (
    select r.collectible_key,array_agg(r.variant_id order by r.variant_id) variants,bool_or(o.card_variant_id is not null) present
    from public.master_set_requirements r left join owned o on o.card_variant_id=r.variant_id
    where r.manifest_id=v_manifest.id and r.scope=p_goal group by r.collectible_key
  ) select grouped.collectible_key,grouped.variants from grouped where not present and
    (p_after_key is null or grouped.collectible_key collate "C">p_after_key collate "C")
    order by grouped.collectible_key collate "C" limit p_limit;
end $$;
revoke all on function public.b_catalog_publication_lock(),public.b_validate_manifest(uuid),public.b_manifest_guard(),
  public.b_requirement_guard(),public.b_variant_identity_guard(),public.b_card_identity_guard() from public,anon,authenticated;
revoke all on function public.b_publish_manifest(uuid,text,uuid),public.b_withdraw_manifest(uuid,text,uuid),
  public.b_collection_progress(uuid,text,text),public.b_missing_collection(uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.b_publish_manifest(uuid,text,uuid),public.b_withdraw_manifest(uuid,text,uuid),
  public.b_collection_progress(uuid,text,text),public.b_missing_collection(uuid,text,text,text,integer,text) to authenticated;
commit;
