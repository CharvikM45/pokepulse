# PokéPulse — Developer A platform

Working project name. A Next.js/TypeScript modular monolith with evidence-based inventory, private watchlists/rules, durable queues and notifications, source controls and privacy orchestration. Consumer screens, Radar, Pack Lab and binder belong to Developer B. No live retailer source is approved or connected.

## Run locally

Use Node 22.14.0 (`nvm use`) and pnpm 10.34.9. Install pnpm with `npm install --global pnpm@10.34.9`, or use `npx --yes pnpm@10.34.9`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. Without Supabase configuration, public browsing serves 50 original DEMO products, 51 offers and the original fictional Lumen Grove binder catalog. Consumer pages include Drops, Explorer/detail, Radar, Calendar, Pack Lab, Collections and account tools. Account operations require real authentication. Pack opening, reports, calendar data and maps remain disabled until their database, configuration and permission gates pass.

To enable the backend, install Docker and the Supabase CLI, then run `supabase start`, `supabase db reset`, `supabase test db`. Copy apps/web/.env.example to apps/web/.env.local and fill local project values. Never commit populated env files. The seed is local/demo only. See docs/runbooks/migrations.md before using hosted databases.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:collector
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm format:check
pnpm simulate
```

Unit and integration tests use real PostgreSQL via PGlite with Supabase auth-role stubs; Docker Supabase tests remain a separate CI gate. E2E starts the production server, so build first and keep port 3000 free. `pnpm simulate` executes deterministic database replay, failure and isolation scenarios.

## Packages and APIs

Import @pokepulse/contracts, @pokepulse/domain, @pokepulse/fixtures and @pokepulse/ui. The maintained typed fetch client is `createApiClient(baseUrl)`. Regenerate OpenAPI with `pnpm exec tsx scripts/openapi.ts`; regenerate the local seed with `pnpm exec tsx scripts/generate-seed.ts`.

Public: GET /api/v1/products, /products/:id, /drops, /retailers. Products/drops support cursor/limit and typed identity, seller, price, currency, evidence and freshness filters. Product detail includes independent offers and explicit historical transitions. Private: /me/watchlist, /me/alert-rules, /me/notifications, /me/preferences, /me/push-subscriptions, /me/export, /me/delete-request, /me/privacy-jobs. Staff: /operator, /admin/sources and /admin/flags. Auth: /auth/sign-up, sign-in, recover, update-password, sign-out and callback.

Server handlers verify Supabase users. PostgreSQL derives private ownership from auth.uid(), enforces read isolation and transactional mutation idempotency. Staff membership cannot be self-assigned. All private writes require matching Origin and a UUID Idempotency-Key. Auth email/confirmation/recovery must be tested against the actual Supabase environment before launch.

## Workers and handoff

Worker commands, outage response, migration procedure and retention are in docs/runbooks/. The ingestion adapter registry remains empty until a permitted source is reviewed. Service credentials are never imported by client components. Web Push needs VAPID keys and explicit user permission; inbox delivery remains durable if push is unavailable.

Read docs/DEVELOPER_B_HANDOFF.md, docs/adr/0002-platform-contracts.md, and docs/qa/A_RELEASE_REPORT.md for implementation evidence and remaining launch gates. A local code implementation is not proof of retailer rights, hosted-auth delivery, supported-device push or staging integration with B.

Developer B's integration amendments are in [CONTRACT-02](docs/adr/0003-collector-contracts.md), with operational setup in [collector domains](docs/runbooks/collector-domains.md) and current evidence in [B release report](docs/qa/B_RELEASE_REPORT.md). `/staff/collector` uses A's trusted database staff membership. The notification worker registers collection/report/pack privacy hooks and drains approved report events into A's existing matching engine.
