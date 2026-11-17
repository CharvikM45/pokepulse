# PokéPulse expansion acceptance — November 17, 2026

## Delivered

The existing Next.js/Supabase application is extended without replacing retail discovery, drops, radar, watchlists, calendar, account/privacy or the server-authoritative pack engine. Sealed products retain packaging images; individual cards use card artwork subject to the existing and new permission gates.

- `/cards`, `/pokedex`: database keyset search, gallery/list, set, artist, language, rarity, type, finish, era, ownership, Pokédex and reference-price filters; measured coverage.
- `/cards/[id]`: printing and variant metadata, source attribution, illustrator, related cards, physical/virtual holdings, physical quick-add, favorites/wishlist and comparable price history.
- `/card-sets`, `/card-sets/[id]`, `/artists`, `/artists/[id]`, `/market`: card-specific discovery.
- `/collection/portfolio`: physical copy lots, condition/grade/acquisition/cost/binder notes, priced/unpriced/stale coverage, valuation breakdowns, observed snapshots and reviewed CSV import/export. Virtual cards never contribute to real valuation.
- `/staff/card-catalog`: trusted staff coverage/provider/sync diagnostics.
- Pack Lab: original simulated wrappers, keyboard/click/drag tear, saved card stack, reveal/skip/pause, rarity effects and result breakdown. Outcomes and request/debit idempotency remain server controlled.

## Source and migration

New modules: `apps/web/src/card-{routes,catalog-repository}.ts`, `features/cards/`, `features/collection/`, public card/artist/set/market/portfolio pages, `packages/contracts/src/cards.ts`, `packages/domain/src/cards/`, and `services/ingestion/cards/`. Existing collector, privacy, shell, styles, OpenAPI and pack presentation are extended. Tests add unit normalization/pricing/CSV, PostgreSQL integration/isolation/pagination and E2E archive coverage. Git records the complete changed-file list.

Forward migration `supabase/migrations/20261117000000_card_pokedex_and_market.sql` adds provider approvals, normalized catalog metadata, artist credits, aliases/checkpoints, price observations, acquisition lots, actions, snapshots and SQL APIs. Applied successfully to dedicated Supabase project `ctfvqticypnigkglfnpi`. All 63 public application tables have RLS enabled. Previously applied migrations are unchanged.

## Providers and limitations

TCGdex metadata adapter supports gated, bounded English/Japanese imports with stable identities, durable checkpoints, retries and source evidence. No production import has been authorized. Scrydex is a commercial pricing candidate; a validated provider-independent ingestion interface exists, but there is no subscribed or registered vendor adapter. Provider approval flags default false. Artwork needs separate global, provider, host and printing clearance.

No worldwide completeness, historical prices, official pack odds or artwork rights are claimed. Missing/unapproved data remains unavailable. Existing illustrative demo binder data is labeled and separate from the new real-card archive. No paid services were purchased.

## Verification

Commands use pinned pnpm 10.34.9 on Node 22.14.0.

| Check                 | Result                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm test`           | 124 tests passed across 10 files, including PostgreSQL integration                                               |
| `pnpm test:collector` | 33 tests passed across 3 files                                                                                   |
| `pnpm lint`           | Passed                                                                                                           |
| `pnpm typecheck`      | Passed, including web application                                                                                |
| `pnpm build`          | Production build passed                                                                                          |
| `pnpm format:check`   | Passed                                                                                                           |
| `git diff --check`    | Passed                                                                                                           |
| `pnpm test:e2e` local | Five API checks passed; browser tests blocked before execution by macOS Chromium sandbox launch restriction      |
| In-app browser        | Archive empty/coverage state, expanded filters and portfolio sign-in gate verified on production localhost build |
| Supabase              | Forward migration applied; RLS confirmed on 63/63 public tables                                                  |

GitHub CI supplies Linux Chromium and database/concurrency acceptance. Its result is tracked separately after push; a local build alone does not establish hosted authentication or provider operation.

## Deployment checklist

1. Deploy the committed source with Node 22.14.0 and pnpm 10.34.9; existing GitHub → Vercel integration builds the web project.
2. Connect the dedicated Supabase project through server-side hosting settings: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY`, and exact HTTPS `APP_ORIGIN`. Configure auth site/redirect URLs and verify actual signup/recovery/private writes. Never expose the service key. Vercel team access for this connector has returned 403, so environment wiring is not verified.
3. Record provider metadata/retention evidence and approvals before enabling `CARD_CATALOG_SYNC_ENABLED=true`; choose `CARD_CATALOG_LANGUAGE` and `CARD_CATALOG_BATCH_SIZE`. Run `pnpm worker:catalog` as repeated bounded jobs on an authorized worker host. Deployment does not automatically schedule imports.
4. Independently approve artwork and permitted hosts before enabling licensed card images. Pricing requires a selected licensed provider, concrete adapter and server credentials; do not derive singles values from sealed retail offers.
5. Confirm live account isolation, CSV round trip, privacy export/deletion, opening recovery, mobile/reduced-motion and provider-revocation behavior in configured staging before enabling production sources. Existing retailer/push/map sources retain their own approvals and environment requirements.
