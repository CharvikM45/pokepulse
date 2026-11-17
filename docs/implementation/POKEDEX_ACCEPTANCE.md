# PokéPulse live collection catalog — November 17, 2026

## Published functionality

The app is now collection-first, using a restrained black, white and red theme, compact primary navigation, a card-search home page, quieter card tiles and one add-to-collection action. Purchase, grade and binder fields are optional disclosures. Retail products, drops, Radar, calendar, watchlists, alerts, the original set binder and free pack simulator remain accessible. Sealed product packaging and individual card artwork remain separate.

Live application: https://web-plum-alpha-64.vercel.app

- `/`: collection overview, search and entry points.
- `/cards`, `/cards/[id]`: real multilingual card metadata, exact printing/variant selection, physical collection saves, card details and personal card actions.
- `/card-sets`, `/artists`, `/market`: set, illustrator and reference-price discovery.
- `/collection/portfolio`: physical holdings, copy conditions, acquisition detail, CSV, snapshots and explicit price coverage.

## Real database, measured coverage

Dedicated Supabase project: PokéPulse (`ctfvqticypnigkglfnpi`). Vercel production is connected to this project. The integration keeps the service key sensitive and non-exportable.

| Measurement            | Published count |
| ---------------------- | --------------: |
| Localized card records |         135,414 |
| Documented variants    |         208,965 |
| Localized set entries  |           1,148 |
| Illustrators           |             419 |
| Indexed languages      |              13 |

Languages: English, Japanese, French, German, Spanish, Latin American Spanish, Portuguese, Traditional Chinese, Simplified Chinese, Korean, Thai and Indonesian. Set counts include language-specific entries. These are verified source counts, not a claim that every worldwide card, error, stamp or translation has been documented. Digital-only Pokémon TCG Pocket cards are excluded from physical ownership.

Source: the MIT-licensed TCGdex metadata repository at revision `4218f64dcbf3de6e7b7548530f938fb0b9ebbe2a`. The source license is included in the repository. A literal-only parser reads data without executing downloaded TypeScript. Detailed variant language restrictions, stamps, subtype and foil are retained. Unknown variant declarations remain unspecified. Fractional provider Pokédex identifiers remain in provenance metadata; only valid whole-number IDs enter the searchable species field.

## Verified behavior

- The published database matches the prepared card, variant and set counts exactly. Publication is a service-only operation; anonymous callers cannot publish.
- Hosted authentication succeeded with two disposable acceptance accounts.
- Adding one physical copy succeeded; replaying the same request returned the same result and left exactly one copy.
- The other account saw no private holdings, and virtual inventory remained unchanged.
- Both test accounts were removed; a database query confirmed zero remaining acceptance accounts.
- Live card search, set search, illustrator search, newest-card queries and coverage respond successfully. Coverage uses measured, invalidated aggregates rather than repeating a full-catalog count on every page load.
- All application tables, including the aggregate snapshot, use row-level security.
- The temporary import endpoint is removed, its Vercel token cleared, and the local token file deleted. The database service key never left Vercel.

## Tests and migrations

Local: 128 tests passed across 11 files, including PostgreSQL integration, multilingual identity, literal-source safety, tenant isolation, pricing, CSV and coverage-cache revocation/invalidation. TypeScript, ESLint, formatting and diff checks pass. Native macOS browser/build-worker sandbox restrictions were handled by running production browser/build checks in GitHub CI.

GitHub run 44122520807 passed quality, database and collector-concurrency jobs, including the production build, 23 browser tests, seven component harness suites, database reset/SQL tests and authenticated HTTP acceptance. The final cleanup commit is checked separately.

New forward-only operational migrations:

- `20261117150000_catalog_snapshot_publication.sql`: service-only count-checked publication.
- `20261117160000_catalog_coverage_scan.sql`: reuse a slim visible-card projection for aggregate scans.
- `20261117170000_catalog_coverage_snapshot.sql`: measured aggregate snapshot, write invalidation and permission-aware reads.

Previously applied migrations are unchanged.

## Remaining coverage and launch limits

Metadata is approved under the reviewed source license. Artwork remains separately gated; this import does not claim image redistribution rights. Live singles pricing and historical price feeds remain unavailable until a licensed provider is configured. No prices, official pack odds, or missing cards are fabricated. No new paid service was purchased.

Future operator-run metadata refreshes use `catalog:snapshot` and `catalog:load`, followed by trusted aggregate refresh. An automatic import schedule is not configured. Authentication was verified for sign-in and private persistence; signup/recovery email delivery and the production Supabase redirect allowlist still need an actual email journey before a public launch.
