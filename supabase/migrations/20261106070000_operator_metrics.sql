begin;
create function public.operator_metrics() returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb;begin
 if not public.is_staff() then raise exception 'FORBIDDEN';end if;
 select jsonb_build_object('queue_backlog',(select count(*) from public.source_check_jobs where status in ('pending','running')),'pending_mapping_reviews',(select count(*) from public.mapping_reviews where state='pending'),'push_failures',(select count(*) from public.notification_deliveries where status='failed'),'privacy_blocked',(select count(*) from public.privacy_jobs where status in ('failed','blocked')),'fresh',(select count(*) from public.listing_current_state c join public.stock_observations o on o.id=c.observation_id join public.source_permissions s on s.id=o.source_id where o.stale_after>now() and not c.conflicted and s.enabled and s.status='approved'),'stale',(select count(*) from public.listing_current_state c join public.stock_observations o on o.id=c.observation_id where o.stale_after<=now()),'p95_check_duration_ms',(select percentile_cont(0.95) within group(order by duration_ms) from public.source_check_jobs where duration_ms is not null)) into result;return result;
end $$;
revoke all on function public.operator_metrics() from public,anon;
grant execute on function public.operator_metrics() to authenticated;
commit;
