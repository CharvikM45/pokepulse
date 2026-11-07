# Collector operations

Apply A migrations, then all `20261107*_b_*.sql` migrations in timestamp order. Local Supabase reset loads both seed files. Do not load demo seeds into production. Existing applied migrations must receive forward fixes; disable flags rather than deleting user tables to roll back application exposure.

## Defaults and permissions

`local_radar`, `calendar`, `pack_lab` and `licensed_card_art` remain off. The B settings tables independently default off with demo use denied. Public inventory verification remains A-owned. Enabling a UI flag cannot bypass a direct database gate, and enabling a B setting alone cannot override the A flag.

For an isolated original-fixture acceptance environment, an administrator may enable the matching global flag and B setting, with `allow_demo=true`. This is an explicit staging action. The fictional ZIP is `00000`, the store is imaginary, and directions are disabled for demo stores. No real ZIP directory or store license is implied.

Real sets require documented metadata permission and a separate simulation permission before publication/simulation can be enabled. Catalog completeness and explicit variant scopes are required before a manifest can be published. Used odds/rules and published manifest identities are immutable. Artwork remains null in these APIs; the provider abstraction does not treat metadata permission as image permission.

## Local reports and staff curation

Provision staff through A's protected `staff_members` table. `/staff/collector` loads the private moderation queue and release editor through server staff checks. Approval rejects self-review and stale revisions, and preserves a reviewed public note separately from private submission prose. Reports always enter pending; confirmations cannot count their author or repeat account.

Run `pnpm worker:notifications match` to expire reports, drain B's transactional outbox and run A's matching worker. This command sends no ad hoc B notification. Match/send eligibility always rechecks report state, so stopping expiry cron does not expose expired reports. Run the worker repeatedly under the deployment scheduler already used for A.

Release curation requires an approved source hostname and an explicit nonfuture UTC verification instant. Unknown dates remain null. Month precision stores the first day as a representation of the month and is never presented as a confirmed first-day release. Published edits retain an audit trail and require the expected revision.

## Optional map

The list works without map configuration. After tile-provider permission, attribution and operational limits are reviewed, configure the server-only `MAP_TILES_APPROVED`, `MAP_TILES_ALLOWED_HOST`, `MAP_TILES_URL_TEMPLATE` (HTTPS raster `{z}/{x}/{y}`) and plain-text `MAP_TILES_ATTRIBUTION` values. No vendor template is supplied or assumed licensed. Requests are restricted to that exact host; no geolocation call, reporter coordinate, dynamic style, glyph or sprite URL is used. A failed renderer/tile load retains the text list. The user explicitly opens the map before tiles load.

## Wallet and recovery

Coins are free-only and have no purchase, transfer, redemption or cash value. Optional free allowance resets at 00:00 UTC without stacking. Configure tunable prices, methodology and slot weights before activating an odds version. Publish a new version to change used rules.

`POST /api/v1/packs/open` requires a UUID idempotency key. Retain the same key/body after a timeout, connection failure, malformed response or ambiguous server failure. A validated definitive denial can end the pending request. Replaying a committed key returns its saved result even when the feature has since been disabled. `GET /api/v1/me/pack-openings/:id` is read-only recovery. Browser storage contains only the verified-user-scoped request key/body or saved-opening UUID; cards, tokens and balances are not cached there.

Collection snapshots lock against opening/manual-edit transactions and bind a published manifest version. Only the opening transaction writes virtual inventory. A real edit never changes virtual quantities; omitted notes preserve the current value. Missing CSV includes its mode, manifest version and goal and neutralizes spreadsheet formula prefixes.

## Privacy and checks

Run `pnpm worker:notifications privacy`; the registered `radar`, `binder` and `packs` participants satisfy A's required-participant gate. An export/deletion request is queued until the worker finishes. Export results expire after A's retention window. No public collection sharing or photo upload is enabled.

Run `pnpm test:components` for the seven isolated controller/story suites. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:collector`, `pnpm build`, `pnpm test:e2e` and `pnpm format:check`. Native concurrency additionally requires a disposable loopback PostgreSQL administrator URL in `B_TEST_ADMIN_URL`, then `pnpm test:collector:concurrency`. The harness creates a unique `pp_b_*` database for inspection and never modifies an existing application database. Its auth-role stubs do not test hosted authentication.

While an account has a pending/running/blocked deletion request, new B mutations are paused. Saved receipt replay and private reads remain available until deletion. The eraser waits for all account write lanes before removing rows and redacting private audit text. Only browser-safe public tile credentials may appear in a returned map URL; provider-side revocation remains part of operator permissions management.
