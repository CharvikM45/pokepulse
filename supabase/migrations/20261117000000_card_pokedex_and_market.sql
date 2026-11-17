begin;
-- Separate permissions: card metadata is not retailer stock, image, or simulation permission.
create table public.card_provider_permissions (
 id text primary key check(id ~ '^[a-z0-9_-]{1,40}$'), metadata_approved boolean not null default false,
 artwork_approved boolean not null default false, pricing_approved boolean not null default false,
 retention_approved boolean not null default false, enabled boolean not null default false,
 evidence_url text, reviewer text, checked_at timestamptz, allowed_image_hosts text[] not null default '{}',
 check(not (metadata_approved or artwork_approved or pricing_approved or retention_approved) or
 (evidence_url like 'https://%' and length(reviewer)>0 and checked_at is not null))
);
insert into public.card_provider_permissions(id) values('tcgdex'),('scrydex');
alter table public.tcg_sets add column provider_id text references public.card_provider_permissions(id),
 add column provider_set_id text, add column language text, add column region text, add column series text,
 add column release_precision text check(release_precision in ('day','month','year','unknown')),
 add column synchronized_at timestamptz, add column source_url text;
create unique index c_provider_sets on public.tcg_sets(provider_id,language,provider_set_id);
alter table public.cards add column provider_id text references public.card_provider_permissions(id),
 add column provider_card_id text, add column language text, add column category text, add column stage text,
 add column hp integer check(hp>=0), add column types text[] not null default '{}',
 add column pokedex_numbers integer[] not null default '{}', add column artists text[] not null default '{}',
 add column rarity_original text, add column rarity_normalized text, add column metadata jsonb not null default '{}',
 add column source_url text, add column synchronized_at timestamptz;
create unique index c_provider_cards on public.cards(provider_id,language,provider_card_id);
create index c_cards_name on public.cards(lower(card_name),id);
create index c_cards_name_prefix on public.cards(lower(card_name) text_pattern_ops,id);
create index c_cards_text on public.cards using gin(to_tsvector('simple',card_name));
create index c_cards_types on public.cards using gin(types);
create index c_cards_dex on public.cards using gin(pokedex_numbers);
create index c_cards_artists on public.cards using gin(artists);
create index c_cards_rarity on public.cards(rarity_normalized,id);
alter table public.card_variants add column edition text not null default '' check(length(edition)<=80), add column print_markers jsonb not null default '{}';
alter table public.card_variants drop constraint card_variants_card_id_finish_key;
create unique index c_variant_finish_edition on public.card_variants(card_id,finish,edition);
create table public.card_artists(id uuid primary key default gen_random_uuid(), name text not null unique);
create table public.card_artist_credits(card_id uuid not null references public.cards(id) on delete cascade, artist_id uuid not null references public.card_artists(id), primary key(card_id,artist_id));
create table public.card_provider_aliases(provider_id text not null references public.card_provider_permissions(id), language text not null, entity_kind text not null check(entity_kind in ('set','card')), external_id text not null, entity_id uuid not null, primary key(provider_id,language,entity_kind,external_id));
create table public.card_sync_runs (
 id uuid primary key default gen_random_uuid(), provider_id text not null references public.card_provider_permissions(id),
 language text not null check(language in ('en','ja')), status text not null default 'pending' check(status in ('pending','running','completed','failed','blocked')),
 checkpoint jsonb not null default '{}', added integer not null default 0, updated integer not null default 0, skipped integer not null default 0,
 errors jsonb not null default '[]', started_at timestamptz not null default now(), finished_at timestamptz,
 lease_until timestamptz, updated_at timestamptz not null default now()
);
create unique index c_one_running_sync on public.card_sync_runs(provider_id,language) where status='running';
create table public.card_price_observations (
 id uuid primary key default gen_random_uuid(), variant_id uuid not null references public.card_variants(id),
 provider_id text not null references public.card_provider_permissions(id), condition text not null default 'unknown',
 grading_company text not null default '', grade text not null default '', currency text not null check(currency ~ '^[A-Z]{3}$'),
 statistic text not null check(statistic in ('market','median','low','user_reference')), amount_minor bigint not null check(amount_minor between 0 and 1000000000000),
 observed_at timestamptz not null, captured_at timestamptz not null default now(), source_url text not null check(source_url like 'https://%'),
 check(observed_at<=captured_at), check((grading_company='' and grade='') or (grading_company<>'' and grade<>'')),
 unique(variant_id,provider_id,condition,grading_company,grade,currency,statistic,observed_at)
);
create index c_price_history on public.card_price_observations(variant_id,currency,condition,grading_company,grade,statistic,observed_at desc,id);
create table public.card_actions (
 user_id uuid not null references auth.users(id) on delete cascade, card_id uuid not null references public.cards(id),
 kind text not null check(kind in ('favorite','wishlist')), created_at timestamptz not null default now(), primary key(user_id,card_id,kind)
);
create index c_popularity on public.card_actions(card_id,kind);
create table public.physical_copy_lots (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, variant_id uuid not null,
 quantity integer not null check(quantity between 1 and 9999), condition text not null check(condition in ('unknown','near_mint','lightly_played','moderately_played','heavily_played','damaged')),
 grading_company text not null default '' check(length(grading_company)<=40), grade text not null default '' check(length(grade)<=20),
 acquired_on date, cost_minor bigint check(cost_minor between 0 and 1000000000000), currency text check(currency ~ '^[A-Z]{3}$'),
 notes text not null default '' check(length(notes)<=500), binder text not null default '' check(length(binder)<=100),
 page integer check(page between 1 and 1000), position integer check(position between 1 and 100), created_at timestamptz not null default now(),
 foreign key(user_id,variant_id) references public.real_inventory(user_id,card_variant_id) on delete cascade,
 check((cost_minor is null)=(currency is null)), check((grading_company='' and grade='') or (grading_company<>'' and grade<>''))
);
create index c_lots_owner on public.physical_copy_lots(user_id,created_at desc,id);
create table public.portfolio_snapshots (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 currency text not null, statistic text not null, captured_at timestamptz not null default now(), result jsonb not null,
 kind text not null default 'observed' check(kind='observed')
);
create index c_snapshots_owner on public.portfolio_snapshots(user_id,currency,statistic,captured_at,id);
-- All new tables deny direct mutation. Public access uses bounded, gated RPCs only.
do $$ declare t text;begin
 foreach t in array array['card_provider_permissions','card_artists','card_artist_credits','card_provider_aliases','card_sync_runs','card_price_observations','card_actions','physical_copy_lots','portfolio_snapshots'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant select on public.card_actions,public.physical_copy_lots,public.portfolio_snapshots to authenticated;
create policy c_actions_owner on public.card_actions for select to authenticated using(user_id=(select auth.uid()));
create policy c_lots_owner on public.physical_copy_lots for select to authenticated using(user_id=(select auth.uid()));
create policy c_snapshots_owner on public.portfolio_snapshots for select to authenticated using(user_id=(select auth.uid()));
-- A price is never ingested without independent display and retention permission.
create function public.c_check_price_permission() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.card_provider_permissions where id=new.provider_id and enabled and pricing_approved and retention_approved) then raise exception 'RIGHTS_DISABLED';end if;
 return new;end $$;
create trigger c_price_permission before insert or update on public.card_price_observations for each row execute function public.c_check_price_permission();
revoke all on function public.c_check_price_permission() from public,anon,authenticated;
-- Retain the existing aggregate inventory as the only quantity source of truth.
create function public.c_reconcile_lots() returns trigger language plpgsql security definer set search_path='' as $$
declare excess bigint; lot public.physical_copy_lots;begin
 select coalesce(sum(quantity),0)-new.quantity into excess from public.physical_copy_lots where user_id=new.user_id and variant_id=new.card_variant_id;
 if excess>0 then
 for lot in select * from public.physical_copy_lots where user_id=new.user_id and variant_id=new.card_variant_id order by created_at desc,id desc for update loop
 if excess>=lot.quantity then delete from public.physical_copy_lots where id=lot.id;excess:=excess-lot.quantity;
 else update public.physical_copy_lots set cost_minor=case when cost_minor is null then null else round(cost_minor::numeric*(quantity-excess)/quantity)::bigint end,quantity=quantity-excess where id=lot.id;excess:=0;end if;
 exit when excess=0;
 end loop;end if;return new;end $$;
create trigger c_real_lot_reconcile after update of quantity on public.real_inventory for each row execute function public.c_reconcile_lots();
revoke all on function public.c_reconcile_lots() from public,anon,authenticated;

create view public.c_visible_cards as
select c.*, s.name as set_name,s.series,s.release_date,s.region,
 s.provider_set_id,s.metadata_source,s.rights_status,
 p.artwork_approved,p.allowed_image_hosts
from public.cards c join public.tcg_sets s on s.id=c.set_id
join public.card_provider_permissions p on p.id=c.provider_id
where p.enabled and p.metadata_approved and p.retention_approved and s.public_metadata_allowed and s.rights_status<>'disabled' and not s.is_demo;
revoke all on public.c_visible_cards from public,anon,authenticated;
grant select on public.c_visible_cards to service_role;
create view public.c_approved_prices as select o.* from public.card_price_observations o
join public.card_provider_permissions p on p.id=o.provider_id where p.enabled and p.pricing_approved and p.retention_approved;
revoke all on public.c_approved_prices from public,anon,authenticated;
grant select on public.c_approved_prices to service_role;
create function public.c_card_json(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.card_name,'number',c.card_number,'set_id',c.set_id,'set_name',c.set_name,
 'language',c.language,'region',c.region,'series',c.series,'release_date',c.release_date,'artists',c.artists,'types',c.types,'pokedex_numbers',c.pokedex_numbers,
 'rarity',c.rarity_normalized,'rarity_original',c.rarity_original,'category',c.category,'stage',c.stage,'hp',c.hp,
 'metadata',c.metadata,'source_url',c.source_url,'synchronized_at',c.synchronized_at,
 'favorites',(select count(*) from public.card_actions where card_id=c.id and kind='favorite'),
 'reference_prices',coalesce((select jsonb_agg(o) from(select distinct on (p.variant_id,p.currency) p.* from public.c_approved_prices p join public.card_variants v on v.id=p.variant_id where v.card_id=c.id and p.condition='unknown' and p.grade='' and p.statistic='market' order by p.variant_id,p.currency,p.observed_at desc,p.id limit 20)o),'[]'::jsonb),
 'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'set_id',v.set_id,'card_name',c.card_name,'card_number',c.card_number,
 'finish',v.finish,'edition',v.edition,'print_markers',v.print_markers,'rarity',v.rarity,'eligible_for_packs',v.eligible_for_packs,
 'image_url',case when v.image_rights_cleared and c.artwork_approved and exists(select 1 from public.feature_flags where name='licensed_card_art' and enabled)
 and split_part(split_part(v.image_url,'://',2),'/',1)=any(c.allowed_image_hosts) then v.image_url else null end,
 'image_rights_cleared',v.image_rights_cleared and c.artwork_approved and exists(select 1 from public.feature_flags where name='licensed_card_art' and enabled)) order by v.finish,v.id) from public.card_variants v where v.card_id=c.id),'[]'::jsonb))
 from public.c_visible_cards c where c.id=p_id
$$;
revoke all on function public.c_card_json(uuid) from public,anon,authenticated;
grant execute on function public.c_card_json(uuid) to service_role;

create function public.c_search_cards(p_filters jsonb default '{}',p_limit integer default 24,p_after jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if p_limit<1 or p_limit>50 or p_limit is null or length(p_filters::text)>5000 then raise exception 'VALIDATION_ERROR';end if;
 if p_filters->>'ownership' in ('owned','missing') and auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
 with candidates as (
 select c.id,c.card_name,c.release_date,
 (select min(latest.amount_minor) from public.card_variants v join lateral(select o.amount_minor from public.c_approved_prices o where o.variant_id=v.id and o.currency=coalesce(p_filters->>'currency','USD') and o.statistic='market' and o.condition='unknown' and o.grade='' and o.observed_at>now()-interval '7 days' order by o.observed_at desc,o.id limit 1) latest on true where v.card_id=c.id) as price,
 (select count(*) from public.card_actions where card_id=c.id and kind='favorite') as popularity
 from public.c_visible_cards c
 where (not p_filters ? 'q' or (to_tsvector('simple',c.card_name) @@ plainto_tsquery('simple',p_filters->>'q') or lower(c.card_name) like lower(replace(replace(replace(p_filters->>'q','\','\\'),'%','\%'),'_','\_'))||'%'))
 and (not p_filters ? 'artist' or c.artists && array(select jsonb_array_elements_text(p_filters->'artist')))
 and (not p_filters ? 'set_id' or c.set_id::text=p_filters->>'set_id')
 and (not p_filters ? 'series' or c.series=p_filters->>'series')
 and (not p_filters ? 'language' or c.language=p_filters->>'language')
 and (not p_filters ? 'rarity' or c.rarity_normalized=any(array(select jsonb_array_elements_text(p_filters->'rarity'))))
 and (not p_filters ? 'type' or c.types && array(select jsonb_array_elements_text(p_filters->'type')))
 and (not p_filters ? 'pokedex' or (p_filters->>'pokedex')::integer=any(c.pokedex_numbers))
 and (not p_filters ? 'finish' or exists(select 1 from public.card_variants v where v.card_id=c.id and v.finish=p_filters->>'finish'))
 and (coalesce(p_filters->>'ownership','all')='all' or
 exists(select 1 from public.real_inventory r join public.card_variants v on v.id=r.card_variant_id where r.user_id=auth.uid() and v.card_id=c.id)=(p_filters->>'ownership'='owned'))
 ), sorted as (
 select *,case coalesce(p_filters->>'sort','name') when 'release' then coalesce(lpad((date '9999-12-31'-release_date)::text,7,'0'),'9999999')
 when 'price' then coalesce(lpad(price::text,16,'0'),'9999999999999999') when 'popular' then lpad((999999999-popularity)::text,12,'0') else lower(card_name) end as sort_key
 from candidates where (not p_filters ? 'min_price' or price>=(p_filters->>'min_price')::bigint) and (not p_filters ? 'max_price' or price<=(p_filters->>'max_price')::bigint)
 ), page as (select * from sorted where p_after is null or (sort_key collate "C",id)>(p_after->>'key',(p_after->>'id')::uuid) order by sort_key collate "C",id limit p_limit+1),
 shown as (select * from page order by sort_key collate "C",id limit p_limit)
 select jsonb_build_object('cards',coalesce((select jsonb_agg(public.c_card_json(id) order by sort_key collate "C",id) from shown),'[]'::jsonb),
 'next',case when (select count(*) from page)>p_limit then (select jsonb_build_object('key',sort_key,'id',id) from shown order by sort_key collate "C" desc,id desc limit 1) else null end) into result;
 return result;end $$;
revoke all on function public.c_search_cards(jsonb,integer,jsonb) from public,anon,authenticated;
grant execute on function public.c_search_cards(jsonb,integer,jsonb) to anon,authenticated,service_role;

create function public.c_collection_write(p_operation text,p_key uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid();prior public.b_real_edit_requests; body jsonb;result jsonb;item jsonb;lot public.physical_copy_lots;
 v uuid;q integer;total integer;oldq integer:=0;kind text;begin
 if owner is null then raise exception 'UNAUTHENTICATED';end if;
 if p_key is null or p_input is null or length(p_input::text)>32000 then raise exception 'VALIDATION_ERROR';end if;
 body:=jsonb_build_object('operation',p_operation,'input',p_input);
 perform pg_advisory_xact_lock(hashtextextended('pp-real:'||owner::text,0));
 select * into prior from public.b_real_edit_requests where user_id=owner and idempotency_key=p_key;
 if found then if prior.request_body<>body then raise exception 'CONFLICT';end if;return prior.result;end if;
 perform public.b_assert_account_writable();
 if (select count(*) from public.b_real_edit_requests where user_id=owner and created_at>now()-interval '1 minute')>=50 or (select count(*) from public.b_real_edit_requests where user_id=owner and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=5000 then raise exception 'RATE_LIMITED';end if;
 if p_operation in ('favorite','wishlist') then
 if not exists(select 1 from public.c_visible_cards where id=(p_input->>'card_id')::uuid) then raise exception 'NOT_FOUND';end if;
 if (p_input->>'active')::boolean then insert into public.card_actions(user_id,card_id,kind) values(owner,(p_input->>'card_id')::uuid,p_operation) on conflict do nothing;
 else delete from public.card_actions where user_id=owner and card_id=(p_input->>'card_id')::uuid and kind=p_operation;end if;
 result:=jsonb_build_object('id',p_input->>'card_id');
 elsif p_operation in ('lot_add','lot_update','lot_delete','bulk_add','bulk_update') then
 if p_operation in ('bulk_add','bulk_update') and (jsonb_typeof(p_input->'lots')<>'array' or jsonb_array_length(p_input->'lots')>100 or jsonb_array_length(p_input->'lots')<1) then raise exception 'VALIDATION_ERROR';end if;
 for item in select value from jsonb_array_elements(case when p_operation in ('bulk_add','bulk_update') then p_input->'lots' else jsonb_build_array(p_input) end) loop
 oldq:=0;
 if p_operation in ('lot_update','lot_delete','bulk_update') then
 select * into lot from public.physical_copy_lots where id=(item->>'id')::uuid and user_id=owner for update;
 if not found then raise exception 'NOT_FOUND';end if;if p_operation in ('lot_update','bulk_update') and (item->>'variant_id')::uuid<>lot.variant_id then raise exception 'VALIDATION_ERROR';end if;v:=lot.variant_id;oldq:=lot.quantity;
 delete from public.physical_copy_lots where id=lot.id;
 else v:=(item->>'variant_id')::uuid;end if;
 q:=case when p_operation='lot_delete' then 0 else (item->>'quantity')::integer end;
 if q is null or q<0 or q>9999 then raise exception 'VALIDATION_ERROR';end if;
 select coalesce(quantity,0) into total from public.real_inventory where user_id=owner and card_variant_id=v;
 total:=coalesce(total,0)-oldq+q;
 if total<0 or total>9999 then raise exception 'VALIDATION_ERROR';end if;
 perform public.b_edit_real_inventory(v,total,null);
 if q>0 then insert into public.physical_copy_lots(id,created_at,user_id,variant_id,quantity,condition,grading_company,grade,acquired_on,cost_minor,currency,notes,binder,page,position)
 values(case when p_operation in ('lot_update','bulk_update') then lot.id else gen_random_uuid() end,case when p_operation in ('lot_update','bulk_update') then lot.created_at else now() end,owner,v,q,coalesce(item->>'condition','unknown'),coalesce(item->>'grading_company',''),coalesce(item->>'grade',''),(item->>'acquired_on')::date,
 (item->>'cost_minor')::bigint,item->>'currency',coalesce(item->>'notes',''),coalesce(item->>'binder',''),(item->>'page')::integer,(item->>'position')::integer) returning id into v;end if;
 end loop;
 result:=jsonb_build_object('id',v);
 else raise exception 'VALIDATION_ERROR';end if;
 insert into public.b_real_edit_requests(user_id,idempotency_key,request_body,result) values(owner,p_key,body,result);
 return result;end $$;
revoke all on function public.c_collection_write(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.c_collection_write(text,uuid,jsonb) to authenticated;
commit;

begin;
create function public.c_catalog_coverage() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('printings',(select count(*) from public.c_visible_cards),'variants',(select count(*) from public.card_variants v join public.c_visible_cards c on c.id=v.card_id),'sets',(select count(distinct set_id) from public.c_visible_cards),'artists',(select count(distinct a) from public.c_visible_cards c cross join lateral unnest(c.artists) a),'languages',coalesce((select jsonb_agg(distinct language) from public.c_visible_cards),'[]'::jsonb),'approved_providers',coalesce((select jsonb_agg(id) from public.card_provider_permissions where enabled and metadata_approved),'[]'::jsonb),'art_enabled',exists(select 1 from public.feature_flags where name='licensed_card_art' and enabled),'measured_at',now())
$$;
create function public.c_catalog_index(p_kind text,p_q text default '',p_after uuid default null,p_limit integer default 24) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if p_kind not in ('sets','artists') or p_limit<1 or p_limit>50 or p_limit is null or length(p_q)>100 then raise exception 'VALIDATION_ERROR';end if;
 if p_kind='sets' then
 with rows as (select c.set_id id,c.set_name name,c.language,c.series,c.release_date,count(*)::integer count from public.c_visible_cards c
 where (p_after is null or c.set_id>p_after) and c.set_name ilike '%'||replace(replace(p_q,'%','\%'),'_','\_')||'%' group by c.set_id,c.set_name,c.language,c.series,c.release_date order by c.set_id limit p_limit+1),
 shown as (select * from rows order by id limit p_limit)
 select jsonb_build_object('entries',coalesce((select jsonb_agg(to_jsonb(shown) order by id) from shown),'[]'::jsonb),'next',case when (select count(*) from rows)>p_limit then (select id from shown order by id desc limit 1) else null end) into result;
 else
 with rows as (select a.id,a.name,count(*)::integer count from public.card_artists a join public.card_artist_credits ac on ac.artist_id=a.id join public.c_visible_cards c on c.id=ac.card_id
 where (p_after is null or a.id>p_after) and a.name ilike '%'||replace(replace(p_q,'%','\%'),'_','\_')||'%' group by a.id,a.name order by a.id limit p_limit+1),shown as (select * from rows order by id limit p_limit)
 select jsonb_build_object('entries',coalesce((select jsonb_agg(to_jsonb(shown) order by id) from shown),'[]'::jsonb),'next',case when (select count(*) from rows)>p_limit then (select id from shown order by id desc limit 1) else null end) into result;
 end if;return result;end $$;
revoke all on function public.c_catalog_coverage(),public.c_catalog_index(text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.c_catalog_coverage(),public.c_catalog_index(text,text,uuid,integer) to anon,authenticated,service_role;
-- Optional persisted portfolio measurements are actual observation-time snapshots, never backfilled history.
create function public.c_portfolio(p_currency text default 'USD',p_statistic text default 'market') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=auth.uid();result jsonb;begin
 if owner is null then raise exception 'UNAUTHENTICATED';end if;
 if p_currency !~ '^[A-Z]{3}$' or p_statistic not in ('market','median','low') then raise exception 'VALIDATION_ERROR';end if;
 with detailed as (select l.id,l.variant_id,l.quantity,l.condition,l.grading_company,l.grade,l.cost_minor,l.currency from public.physical_copy_lots l where l.user_id=owner),
 undetailed as (select null::uuid id,r.card_variant_id variant_id,(r.quantity-coalesce(sum(l.quantity),0))::integer quantity,'unknown'::text condition,''::text grading_company,''::text grade,null::bigint cost_minor,null::text currency from public.real_inventory r left join public.physical_copy_lots l on l.user_id=r.user_id and l.variant_id=r.card_variant_id where r.user_id=owner group by r.card_variant_id,r.quantity having r.quantity>coalesce(sum(l.quantity),0)),
 units as (select * from detailed union all select * from undetailed),
 valued as (select u.*,c.card_name,c.id card_id,c.set_id,c.artists,c.pokedex_numbers,c.rarity_normalized,s.series,s.name set_name,price.amount_minor,price.observed_at,price.provider_id,price.source_url from units u
 join public.card_variants v on v.id=u.variant_id join public.cards c on c.id=v.card_id join public.tcg_sets s on s.id=c.set_id
 left join lateral(select o.amount_minor,o.observed_at,o.provider_id,o.source_url from public.c_approved_prices o where o.variant_id=u.variant_id and o.condition=u.condition and o.grading_company=u.grading_company and o.grade=u.grade and o.currency=p_currency and o.statistic=p_statistic order by o.observed_at desc,o.id limit 1) price on true),
 totals as (select coalesce(sum(quantity),0)::integer copies,count(distinct variant_id)::integer unique_variants,count(distinct card_id)::integer unique_printings,
 coalesce(sum(quantity) filter(where amount_minor is not null and observed_at>now()-interval '7 days'),0)::integer valued_copies,
 coalesce(sum(quantity) filter(where amount_minor is null or observed_at<=now()-interval '7 days'),0)::integer unpriced_copies,
 coalesce(sum(quantity) filter(where amount_minor is not null and observed_at<=now()-interval '7 days'),0)::integer stale_copies,
 sum(quantity*amount_minor) filter(where amount_minor is not null and observed_at>now()-interval '7 days') value_minor,
 sum(cost_minor) filter(where currency=p_currency) cost_minor,
 sum(cost_minor) filter(where currency=p_currency and amount_minor is not null and observed_at>now()-interval '7 days') comparable_cost_minor,
 sum(quantity*amount_minor-cost_minor) filter(where currency=p_currency and cost_minor is not null and amount_minor is not null and observed_at>now()-interval '7 days') gain_minor,
 coalesce(sum(quantity) filter(where id is null),0)::integer untracked_copies,
 coalesce(sum(quantity) filter(where cost_minor is not null and currency=p_currency),0)::integer cost_coverage_copies from valued)
 select to_jsonb(totals)||jsonb_build_object('currency',p_currency,'statistic',p_statistic,
 'references',coalesce((select jsonb_agg(x) from(select distinct variant_id,provider_id,source_url,observed_at,amount_minor,p_currency currency,condition,grading_company,grade from valued where amount_minor is not null order by observed_at desc limit 50)x),'[]'::jsonb),
'breakdowns',jsonb_build_object(
'condition',coalesce((select jsonb_agg(x) from(select condition label,sum(quantity)::integer copies from valued group by condition)x),'[]'::jsonb),
'rarity',coalesce((select jsonb_agg(x) from(select coalesce(rarity_normalized,'Unknown') label,sum(quantity)::integer copies from valued group by rarity_normalized)x),'[]'::jsonb),
'era',coalesce((select jsonb_agg(x) from(select coalesce(series,'Unknown') label,sum(quantity)::integer copies from valued group by series)x),'[]'::jsonb),
'artist',coalesce((select jsonb_agg(x) from(select a label,sum(quantity)::integer copies from valued cross join lateral unnest(case when cardinality(artists)=0 then array['Unknown'] else artists end) a group by a)x),'[]'::jsonb),
'pokemon',coalesce((select jsonb_agg(x) from(select coalesce(n::text,'Unknown') label,sum(quantity)::integer copies from valued left join lateral unnest(pokedex_numbers) n on true group by n)x),'[]'::jsonb)),
'sets',coalesce((select jsonb_agg(x order by copies desc,id) from (select set_id id,set_name name,sum(quantity)::integer copies,count(distinct variant_id)::integer variants from valued group by set_id,set_name order by copies desc,set_id limit 20)x),'[]'::jsonb),
 'lots',coalesce((select jsonb_agg(l order by l.created_at desc,l.id) from (select l.*,c.card_name,c.id card_id from public.physical_copy_lots l join public.card_variants v on v.id=l.variant_id join public.cards c on c.id=v.card_id where l.user_id=owner order by l.created_at desc,l.id limit 50) l),'[]'::jsonb),
 'top_cards',coalesce((select jsonb_agg(x) from (select card_name name,sum(quantity*amount_minor) value_minor,sum(quantity)::integer quantity from valued where amount_minor is not null and observed_at>now()-interval '7 days' group by card_id,card_name order by value_minor desc,card_id limit 10)x),'[]'::jsonb),
 'actions',coalesce((select jsonb_agg(x) from(select a.card_id,a.kind,c.card_name name from public.card_actions a join public.cards c on c.id=a.card_id where a.user_id=owner order by a.created_at desc,a.card_id limit 50)x),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(x order by captured_at,id) from (select id,captured_at,kind,(snap.result->>'value_minor')::bigint value_minor,(snap.result->>'valued_copies')::integer valued_copies from public.portfolio_snapshots snap where user_id=owner and currency=p_currency and statistic=p_statistic order by captured_at desc,id desc limit 366)x),'[]'::jsonb)) into result from totals;
 return result;end $$;
create function public.c_capture_portfolio(p_key uuid,p_currency text default 'USD',p_statistic text default 'market') returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); prior public.b_real_edit_requests;body jsonb; result jsonb;v uuid;begin
 if owner is null then raise exception 'UNAUTHENTICATED';end if;if p_key is null then raise exception 'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended('pp-real:'||owner::text,0));
 body:=jsonb_build_object('snapshot',p_currency,'statistic',p_statistic);
 select * into prior from public.b_real_edit_requests where user_id=owner and idempotency_key=p_key;
 if found then if prior.request_body<>body then raise exception 'CONFLICT';end if;return prior.result;end if;
 perform public.b_assert_account_writable();
 if exists(select 1 from public.portfolio_snapshots where user_id=owner and captured_at>now()-interval '1 hour') then raise exception 'RATE_LIMITED';end if;
 result:=public.c_portfolio(p_currency,p_statistic);
 insert into public.portfolio_snapshots(user_id,currency,statistic,result) values(owner,p_currency,p_statistic,result) returning id into v;
 result:=jsonb_build_object('id',v);insert into public.b_real_edit_requests(user_id,idempotency_key,request_body,result) values(owner,p_key,body,result);return result;end $$;
revoke all on function public.c_portfolio(text,text),public.c_capture_portfolio(uuid,text,text) from public,anon,authenticated;
grant execute on function public.c_portfolio(text,text),public.c_capture_portfolio(uuid,text,text) to authenticated;
commit;

begin;
create function public.c_price_history(p_variant uuid,p_currency text,p_statistic text,p_condition text,p_company text,p_grade text,p_provider text,p_since timestamptz,p_limit integer default 100,p_after jsonb default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;source text;begin
 if p_limit is null or p_limit<1 or p_limit>366 or p_since is null then raise exception 'VALIDATION_ERROR';end if;
 select coalesce(p_provider,(select provider_id from public.c_approved_prices where variant_id=p_variant and currency=p_currency and statistic=p_statistic and condition=p_condition and grading_company=p_company and grade=p_grade order by observed_at desc,id limit 1)) into source;
 with series as (select o.* from public.c_approved_prices o where variant_id=p_variant and currency=p_currency and statistic=p_statistic and condition=p_condition and grading_company=p_company and grade=p_grade and provider_id=source and observed_at>=p_since),
 page as(select * from series where p_after is null or (observed_at,id)>((p_after->>'time')::timestamptz,(p_after->>'id')::uuid) order by observed_at,id limit p_limit+1),
 shown as(select * from page order by observed_at,id limit p_limit),
 summary as(select min(amount_minor) min,max(amount_minor) max,count(*)::integer count,max(observed_at) last_observed_at,(array_agg(amount_minor order by observed_at,id))[1] first,(array_agg(amount_minor order by observed_at desc,id desc))[1] last from series)
 select jsonb_build_object('observations',coalesce((select jsonb_agg(shown order by observed_at,id) from shown),'[]'::jsonb),'currency',p_currency,'condition',p_condition,'statistic',p_statistic,
 'min',summary.min,'max',summary.max,'count',summary.count,'last_observed_at',summary.last_observed_at,'stale',summary.last_observed_at is null or summary.last_observed_at<now()-interval '7 days',
 'change',case when summary.count>1 then summary.last-summary.first else null end,'change_percent',case when summary.count>1 and summary.first>0 then 100.0*(summary.last-summary.first)/summary.first else null end,
 'next_cursor',null,'next',case when (select count(*) from page)>p_limit then(select jsonb_build_object('time',observed_at,'id',id) from shown order by observed_at desc,id desc limit 1) else null end) into result from summary;
 return result;end $$;
revoke all on function public.c_price_history(uuid,text,text,text,text,text,text,timestamptz,integer,jsonb) from public,anon,authenticated;
grant execute on function public.c_price_history(uuid,text,text,text,text,text,text,timestamptz,integer,jsonb) to service_role;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.b_erase_private(uuid)'::regprocedure);
 execute regexp_replace(definition,'FUNCTION public[.]b_erase_private[(]','FUNCTION public.c_platform_erase_private(','i');
end $$;
revoke all on function public.c_platform_erase_private(uuid) from public,anon,authenticated;
create or replace function public.b_erase_private(p_user uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform public.c_platform_erase_private(p_user);
 delete from public.card_actions where user_id=p_user;
 delete from public.portfolio_snapshots where user_id=p_user;
end $$;
revoke all on function public.b_erase_private(uuid) from public,anon,authenticated;
grant execute on function public.b_erase_private(uuid) to service_role;
commit;

begin;
alter table public.card_sync_runs add column lease_token uuid;
create function public.c_claim_card_sync(p_provider text,p_language text) returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.card_sync_runs;begin
 if p_language not in ('en','ja') or not exists(select 1 from public.card_provider_permissions where id=p_provider and enabled and metadata_approved and retention_approved) then raise exception 'RIGHTS_DISABLED';end if;
 perform pg_advisory_xact_lock(hashtextextended('pp-catalog:'||p_provider||':'||p_language,0));
 select * into run from public.card_sync_runs where provider_id=p_provider and language=p_language and status in ('running','failed') order by started_at desc limit 1 for update;
 if found and run.status='running' and run.lease_until>now() then raise exception 'CONFLICT';end if;
 if not found then insert into public.card_sync_runs(provider_id,language,status) values(p_provider,p_language,'running') returning * into run;end if;
 update public.card_sync_runs set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where id=run.id returning * into run;return to_jsonb(run);
end $$;
revoke all on function public.c_claim_card_sync(text,text) from public,anon,authenticated;
grant execute on function public.c_claim_card_sync(text,text) to service_role;
commit;
