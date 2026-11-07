begin;
create function public.reject_evidence_mutation() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'IMMUTABLE_EVIDENCE'; end $$;
create trigger immutable_observation before update or delete on public.stock_observations for each row execute function public.reject_evidence_mutation();
create trigger immutable_event before update or delete on public.stock_events for each row execute function public.reject_evidence_mutation();
revoke all on function public.reject_evidence_mutation() from public,anon,authenticated;
commit;
