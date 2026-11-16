# Deploy PokéPulse with Vercel and Supabase

## Vercel project

Import `CharvikM45/pokepulse` into the intended Vercel team. Select the Next.js preset and set Root Directory to `apps/web`, with access to files outside that directory enabled for workspace packages. Use the repository-pinned pnpm version and Node 22. Keep the default Next.js output directory. Deploy the production branch only after CI passes.

Set these environment variables in Vercel for the intended environments, never in source control:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public project URL and anon key.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role key.
- `APP_ORIGIN`: exact canonical HTTPS app origin, without trailing slash.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: optional browser push public key matching the notification worker.

Use separate staging and production Supabase projects. Preview deployments must not mutate the production database. Never expose the service role or VAPID private keys through `NEXT_PUBLIC_` variables.

## Supabase project

Review and apply `supabase/migrations` to the intended project using the established migration runbook. Do not run a database reset against a hosted project. Local `seed.sql` and `seed-b.sql` contain simulated data and are not a production catalog import. Production set metadata and retailer adapters require actual approved sources.

Set the Supabase Auth Site URL to the canonical Vercel/custom domain and allow the exact `/auth/callback` redirect. Configure a delivery provider and verify confirmation, password recovery, sign-in, sign-out, private collection isolation, and account export/deletion against staging before production release. Keep row-level security enabled.

## Workers and live data

Vercel hosts the web request handlers. The ingestion and notification services are separate worker commands; they are not automatically scheduled by a web deployment. Run them on an appropriate worker host using `services/ingestion/README.md`, `services/notification-worker/README.md`, and the operations runbook. Configure server-side Supabase credentials there separately.

Push delivery requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and a valid `VAPID_SUBJECT`. No retailer adapter is currently registered. Real inventory requires an approved provider/retailer integration and its credentials; demo records are never live stock evidence.

## Release verification

Confirm CI, successful Vercel deployment, public catalog access, authentication callback delivery, cross-account database isolation, watchlist persistence, and notification queue processing. Test failure handling with the configured external providers. Keep simulations disabled unless their metadata and permission gates pass. Monitor deployment and worker logs without exposing credentials.
