# Operations and incident response

## Worker deployment

Run a separate bounded worker process with server-only Supabase credentials. The web application does not execute heavy batches during HTTP requests.

- Every permitted scheduling interval: `pnpm worker:ingestion --schedule`.
- Drain at most 25 checks per invocation: `pnpm worker:ingestion`.
- Match at most 25 stock events: `pnpm worker:notifications match`.
- Deliver at most 25 push jobs: `pnpm worker:notifications push`.
- Process privacy requests: `pnpm worker:notifications privacy`.
- Purge expired export payloads, idempotency entries, rate buckets and old audit/job metadata hourly: `pnpm worker:notifications retention`.

The ingestion registry is intentionally empty until a reviewed adapter and source credentials are supplied. A source must be approved, enabled and have explicit documented hosts and quotas. Demo seed sources are candidate/disabled. Do not enable retailer_verification just because credentials exist. The operator API intentionally cannot approve a source or enable retailer verification/licensed art; these require reviewed deployment configuration.

No production polling cadence, provider cost, latency or service-level objective is claimed. Quota counters, attempts, failures, last success, circuit delay, pending mappings and queue state are available to staff at /operator and /api/v1/admin/sources. Per-check cost is nullable until a permitted provider supplies billing data. Configured daily budgets fail closed when unit cost is unknown; actual configured costs accumulate on each claim. Unwatched listings back off to four times the permitted base interval. Queue delay and processing duration are recorded; do not treat an unknown cost as a measured zero.

## Outage / quota exhaustion

Suspend a source in /operator. Pending/running jobs are quarantined transactionally and stale/current projections become unavailable. Failures never create a negative observation. Existing observations remain historical. Investigate source health using error codes, not raw credentialed payloads. Quota exhaustion postpones work; repeated errors open the circuit. Approval and source enablement must be reviewed before resuming quarantined jobs; requeue only known-safe jobs using a trusted DB operator.

## Bad parser rollout

Suspend source first. Preserve immutable observations/events. Register a corrected parser version and replay a fixture sample in staging; do not rewrite historical evidence or fabricate replacement timestamps. Review quarantined mappings. Re-enable only after permission, regional/channel/seller semantics and TTL tests pass.

## Stuck queue / worker crash

Check pending age, leases and attempts. Expired leases are reclaimable; completion requires the new lease token. A replay retains the same check ID and cannot insert another observation/event for that check. After the bounded retry cap, inspect failed jobs; do not blindly reset all retries. Push transport outcomes can be ambiguous: at-most-once subscription attempts may drop a push; the inbox remains available.

## Security issue

Suspend affected sources, disable affected feature flags, revoke/rotate server credentials through the deployment secret manager, and invalidate affected Supabase sessions. Preserve minimal audit evidence. Never log tokens, raw provider payloads, user location trails, email/password request bodies or push keys. Audit records keep actor IDs only until account deletion anonymizes them; operational logs contain counts and safe reason codes. Notify the responsible human operator through their established incident process; no automatic outbound communication is implemented.

## Privacy and retention

Exports are private, API downloads expire after 24 hours, and the retention worker erases their stored payload. Rate buckets expire after one day, mutation idempotency after 30 days, audit entries after 90 days and completed/failed privacy-job metadata after 30 days. Inbox/rules/devices are account-owned and cascade on auth-user deletion. Failed/blocked requests do not mean deletion completed. B-owned domains require registered hooks. Review backup retention and managed-provider retention separately before claiming complete erasure.
