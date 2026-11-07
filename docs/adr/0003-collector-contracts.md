# CONTRACT-02: collector domains on the A platform

Status: implemented on `feat/developer-b-product`; cross-developer review and hosted staging signoff remain pending. Base: A commit `e9dba87a4fce51331d6597e95ac8d6b0cbab09c2`. This records proposed changes, not approval from Developer A.

B reuses the existing Next workspace, verified Supabase session, protected `is_staff()` membership, shared success/error envelopes, fixtures, stock APIs, account APIs and alert engine. No second bootstrap or stock interpretation was introduced.

## Shared amendments

- `packages/contracts/src/collector.ts` adds runtime schemas for B APIs. Pack responses preserve `PackOpeningDTO` fields and add card display metadata; browser adapters create reveal props only after a validated saved response.
- `ReleaseDTO.date` is nullable for unconfirmed dates; `is_demo` is explicit. `SetDTO.manifest_version` is nullable before publication. Master progress is nullable when its scope is unpublished/incomplete. Base remains required by publication validation.
- Catalog query accepts `channel`, and text search includes canonical set names. A's existing filter function handles both; B does not filter availability into a different truth.
- The shared API gateway dispatches only B's owned prefixes. Canonical paths remain `/packs/open`, `/me/pack-openings`, `/me/collections`, `/me/collections/real`, `/me/collections/missing-export` and `/admin/sightings/:id/moderate`. Extra read endpoints expose wallet state, immutable saved-opening recovery and collection progress.
- Sets/cards use bounded cursor pages. Card requirements accompany the first page and every subsequent card request binds the same manifest version. Binder reads require a complete catalog and a mode/version-bound private snapshot.
- The maintained session hook validates the existing session envelope, aborts obsolete verification requests and rechecks on focus, visibility and successful auth actions. Its interface and server authority are unchanged. Recovery callbacks already target `/settings`; that page now offers password update with A's 12–256-character policy.

## Database and worker integration

All B migrations are additive and later than A's migrations. `sightings.product_id` and `releases.product_id` reference A's canonical products. Ownership derives from `auth.uid()`; staff uses A's database membership helper, never editable JWT metadata. All 27 B tables use RLS and explicit grants. There are no anonymous/private-table write grants.

Direct pack/Radar/calendar RPCs enforce A's global flags as well as B's internal settings. Replaying a previously committed pack request remains possible after flags or odds change; new writes fail closed. Saved history and real inventory remain independently private.

The B outbox drains transactionally into A's `publish_local_event`, retaining the event UUID for deduplication. Only current approved `found_stock` observations can publish a positive local event. Shelf-empty observations never become official retailer out-of-stock truth. A's `event_is_current` receives a forward wrapper that rechecks B's report revision, moderation, expiry, directory permission and flags at enqueue/delivery. Withdrawals revise existing inbox copy. B sends no push independently.

`services/notification-worker/run.ts` registers B privacy participants, drains the outbox in match mode and supplies an approved-centroid ZIP-distance resolver. Privacy exports include saved opening cards, balances/ledger, inventories, authored reports/confirmations and authored audit actions. Erasure is idempotent and locks collection writes; authored private audit prose is redacted before auth deletion cascades.

## Tooling amendments

The root remains Node 22.14.0 and pnpm 10.34.9. Added test-only `pg`, `esbuild` and `@axe-core/playwright`, a native-concurrency command, a collector policy-test command included in the main Vitest/coverage run, typed story fixtures and component-test CI coverage. MapLibre is a web dependency loaded only after an explicit map action and approved server configuration. The seed configuration adds `seed-b.sql`; every B seed is original and fictional, and all public gates stay off.

## Review and release conditions

Review these shared changes with A before merge. Run the Docker/Supabase CI job and hosted auth/RLS/notification/privacy journeys with two real accounts and separately provisioned staff. No hosted credentials, Docker runtime, approved live inventory provider, tile license or real-card art grant was available in this checkout. These external checks are not inferred from embedded PostgreSQL, native auth stubs, transport-stub UI tests or anonymous browser tests.

The current-signal bridge clones A’s actual definition and replaces the wrapper at the same function OID, preserving existing callers. Pending/running/blocked deletion jobs pause new B mutations; committed receipt replay and reads remain available. Erasure acquires every B per-account write lock, waits for in-flight staff edits, then redacts audit prose. These races have native multi-connection evidence.
