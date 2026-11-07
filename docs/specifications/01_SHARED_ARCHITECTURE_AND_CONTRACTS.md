# PokéPulse — Shared Architecture, Contracts and Rules

**Binding specification for both Codex agents. Version 1.0.** Every domain boundary below is a proposed implementation decision derived from the project proposal. Update it only via an agreed contract PR reviewed by both developers.

## 0. Product invariant

An inventory claim is a tuple of **availability state, evidence type, freshness state, seller, fulfillment channel and timestamps**. Never collapse this into an undifferentiated `isLive` boolean. A `verified` label may appear only for a *recent, permitted retailer/partner source* that directly establishes availability in the stated region/channel. Moderated community reports do not qualify.

## 1. Stack / repo / conventions

- Node.js current supported LTS; pin exact version in `.nvmrc`/`package.json` after checking host compatibility.
- `pnpm` workspace (lockfile committed), Next.js App Router, React, TypeScript strict, Tailwind, shadcn/ui or accessible equivalent, Motion/Framer Motion only for opt-in/reduced-motion-safe effects.
- Supabase-hosted PostgreSQL plus Supabase Auth. PostgreSQL types and RLS migrations are source controlled. Use vetted Postgres RPC transactions for Pack Lab; do not implement wallet atomicity as multiple client writes.
- Vitest for unit and contract tests, Playwright for E2E; supported lint/format/tooling. Reuse a lightweight queue/job provider or durable scheduled-worker design according to hosting capabilities rather than assuming long-running Vercel functions.
- Provider boundary: adapters for stock sources and TCG metadata; neither a permitted inventory feed nor image usage permission is presumed.
- Datetimes: ISO 8601 UTC on wire, `timestamptz` in DB, rendered in viewer timezone. Monetary values: integer **minor units** (`price_minor`) plus ISO currency (e.g. `USD`), never floating dollars. Distances: integer `radius_mi`; location selection ZIP-level unless user intentionally grants broader access. Default privacy is private.

### Canonical layout

```text
pokepulse/
  apps/web/
    app/
      (public)/{page.tsx,drops/,products/,local/,calendar/,lab/}
      (account)/{dashboard/,watchlist/,alerts/,collection/,settings/}
      api/v1/
    src/features/
      discovery/                # B UI ownership
      radar/                    # B UI ownership
      lab/                      # B UI ownership
      binder/                   # B UI ownership
      account-ui/               # B UI ownership
      operator-ui/              # A operations UI ownership (small restricted panels)
    public/                     # original placeholder assets, B ownership
  packages/
    contracts/src/              # joint review; A merges contract changes
    domain/src/inventory/       # A
    domain/src/alerts/          # A
    domain/src/auth/            # A
    domain/src/radar/           # B
    domain/src/packs/           # B
    domain/src/collections/     # B
    ui/src/                    # B
    fixtures/src/              # A owns stock fixtures; B owns radar/pack fixtures
  services/
    ingestion/                  # A
    notification-worker/        # A
  supabase/
    migrations/                 # domain-owned, reviewed by both
    seed.sql                    # joint, deterministic fixtures only
    tests/                      # RLS and DB transactions by domain owner
  docs/
    adr/
    providers/                  # A
    content-rights/             # B with joint approval
    runbooks/                   # A
    qa/                         # joint
  .github/workflows/            # A; B reviews UI/E2E workflow
```

If Next.js route groups or source directories need slight syntax changes, document the change and retain the same **ownership boundaries**.

### File ownership (critical)

- **A edits:** shared bootstrap/tooling, auth plumbing, `contracts` (with both reviews), inventory/catalog/drops/watchlist/alert domain and API, provider adapters/workers, operator controls, export/delete backend, inventory/auth SQL.
- **B edits:** `packages/ui`, all main consumer page/layouts and components, Local Radar/sightings/moderation API+DB, calendar API+UI, pack/odds/catalog adapter abstraction, pack opening API+DB, collection API+DB, rights-aware original assets and E2E/UI tests.
- **Both review:** `packages/contracts`, shared auth conventions, RLS semantics, migrations that reference another lane's tables, package dependencies, test fixtures, interface changes.
- A does not reimplement B's pack/radar services. B does not fetch retail stock directly in a component or implement its own stock truth logic.

## 2. IDs, responses and errors

- Entity IDs: UUID strings; provider-specific IDs kept as separate text fields. `stock_event.id` is immutable and remains stable across worker retries.
- IDs are opaque to clients; do not infer canonical product identity from names or slugs.
- Every success: `{ "data": <payload>, "meta": { "request_id": "uuid", "next_cursor": null } }` (`next_cursor` may be omitted for a singleton).
- Every failure: `{ "error": { "code": "VALIDATION_ERROR | UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | RATE_LIMITED | SOURCE_UNAVAILABLE | RIGHTS_DISABLED | INTERNAL_ERROR", "message": "safe string", "details": {} }, "meta": { "request_id": "uuid" } }`.
- Validate input and output with Zod from `packages/contracts`. `details` must not leak secrets, raw provider errors or user data.
- Cursor-based pagination, deterministic sorting (`sort_key`, `id`), stable filtering. `limit` 1–50, default 20. Prefer HTTP 429 with documented retry semantics; never return status 200 for failed writes.
- All non-idempotent mutations must accept header `Idempotency-Key` (UUID) and enforce uniqueness in database for wallet/alert-related operations. Rule creation should also prevent accidental duplicate submission where practicable.
- Do not expose Supabase service-role credentials to client components. Server handlers derive authenticated user IDs from verified sessions, not from request body.

## 3. Core enums (match exact spelling)

```ts
export type AvailabilityStatus = 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown';
export type EvidenceType = 'retailer_api' | 'permitted_partner' | 'moderated_report' | 'editorial';
export type FreshnessStatus = 'fresh' | 'aging' | 'stale' | 'unavailable';
export type SellerType = 'retailer' | 'third_party' | 'mixed' | 'unknown';
export type FulfillmentChannel = 'ship_to_home' | 'pickup' | 'in_store_report' | 'unknown';
export type ReportModeration = 'pending' | 'approved' | 'rejected' | 'expired';
export type AlertChannel = 'in_app' | 'web_push'; // email later, not in initial contract
export type FeatureFlag = 'retailer_verification' | 'local_radar' | 'web_push' | 'calendar' | 'pack_lab' | 'licensed_card_art';
```

Unknown source fields must remain nullable/unknown, not filled with guessed values. `FreshnessStatus` is calculated against a source-specific TTL. The time a *check* ran is not automatically the time the retailer observed its inventory; store `observed_at` and `ingested_at` separately.

## 4. Key DTOs (minimal required fields)

```ts
export interface ProductDTO {
  id: string; slug: string; name: string;
  set_name: string | null; era: string | null; product_type: string;
  language: string | null; release_region: string | null;
  edition: string | null; pack_count: number | null;
  gtin: string | null; release_date: string | null;
  reference_price_minor: number | null; reference_price_currency: string | null;
  reference_price_source: string | null; image_url: string | null;
}

export interface ListingDTO {
  id: string; product_id: string; retailer_id: string; retailer_name: string;
  retailer_url: string; seller_type: SellerType;
  channel: FulfillmentChannel; region_code: string | null;
  price_minor: number | null; currency: string | null;
  availability_status: AvailabilityStatus;
  evidence_type: EvidenceType; freshness: FreshnessStatus;
  observed_at: string | null; ingested_at: string | null;
  last_successful_check_at: string | null; stale_after: string | null;
  source_id: string | null; source_url: string | null;
  is_demo: boolean; evidence_summary: string;
}

export interface StockEventDTO {
  id: string; listing_id: string;
  previous_status: AvailabilityStatus; current_status: AvailabilityStatus;
  observed_at: string; ingested_at: string;
  evidence_type: EvidenceType; source_id: string;
  price_minor: number | null; currency: string | null;
}

export interface SightingDTO {
  id: string; store_id: string; product_id: string | null;
  report_type: 'found_stock' | 'shelf_empty';
  submitted_at: string; observed_at: string;
  expires_at: string; moderation: ReportModeration;
  independent_confirmations: number; conflict_count: number;
  is_demo: boolean; public_notes: string | null;
  // no public reporter ID, precise reporter location, or phone number
}

export interface AlertRuleDTO {
  id: string; enabled: boolean;
  product_ids: string[]; set_names: string[]; retailer_ids: string[];
  product_types: string[]; seller_types: SellerType[];
  channels: FulfillmentChannel[]; evidence_types: EvidenceType[];
  max_price_minor: number | null; currency: string | null;
  store_ids: string[]; zip: string | null; radius_mi: number | null;
  triggers: ('restock' | 'new_listing' | 'local_sighting' | 'price_drop' | 'release_reminder')[];
  delivery_channels: AlertChannel[];
  quiet_hours: { start: string; end: string; time_zone: string } | null;
  daily_cap: number; cooldown_minutes: number;
}

export interface NotificationDTO {
  id: string; rule_id: string | null; event_id: string | null;
  channel: AlertChannel; created_at: string; read_at: string | null;
  title: string; body: string; action_url: string | null;
  evidence_type: EvidenceType | null; observed_at: string | null;
}

export interface ReleaseDTO {
  id: string; product_id: string | null; name: string; date: string;
  event_type: 'release' | 'preorder' | 'announcement';
  date_precision: 'day' | 'month' | 'unconfirmed';
  region: string | null; source_url: string; verified_at: string;
}

export interface SetDTO {
  id: string; name: string; release_date: string | null;
  rights_status: 'approved' | 'metadata_only' | 'disabled';
  manifest_version: string; odds_version: string | null;
  enabled_for_simulation: boolean;
}

export interface CardVariantDTO {
  id: string; set_id: string; card_number: string; card_name: string;
  rarity: string | null; finish: string;
  image_url: string | null; image_rights_cleared: boolean;
  eligible_for_packs: boolean;
}

export interface PackOpeningDTO {
  id: string; set_id: string; opened_at: string;
  spent_coins: number; used_free_open: boolean; odds_version: string;
  cards: { card_variant_id: string; slot_index: number }[];
  opening_status: 'committed';
}

export interface CollectionProgressDTO {
  set_id: string; mode: 'virtual' | 'real';
  base_collected: number; base_required: number;
  master_collected: number; master_required: number;
  extended_collected: number | null; extended_required: number | null;
  manifest_version: string;
}
```

Extend DTOs through a contract PR, not by adding undocumented fields on one side. Avoid using `any`; shared date parsing should be centralized. All UIs must visibly label `is_demo` results **DEMO DATA**; public launch must never include demo data pretending to be observed stock.

## 5. API surface, lane ownership and acceptance

| HTTP endpoint | Owner | Purpose | Required behavior |
|---|---|---|---|
| `GET /api/v1/drops` | A | Public listing events/feed | Availability/evidence/freshness filters; normalized and paginated |
| `GET /api/v1/products` | A | Product Explorer catalog | Filters, predictable order, paginated |
| `GET /api/v1/products/:id` | A | Product + listings/history | Show independent listings and provenance; no fabricated gaps |
| `GET /api/v1/retailers` | A | Source/retailer discovery | Metadata, source coverage and limitations |
| `GET /api/v1/me/watchlist` | A | User watches | Auth, ownership, pagination |
| `POST/DELETE /api/v1/me/watchlist` | A | Watch/unwatch | Exact product vs exact listing semantics; idempotent |
| `GET/POST/PATCH/DELETE /api/v1/me/alert-rules` | A | Rules CRUD | Auth, validation, clear matching behavior |
| `GET/PATCH /api/v1/me/notifications` | A | Notification inbox | Ownership, mark-read, pagination |
| `PATCH /api/v1/me/preferences` | A | Account preferences | ZIP optional, quiet hours, privacy |
| `POST /api/v1/me/export` and `/delete-request` | A | Privacy endpoints | Auth, no exposure of another user; documented retention |
| `GET /api/v1/stores` | B | Nearby store results | ZIP/radius with provider-compliant store catalog; no public reporter location |
| `GET /api/v1/stores/:id/sightings` | B | Moderated sightings | Approved unexpired reports only; conflicts shown |
| `POST /api/v1/sightings` | B | Create report | Moderation queue, anti-spam, no immediate verification claim |
| `POST /api/v1/admin/sightings/:id/moderate` | B | Staff review | Server-enforced staff role, audit log |
| `GET /api/v1/releases` | B | Drop Calendar | Source URL, date certainty and updates |
| `GET /api/v1/sets` and `/sets/:id/cards` | B | Pack/card catalog | Rights-aware images, validated manifests |
| `POST /api/v1/packs/open` | B | Atomic free-only opening | Auth + idempotency + fixed odds_version; save before animation |
| `GET /api/v1/me/pack-openings` | B | Opening history | Private, pagination |
| `GET /api/v1/me/collections` | B | Real/virtual progress | Manifest-derived denominator |
| `PATCH /api/v1/me/collections/real` | B | Manually owned cards | Auth, variant validation, no mutation of virtual collection |
| `GET /api/v1/me/collections/missing-export` | B | CSV checklist | Correct manifest, private auth |
| `GET /api/v1/admin/sources` | A | Provider health | Staff-only metrics and disable switch |

Route syntax above is the logical contract; an OpenAPI spec should record exact query parameters/request JSON and error statuses in code. B must never call raw database tables client-side in ways that bypass shared authorization or API rules. Accessible UI consumes the shared typed client.

## 6. Database tables and transactional ownership

### A-owned SQL

`profiles`, `retailers`, `source_permissions`, `source_health`, `products`, `product_equivalences`, `listings`, `stock_observations`, `listing_current_state`, `stock_events`, `source_check_jobs`, `watchlists`, `alert_rules`, `alert_match_jobs`, `notifications`, `notification_deliveries`, `push_subscriptions`, `user_preferences`, `audit_logs`, `feature_flags`, `privacy_jobs`.

- Unique `(source_id, source_item_id, region_code, channel)` for listing mappings when appropriate.
- Store source permission status / access rationale and adaptation scope. Feature flags default **off** for unapproved source and licensed art.
- Current state is a projection of explicit observations + freshness clock, not an invented successful check.
- Stock events unique per normalized source transition identifier to withstand worker retry.
- Rule-to-event delivery unique `(user_id, rule_id, event_id, channel)` or equivalent. No duplicate send on retry.

### B-owned SQL

`stores`, `sightings`, `sighting_confirmations`, `sighting_moderation_actions`, `releases`, `tcg_sets`, `cards`, `card_variants`, `master_set_manifests`, `master_set_requirements`, `pack_odds_versions`, `pack_slot_rules`, `wallets`, `coin_ledger`, `pack_openings`, `opening_cards`, `virtual_inventory`, `real_inventory`.

- `stores` has public store coordinates/address as permissible; **reporter** precise coordinates and movement patterns are never exposed or retained without a justified need.
- Only approved sightings are visible publicly; expiry is checked both at query time and in maintenance jobs.
- Each set pack configuration is versioned and has documented methodology. Disabled if unsupported or forbidden by rights gate.
- `wallets`, `coin_ledger`, `pack_openings`, `opening_cards`, `virtual_inventory` change in one Postgres transaction; row locks + unique idempotency key.
- `virtual_inventory` can change **only** through the transactional pack-opening service; `real_inventory` only through authenticated explicit user update.
- Each manifest requirement defines `set_id`, `variant_id`, goal scope and inclusion rationale. Never derive master-set denominator by guessing card count.

### Cross-owned tables

B may reference A-owned `profiles`, `products`, `feature_flags`, `audit_logs` via FK or stored policy. **Do not create migrations depending on unmerged A tables.** Use timestamps/sequential coordination and both review RLS tests. A owns final merge of shared migration files, but B writes/maintains tests and SQL for B domain; this is not permission for A to rewrite B's implementation unilaterally.

## 7. Retailer feed adapter contract (A)

```ts
export interface StockProviderAdapter {
  sourceId: string;
  capabilities: {
    availability: boolean; price: boolean; seller: boolean;
    shipping: boolean; pickup: boolean; regionality: boolean;
  };
  check(query: ProviderCheckQuery): Promise<ProviderCheckOutcome>;
}
export type ProviderCheckOutcome =
  | { kind: 'observation'; observation: NormalizedProviderObservation }
  | { kind: 'not_supported'; reason: string }
  | { kind: 'temporary_error'; retry_after_seconds?: number; reason_code: string };
```

A failed check has **no fabricated observation**. A must maintain a source feature switch and documented permission status. Tested fixture provider is explicitly mock, not evidence of public live stock.

## 8. Pack-opening transaction contract (B)

`POST /api/v1/packs/open` body `{ set_id: UUID, use_free_open?: boolean }` and required `Idempotency-Key` header. Server does all of: verify enabled rights-safe pack configuration, current odds version, auth, wallet/free opening allowance; select card variants from allowed slot pools; deduct free-only coins or consume allowance; write ledger/opening/opening_cards/virtual_inventory; commit; return `PackOpeningDTO`. **Never** choose the pull in client code or charge before a separate network animation. Repeated key + same body returns the saved result; same key + different body returns conflict. Failure rolls back everything. No real-money operations or trade features.

Test concurrency, failed request retry, unsupported variant, statistical convergence to *declared simulated distribution* (not asserted physical odds), and version reproducibility. Store a non-sensitive seed or reproducible test mechanism only in test tooling; production RNG must be appropriate and not client-controllable.

## 9. Local reports contract (B)

- Report: store ID, optional canonical product ID, approximate observation time (cannot be future), `found_stock` or `shelf_empty`, optional constrained text and image upload **disabled by default** unless moderation/storage rights are implemented.
- Every report initially `pending`; an operator confirms/rejects; only approved + not expired becomes visible.
- Configure anti-spam cooldown, per-account daily caps, same-store/same-product duplication, text sanitation, independent confirmation counting and conflicting reports. Repeated reports by one account must not count as independent corroboration.
- Reports age to `expired` and old reports remain historical only. Availability from community never becomes `retailer_api` evidence.
- No reward/coin issuance tied to reporting, and no public real-time activity route for any user.

## 10. Security / privacy / ops / rights gates

1. **Supabase RLS** on every exposed user or moderation table; include tests where user X cannot read/write user Y and unauthenticated cannot invoke private mutations. Server must validate staff flag from trusted claims/database, not from request JSON.
2. No arbitrary URL fetching from user input; source URLs must pass allowlisted HTTPS retailer hosts; defend against SSRF and redirects.
3. Rate-limit auth-related, sightings, alert-rule and pack-opening endpoints; add request limits and abuse monitoring. Secrets only on backend.
4. Safe account deletion and export must include both lanes' private records. Agree on deletion dependencies (inventory, pack history, reports, alerts) and avoid dangling PII.
5. Rights flags are *off by default*; use original placeholder art and neutral product imagery, no official Pokémon trade dress or misleading brand affiliation.
6. Logging: request IDs and structured non-PII events; never log access tokens, full provider raw credentials, full ZIP+user combos or unrestricted report payloads.
7. Support anonymous browsing. Show permission prompts only after explicit user action. Support reduced motion and mobile 360px layouts. Zero fabricated availability status.
8. Default all developer seed data to `is_demo=true`, display demo disclaimers visibly, and exclude seed fixtures from public launch database.

## 11. Required shared test fixtures

Create deterministic fixtures under `packages/fixtures/src`:

- `in_stock_fresh`, `out_of_stock_explicit`, `preorder`, `last_known_stale`, `missing_stock_field`, `rate_limited_source`, `source_timeout`, `conflicting_source_data`, `third_party_seller`, `SKU_collision`, `same_event_replayed`.
- `community_found_pending`, `community_found_approved`, `community_shelf_empty_conflict`, `community_report_expired`, `repeat_report_same_account`.
- `one_sample_set` with **fictional/original** card names and images for automated tests, manifest variant requirements, eligible/unsupported finishes, fixed odds, free wallet allowance and duplicate pulls.
- `two_users` for RLS and cross-account access; `no_rights_flag` and `missing_permission` for release gates.

Tests must assert consumer labels, not just backend statuses.

## 12. Contract change protocol

1. Open issue `CONTRACT-xx` with reason and consumer impact.
2. Extend Zod DTO and OpenAPI plus fixture and consumer type test in one PR.
3. Prove old/new compatibility or document migration path.
4. Both developers review and merge contract PR before dependent work.
5. Version breaking API changes (`/api/v2`) only after both approve; do not silently rename fields.

## 13. Definition of done for any feature

Implementation, relevant unit/integration/E2E/RLS tests, accessible error/loading/empty states, screenshots or CLI evidence, documentation, configuration defaults, feature flag if external rights/data dependent, and no failing `lint`, `typecheck`, `test`, `build`. Include a short *Known Limitations* paragraph in every PR summary. Never assert tests were run unless executed.
