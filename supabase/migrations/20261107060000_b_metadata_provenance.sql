begin;
alter table public.tcg_sets add column metadata_source text not null default 'unreviewed' check(length(metadata_source) between 1 and 300);
alter table public.tcg_sets add column metadata_permission_evidence_url text;
alter table public.tcg_sets add column metadata_permission_checked_at timestamptz;
alter table public.tcg_sets add column simulation_permission_evidence_url text;
alter table public.tcg_sets add constraint b_non_demo_metadata_permission check(
 not public_metadata_allowed or is_demo or (metadata_source<>'unreviewed' and metadata_permission_evidence_url like 'https://%' and metadata_permission_evidence_url is not null and metadata_permission_checked_at is not null));
alter table public.tcg_sets add constraint b_non_demo_simulation_permission check(
 not enabled_for_simulation or is_demo or (simulation_permission_evidence_url is not null and simulation_permission_evidence_url like 'https://%'));
commit;
