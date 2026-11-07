begin;
create table public.b_real_edit_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 idempotency_key uuid not null, request_body jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(user_id,idempotency_key)
);
create index b_real_edit_rate on public.b_real_edit_requests(user_id,created_at);
alter table public.b_real_edit_requests enable row level security;
revoke all on public.b_real_edit_requests from public,anon,authenticated;
grant all on public.b_real_edit_requests to service_role;
grant select on public.b_real_edit_requests to authenticated;
create policy b_real_edit_owner on public.b_real_edit_requests for select to authenticated using(user_id=(select auth.uid()));
-- The original setter becomes an internal helper so direct authenticated RPC
-- callers cannot bypass request deduplication or manual-edit rate limits.
revoke execute on function public.b_edit_real_inventory(uuid,integer,text) from authenticated;
create function public.b_save_real_inventory(p_variant_id uuid,p_quantity integer,p_idempotency_key uuid,p_notes text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); body jsonb; prior public.b_real_edit_requests; result jsonb;
begin
 if owner is null then raise exception 'UNAUTHENTICATED';end if;
 if p_idempotency_key is null or p_variant_id is null or p_quantity is null then raise exception 'VALIDATION_ERROR';end if;
 body:=jsonb_build_object('card_variant_id',p_variant_id,'quantity',p_quantity,'notes',p_notes);
 perform pg_advisory_xact_lock(hashtextextended('pp-real:'||owner::text,0));
 select * into prior from public.b_real_edit_requests where user_id=owner and idempotency_key=p_idempotency_key;
 if found then if prior.request_body<>body then raise exception 'CONFLICT';end if;return prior.result;end if;
 perform public.b_assert_account_writable();
 if (select count(*) from public.b_real_edit_requests where user_id=owner and created_at>clock_timestamp()-interval '1 minute')>=50 or
    (select count(*) from public.b_real_edit_requests where user_id=owner and created_at>=((clock_timestamp() at time zone 'UTC')::date::timestamp at time zone 'UTC'))>=5000 then raise exception 'RATE_LIMITED';end if;
 perform public.b_edit_real_inventory(p_variant_id,p_quantity,p_notes);
 result:=jsonb_build_object('id',p_variant_id,'quantity',p_quantity);
 insert into public.b_real_edit_requests(user_id,idempotency_key,request_body,result) values(owner,p_idempotency_key,body,result);
 return result;
end $$;
revoke all on function public.b_save_real_inventory(uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.b_save_real_inventory(uuid,integer,uuid,text) to authenticated;
commit;
