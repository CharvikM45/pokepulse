# PokéPulse staging handoff

Verified 2026-11-07 (America/New_York). Application source: `cef16120a97891525ca0de128db243dd82f90750`; [draft PR #1](https://github.com/CharvikM45/pokepulse/pull/1).

## Ready for Developer A

The `pokepulse-staging` project is running and Healthy in `tanmaynat's Org` on the Free plan, region `us-west-2` (Oregon). [Project dashboard](https://supabase.com/dashboard/project/nqxjljmdieyedkiilbuc). Project reference: `nqxjljmdieyedkiilbuc`. API origin: `https://nqxjljmdieyedkiilbuc.supabase.co`.

The Supabase dashboard labels its primary branch `main / PRODUCTION`; this project is the application's staging environment, not a public launch approval.

All 16 committed migrations and the two original fictional seed files were applied to an initially empty public schema in one transaction. Verification returned 16 migration records, 54 public tables, zero public tables without RLS, 50 demo products and five fictional card variants. All six global flags and the B pack/Radar settings remain off. No live retailer, directory, artwork or odds permission was enabled.

The SQL Editor was used because the agent MCP OAuth callback did not complete. The deployment bundle preserved the original SQL with editor line-ending normalization, recorded each original version/name/source in `supabase_migrations.schema_migrations`, and protected that private history table with revokes and RLS. Its schema matches the CLI's version/name/statements history format. The SQL bundle was separately validated against disposable PostgreSQL before hosted execution. No original migration file was edited.

## App connection and checks

The local production build passed with hosted Supabase configuration. The app was started at `http://localhost:3000`. This is a local frontend connected to a hosted backend; no public frontend deployment is claimed.

Existing publishable and server-only secret keys were placed in the Git-ignored `apps/web/.env.local` on the setup computer. The existing compatibility variable names `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` contain the current key types; the SDK connection was verified. No key or database password is included in this handoff or Git. Developers need their own securely supplied environment configuration; pulling the repository does not supply credentials.

Actual hosted checks passed:

- Publishable-key flag reads, server-key product reads and anonymous private-read/pack-write denial.
- Production app catalog: 50 explicitly demo products; anonymous session denial.
- Two temporary, admin-confirmed GoTrue users signed in through the real app handler; session cookies were verified.
- Watch creation/replay returned one record; the second user saw none.
- Private preferences persisted; real and virtual inventory snapshots remained separate and empty.
- New pack writes remained denied with rights/feature gates off.
- Watch removal, logout and subsequent session denial passed. Both synthetic users were removed.

The credential-free evidence is in `docs/qa/evidence/collector/hosted-staging/`. Commands actually executed were the production build/start and temporary setup/connection/HTTP smoke scripts; these are separate from the full local Docker acceptance command documented in the collector runbook. Admin-confirmed test users do not prove email confirmation or recovery delivery.

The documentation CI rerun exposed an immediate-assertion race in the primitive browser harness after combobox input. The harness now awaits Playwright's value/text/visibility/focus assertions while preserving each expected behavior. The affected primitive suite passed locally, including ten viewport/theme axe scans. This is a test synchronization fix; application behavior and migrations did not change. Check PR #1 for the latest full CI result.

## GitHub connection

The Supabase GitHub app is authorized and installed for the `tanmaynat` personal account. The source repository belongs to `CharvikM45`; it did not appear in Supabase's repository picker, and GitHub showed that the current browser account cannot manage that repository's options. No repository connection or automatic deployment was enabled.

The repository owner must grant the Supabase GitHub app access to `CharvikM45/pokepulse`. Then configure the integration from project settings, with working directory `.`. Review the intended branch before enabling automatic migrations: the repository's default `feat/developer-a-platform` branch does not contain B's migrations. Do not point automation at that older schema unintentionally. The staged database already contains A and B's 16 migration versions.

## Still required before release

Developer A review of shared amendments; hosted email/confirmation/recovery and deployed callback behavior; frontend hosting and worker scheduling; supported-device push; manual screen-reader acceptance; staging/field performance; and any permission review needed for real sources/art/content. The full goal is not complete merely because staging is initialized.

## Hosted advisor review evidence

The staging Security and Performance Advisors each reported zero errors. The Security Advisor reported 22 warnings: three anonymous-callable and 19 authenticated-callable `SECURITY DEFINER` RPCs. These include intentionally callable public projections and authenticated transactional/staff helpers. Their guards and grants remain a review item against CONTRACT-02; the findings were not dismissed or treated as a clean security signoff.

The Performance Advisor reported seven auth-RLS initialization-plan warnings on A's `own_read` policies for `profiles`, `user_preferences`, `watchlists`, `alert_rules`, `notifications`, `push_subscriptions` and `privacy_jobs`. A forward migration can replace per-row `auth.uid()` evaluation with `(select auth.uid())` while preserving the ownership predicate. No applied policy or original migration was changed during this evidence pass. The advisors also reported 32 security and 38 performance informational suggestions; those counts are not a claim that every suggestion was resolved.

Complete warning exports are committed beside the other hosted evidence as `security-advisor-warnings.csv` and `performance-advisor-warnings.csv`, with server observation timestamps. `initialization.sql` is the exact one-time transaction bundle used on the empty staging schema, including CLI-compatible migration history. Its digest is recorded in `initialization.json`. It refuses an existing public schema and is evidence of this initialization, not a reset command for an active database.
