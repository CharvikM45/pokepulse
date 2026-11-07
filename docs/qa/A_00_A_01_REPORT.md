# A-00/A-01 checkpoint — 2026-11-06

## Outcome

Local Developer A scaffold is ready for review on `feat/a-01-bootstrap`. A-00 provider register is conservative; A-01 boots with no secrets. No GitHub remote, PR, merge, deployment, source permission or partner review is claimed. The unrelated parent Git repository was left untouched.

## Delivered / changed files

- Root package.json, pnpm-lock.yaml, workspace/TypeScript/ESLint/Prettier/Vitest/Playwright config, .nvmrc and .github/workflows/ci.yml: reproducible workspace and quality gates.
- apps/web: neutral mobile placeholder, Tailwind integration, public fixture products/drops routes, environment placeholders; B-owned feature folders remain empty.
- packages/contracts: source DTOs, Zod product/listing and response schemas, validated fetch client, bootstrap OpenAPI. Remaining domain validators arrive with their owning milestones.
- packages/fixtures: original fixed-clock stock scenarios, explicit demo markers and server-time stale projection.
- packages/domain: fail-closed permission check, disabled feature registry, anonymous auth interface and empty domain boundaries.
- packages/ui: replaceable development notice only. services/: reserved worker directories.
- supabase/migrations/20261106000000_bootstrap.sql: RLS-enabled flag table, all six flags disabled, client read-only policy. No inventory/user tables. Forward-fix/rollback guidance included.
- docs/providers: feasibility, permission register and capability limitations; README: setup and B handoff; docs/adr: contract review notes.

## Verification actually run

Commands used pinned pnpm 10.34.9 through npx or its cached executable with PATH set for nested scripts. Node 22.14.0.

| Command                               | Result                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------- |
| pnpm install --frozen-lockfile        | PASS                                                                   |
| pnpm lint                             | PASS, no warnings after PostCSS fix                                    |
| pnpm typecheck                        | PASS                                                                   |
| pnpm test                             | PASS, 10 unit tests                                                    |
| pnpm build                            | PASS, landing page and two dynamic API routes                          |
| pnpm exec playwright install chromium | PASS                                                                   |
| pnpm test:e2e                         | PASS, 2 tests against production build at 360px                        |
| supabase start / db reset / test db   | NOT RUN: Docker and Supabase CLI unavailable locally; configured in CI |
| GitHub CI                             | NOT RUN: no remote or pushed workflow                                  |

Unit cases cover all unapproved permission states, malformed permission config, absent approval evidence/credential, disable switch, flag defaults, demo contracts, fixture expiry, failed-check outcome shape and anonymous auth rejection. Chromium checks a visible DEMO DATA notice, no mobile horizontal overflow, anonymous success envelopes, demo provenance and invalid limits returning 400. Screenshot: evidence/bootstrap-mobile.png.

An initial build invocation failed because pnpm was absent from PATH; rerunning with pinned pnpm available passed. Initial latest TypeScript/ESLint selections exposed peer incompatibilities; final TypeScript 5.9.3 and ESLint 9.39.5 match the Next lint dependency peer ranges. npm marks ESLint 9 deprecated; upgrade when the Next lint plugins support the new major. pnpm skips esbuild postinstall by default; executed unit/build checks pass with platform packages.

## Contract / B review

Original DTO names/fields are retained. DemoProductDTO adds a fixture-only true marker because the source requires demo marking but omits it from ProductDTO. /drops is explicitly a ListingDTO[] fixture feed pending A-07 joint review. See docs/adr/0001-bootstrap-contract-notes.md; neither change is claimed approved. B can import shared packages and launch via README. No auth UI or production staff check exists yet.

## Known limitations and security impact

No live source called. Best Buy remains candidate, other sources unevaluated, all external feature flags off. No service secrets are required or present. Real provider adapter, durable ingestion/replay, scheduler, alerts, authentication, private-user RLS, privacy tools, and consumer UI remain future work. This is not release-ready, and database migration/policy correctness remains unverified locally. SQL suite contains four read/default/write-denial checks for CI. One original demo product is intentional at bootstrap; A-03 owns the 50-product seed. No official branded art is used.

## Next smallest ticket

Review the bootstrap contracts and run the Supabase clean reset/policy suite in Docker, then A-02 verified Supabase sessions, profiles and cross-user RLS. A-03 catalog can follow the shared schema review. GitHub repository creation/collaborator setup needs the actual repository owner and partner identity; none was invented.
