-- Audit: broad name/release browsing must not evaluate pricing for every catalog card.
begin;
create index if not exists c_cards_name_c on public.cards(lower(card_name) collate "C",id);
create index if not exists c_cards_set_name_c on public.cards(set_id,lower(card_name) collate "C",id);
create index if not exists c_cards_language_name_c on public.cards(language,lower(card_name) collate "C",id);
create or replace function public.c_search_cards(p_filters jsonb default '{}',p_limit integer default 24,p_after jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if p_limit<1 or p_limit>50 or p_limit is null or length(p_filters::text)>5000 then raise exception 'VALIDATION_ERROR';end if;
 if p_filters->>'ownership' in ('owned','missing') and auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
 with latest_prices as materialized (
 select distinct on (o.variant_id) o.variant_id,o.amount_minor
 from public.c_approved_prices o
 where (p_filters->>'sort'='price' or p_filters ? 'min_price' or p_filters ? 'max_price')
 and o.currency=coalesce(p_filters->>'currency','USD') and o.statistic='market' and o.condition='unknown' and o.grade=''
 and o.observed_at>now()-interval '7 days'
 order by o.variant_id,o.observed_at desc,o.id
 ), card_prices as materialized (
 select v.card_id,min(o.amount_minor) as price from latest_prices o join public.card_variants v on v.id=o.variant_id group by v.card_id
 ), favorites as materialized (
 select card_id,count(*) as popularity from public.card_actions where kind='favorite' and p_filters->>'sort'='popular' group by card_id
 ), candidates as (
 select c.id,c.card_name,c.release_date,p.price,coalesce(f.popularity,0) as popularity
 from public.c_visible_cards c left join card_prices p on p.card_id=c.id left join favorites f on f.card_id=c.id
 where (nullif(p_filters->>'q','') is null or (to_tsvector('simple',c.card_name) @@ plainto_tsquery('simple',p_filters->>'q') or lower(c.card_name) like lower(replace(replace(replace(p_filters->>'q','\','\\'),'%','\%'),'_','\_'))||'%'))
 and (not p_filters ? 'artist' or c.artists && array(select jsonb_array_elements_text(p_filters->'artist')))
 and (not p_filters ? 'set_id' or c.set_id=(p_filters->>'set_id')::uuid)
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
 ), page as materialized (select id,sort_key from sorted where p_after is null or (sort_key collate "C",id)>(p_after->>'key',(p_after->>'id')::uuid) order by sort_key collate "C",id limit p_limit+1),
 shown as (select * from page order by sort_key collate "C",id limit p_limit)
 select jsonb_build_object('cards',coalesce((select jsonb_agg(public.c_card_json(id) order by sort_key collate "C",id) from shown),'[]'::jsonb),
 'next',case when (select count(*) from page)>p_limit then (select jsonb_build_object('key',sort_key,'id',id) from shown order by sort_key collate "C" desc,id desc limit 1) else null end) into result;
 return result;end $$;
commit;
