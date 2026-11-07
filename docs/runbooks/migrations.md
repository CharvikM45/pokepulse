# Migration and staging checklist

Run `supabase start`, `supabase db reset`, and `supabase test db` in an isolated Docker-backed environment. The seed contains 50 explicitly fictional products and 51 offers; never load it in production. Migrations build the public read-only flag baseline, auth profiles/preferences and trusted staff roles, catalog/permissions, inventory/queues, alerts/outbox and privacy orchestration. Seed reset is local/destructive.

Embedded PostgreSQL tests run the same migrations with minimal Supabase auth-role stubs. They test SQL/RLS, not hosted GoTrue, PostgREST, email delivery, edge proxies or multiple independent PostgreSQL connections. Docker Supabase CI and hosted staging tests remain separate evidence.

Before initial merge, a discarded test database may be reset. After merge, never edit an applied migration: ship a forward fix. Back up staging before promotion and test restores. To roll back an application, deploy the prior compatible code with source flags off; do not drop tables containing user data or immutable evidence.

Provision staff only through a trusted database administrator inserting into staff_members. Never use user_metadata for authorization. Supabase email confirmation must remain enabled, callback origins must be exact, and recovery links must target /auth/callback. APP_ORIGIN must match the deployed HTTPS origin. Keep service-role and VAPID private keys only in server/worker secret stores.

Staging gates: verified signup/confirmation/login/recovery/logout; two-user watch/rule/inbox isolation through the actual API; source outage to stale UI; duplicate event to one inbox; device opt-in/revoke on supported browsers; operator suspend; export/delete including B hooks. No public launch until all applicable gates have recorded evidence.
