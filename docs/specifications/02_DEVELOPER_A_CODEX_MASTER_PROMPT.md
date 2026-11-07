# CODEX MASTER PROMPT — DEVELOPER A

**Assignment:** PokéPulse Developer A — infrastructure, authenticated platform, canonical retail catalog, *evidence-first* stock intelligence, watchlists, alert engine and operational reliability.  **Estimated scope: 120 relative planning points.**

> **Codex: treat this file as your work order. FIRST read `01_SHARED_ARCHITECTURE_AND_CONTRACTS.md` and `00_START_HERE.md` in full, inspect the actual repository, and honor their decisions. Do not silently change contracts, claims, licensed-content policy or Developer B's directories. Implement in reviewable PR-sized increments. Do not state that any integration is live unless it is tested with a permitted real source.**

## 1. Role and outcome

You own PokéPulse's **system of record for retailer availability**. When a collector opens the site, they should see whether a listing was explicitly observed available, which authorized source said so, when it said so, the seller/channel/region, whether that evidence is stale and how to act on it. When availability changes, exactly one durable event should be created and eligible opted-in users should receive at most one delivery per event/rule/channel (subject to configured grouping/cooldowns). If an API becomes unavailable, PokéPulse must degrade transparently rather than invent stock status.

You also own the shared bootstrap and authentication/database foundation, private user controls, and minimal operational controls. **You do not own main consumer UI, Local Radar reports backend, release calendar, Pack Lab or binder**; these belong to Developer B.

## 2. Rules and constraints

- Keep one Next.js modular monolith, typed packages and versioned SQL. No premature microservices.
- The platform's highest priority is **accuracy before breadth**. No unsupported retailer scraping, anti-bot evasion, automated buying or hidden stock endpoints.
- The Best Buy product API is a *candidate*, not permission or proof of broad Pokémon inventory. Do not substitute a Marketplace seller inventory API for public product stock. Build a fully usable mock adapter and permission-gated real adapter where lawful access is actually available.
- A provider outage, missing stock field or 429 is not an out-of-stock observation; leave last known evidence as historical and freshness turns stale/unknown as TTL expires.
- Keep exact product identity distinct from retailer-specific listing; distinguish first-party vs marketplace seller. Prices are listed prices, not guaranteed final checkout prices.
- Refuse silent changes to TypeScript DTOs, enums or B-owned modules. Request contract PR with a fixture and migration plan.
- Assume no official card art license and no right to public Pokémon identity. Build neutral/original placeholders and leave content-rights decisions for the joint gate.
- Do not write additional tasks outside this lane unless needed to unblock the shared handshake and both developers agree.

## 3. Milestone-by-milestone execution

### A-00 — Data-rights feasibility register (5 points; week 1)

**Build:** `docs/providers/viability.md`, `docs/providers/permission-register.md`, `docs/providers/adapter-capabilities.md`. Define permission states `not_evaluated`, `candidate`, `approved`, `denied`, `suspended`. For each potential retailer source, record official documentation URL, authorized usage scope, authentication/keys, availability/price/seller/pickup/region capabilities, quotas, pricing, update cadence, TOS/rights decision, responsible reviewer and date. Start with a Best Buy API feasibility candidate, other retailer candidates unverified, and a deterministic fake adapter for development.

**Acceptance:** `retailer_verification` flag remains off until an approved entry exists and the runtime has credentials. If no source qualifies, the whole app still works in **catalog/community-only** mode with clearly labeled data. No source is called while denied/suspended.

**Tests/evidence:** Manual permission checklist, config validation, fail-closed flag test, source-specific capability smoke test only if approved. Record what could not be verified rather than asserting access.

### A-01 — One-time repo bootstrap and CI (8 points; weeks 1–2)

**Build:** Initialize one pnpm monorepo; Next.js App Router (strict TS); package skeletons from shared architecture; Tailwind/theme integration points; Vitest/Playwright; ESLint/format; Supabase local migrations baseline; `.env.example` **with placeholders only**; basic auth service module; lint/typecheck/test/build scripts; GitHub Actions. Pin versions that actually resolve and work together. Add `README.md` with local setup, Supabase instructions and seed reset.

**Handoff:** Immediately merge `A-01-bootstrap` so B can work on UI in the same scaffold. Keep visible UI to a neutral placeholder, not a competing design system. Shared contracts and empty route exports must compile. Do not create sample *verified* stock labels.

**Acceptance:** Fresh clone, install and local build work with no secret keys. CI fails for TS/lint/tests/build regressions. `packages/contracts` and `packages/ui` are importable. B can run `pnpm dev` after merge.

### A-02 — Authentication, profiles and access policy (8 points; weeks 2–3)

**Build:** Supabase Auth integration; supported sign-in/sign-out and email verification/recovery flows; session-aware API helper; `profiles`, `user_preferences` tables + privacy defaults; staff role authorization from trusted server/database claims; CSRF-safe request patterns where needed; feature flag registry. Allow all public discovery endpoints to work anonymously.

**Acceptance:** Account-owned records use server-derived `auth.uid()`; non-authenticated writes reject; account A cannot read/edit B data; staff-only access rejects regular users; server secrets never reach browser bundles. Provide B a stable `useSession`/server auth helper *contract*, not a custom auth UI implementation.

**Tests:** Auth session cases, RLS allow/deny matrix, unauthorized and forbidden API error consistency, safe redirect handling, recovery flow smoke.

### A-03 — Canonical sealed-product and listing schema (10 points; weeks 2–4)

**Build:** SQL schema and typed repository for `retailers`, `products`, `product_equivalences`, `listings`; product normalized by expansion, product format, language, region, pack count, edition and GTIN when supplied. Listings record source-specific IDs/URLs, seller, currency/minor-unit price, fulfillment channel and region. Include reference MSRP only with provenance and applicability period. Seed at least 50 **explicitly demo** products/listings for UI iteration, each with unique canonical identity. (Count is a prototype target, not a guarantee of real source coverage.)

**Complex cases:** Same name/different edition, retailer-exclusive variants, multi-pack vs single-pack, marketplace seller change, ambiguous GTIN/missing pack count, preorder. Fuzzy cross-provider matches must go to a quarantine/review table; never auto-merge ambiguous identities.

**Acceptance:** A single canonical product can have multiple distinct retailer offers. B can filter by product type/set/seller/retailer/price. `is_demo=true` reaches every seed DTO. Unverified price/MSRP doesn't silently become 0.

**Tests:** Normalization, uniqueness, GTIN aliases, collision quarantine, price integer math, URL host allowlist and negative cases.

### A-04 — Source-adapter interface and approved adapter POC (12 points; weeks 3–5)

**Build:** `StockProviderAdapter` contract, capability flags, config/permission gate, a deterministic replayable fixture adapter, and one **optional approved real provider** adapter only if terms/access allow. Add safe HTTPS allowlist, short timeouts, response/schema validation, structured errors and provenance metadata. Store parser version and payload hash/reference rather than logging full private payloads. Run checks only server-side.

**Acceptance:** Adapter returns explicit `observation | not_supported | temporary_error`. Missing stock signals are reported `not_supported` or unknown, not unavailable-for-sale. No hardcoded API key; support credential absence gracefully. Source app stays useful without live integration. Approval evidence accompanies any live source PR.

**Tests:** Happy stock, missing fields, 429, timeout, unexpected format, region ambiguity, seller ambiguity, service suspension, unsafe URL and redirects. B receives typed mock fixtures with exact names.

### A-05 — Scheduling, job budgeting and source health (12 points; weeks 4–5)

**Build:** Durable source-check scheduler/worker with deduplicated jobs, per-source quota limits, a cap on concurrency, backoff with jitter, circuit breaker, stale-source health records and a kill switch. Separate schedule triggering (cron) from actual heavy batch execution (queue/background worker if necessary). Prioritize watched/high-value listings subject to permitted polling limits; back off inactive or failing listings. Track attempts, success, delay and cost.

**Acceptance:** On worker crash/restart, a check can retry without duplicate state events. Quota exhaustion backs off without hitting the source repeatedly. Provider permission toggle disables all new checks and quarantines pending jobs as needed. No source claim of real-time detection.

**Tests:** Duplicate dispatch, out-of-order completion, quota ceiling, 429 `Retry-After`, timeout breaker, schedule pause/resume, state replay.

### A-06 — Inventory truth, history and freshness projection (11 points; weeks 4–6)

**Build:** `stock_observations`, `listing_current_state` and `stock_events`, including `observed_at`, `ingested_at`, `last_successful_check_at`, `stale_after`, `expires_at`/TTL, source/evidence/channel/seller/region and parser provenance. Ingest normalized data transactionally, append explicit observations, project current state, log meaningful state changes. Make TTL computed from source rules, not client clocks. Retain last known state/history while customer-facing current status becomes `unknown/stale` when evidence ages.

**Event semantics:** Explicit `out_of_stock` → explicit `in_stock` qualifies as a *restock*. `unknown` → `in_stock` is a *new positive availability observation*, not automatically a restock. A price change is a price-change event only if numbers are comparable in same currency and applicable seller/channel. Never create an `out_of_stock` event from outage. Record conflicting source observations without silently choosing an authoritative current state.

**Acceptance:** Every rendered drop has evidence and age, seller/channel where known, and a direct source link. History charts show gaps instead of interpolation through outages. Unknown source region doesn't get national-stock wording. Stale flag cannot be overridden in client by a recent ingestion of an old observation.

**Tests:** All transition pairs, two out-of-order observations, stale TTL, source permission revoke, same event replay, senderless seller data, price drop signal, regional stock differences, explicit unknown.

### A-07 — Public discovery APIs and versioned client (8 points; weeks 4–6)

**Build:** Typed `GET /api/v1/products`, `/products/:id`, `/drops`, `/retailers`; with cursor pagination, query validation, filters and stable sort, typed response/error wrapper and request IDs. Generate or maintain an OpenAPI spec + typed fetch client in `packages/contracts`. The `product/:id` endpoint returns canonical product, offers, provenance and historical transitions; do not return unsanitized raw provider payloads.

**Acceptance:** B's UI consumes only these types and can render loading/no results/error/unavailable/demo cases. Every listing has `source_url` where provided and `last_successful_check_at`/staleness info. A new user can browse without an account.

**Tests:** Contract snapshots, invalid filters, pagination stability, 404, filter combinations, stale output, stock-status wording cues.

### A-08 — Watchlists, rule matching and hygiene (12 points; weeks 5–7)

**Build:** Authenticated `/me/watchlist` and `/me/alert-rules` CRUD. Exact-listing versus whole-product watch semantics. Criteria include set/type, seller, retailer, price threshold, source/evidence type, channel and selected local stores/ZIP/radius (local events consumed from B via a published event interface). Add rule validator and a “why this matched” explanation. Require user opt-in, reasonable rule limits and idempotent rule creation.

**Acceptance:** Rule builder DTOs and matches agree for all criteria. A rule demanding first-party stock will not fire for a marketplace seller. Price thresholds use comparable currency and known price. A community local report never triggers a verified-retailer rule. Users can pause/delete rules.

**Tests:** Crossed filters, null price, mixed seller, regional mismatch, disabled rule, community vs retailer evidence, repeat event and cooldown.

### A-09 — Notification pipeline, in-app inbox and opt-in Web Push (12 points; weeks 6–8)

**Build:** Event-to-rule queue, transactional notification/outbox log, in-app inbox API, read status, preference flags, quiet hours/time zone, user daily limits, cooldown, digest-ready abstraction and (M1) Web Push with proper browser support detection. Dedup unique `(user,rule,event,channel)`. Delivery retries must never duplicate durable notification records; track attempted/sent/failed/suppressed states. Delayed stock notifications re-check freshness before sending.

**Acceptance:** One event matching one rule results in one inbox notification, regardless of worker retry. No push without explicit permission. iOS/iPadOS Home Screen app caveat is communicated by UI owner B. Notifications provide source/evidence time and direct legitimate retailer URL when appropriate. If push unavailable, inbox still works.

**Tests:** Transaction/outbox retry, double event delivery, quiet hours DST/time zones, daily cap, revoked push subscription, stale delayed event, failed push provider, 2 users isolation.

### A-10 — Operator health and source/flag controls (6 points; weeks 7–9)

**Build:** Restricted admin API and minimal operator panel for provider status/permission flags, last successful checks, freshness distribution, quota usage, pending mapping review, error counts, queue backlog and push failure summaries. An operator can disable a source, put it into degraded mode, and pause checks safely. Add auditable changes. Do not expose keys/raw credentials.

**Acceptance:** Non-admin receives 403; invalid config change fails closed; disabling source stops checks and changes customer-visible current confidence as appropriate. Record operational runbooks for source outage, bad parser rollout, stuck queue and security issue.

### A-11 — Privacy tools and cross-lane deletion/export orchestration (6 points; weeks 8–10)

**Build:** Authenticated preferences, portable user data export and deletion-request path with background job/audit. Coordinate with B for ownership of sightings, real binder, virtual pack history and coin ledger. Follow minimum data retention, avoid public user profiles by default, and explain any data retention required for fraud/security without retaining detailed location trails. Export requests should not allow access by other users.

**Acceptance:** B's UI can trigger endpoints and display request state. Erase or anonymize each owned record as designed; orphan rows and leftover PII are tested. Do not claim instant complete deletion when queued or legally constrained.

### A-12 — System verification and handoff (10 points; weeks 9–12)

**Build/test:** Contract + RLS suite, stock-truth property tests, provider reliability stress/retry tests, alert dedup end-to-end using replay fixture, privacy/security checks, log redaction, CI coverage and monitoring guide. Pair with B on complete flows and staging deploy. Produce `docs/qa/A_RELEASE_REPORT.md`: claims supported, source permission, failures, measured results and known limits.

**Acceptance:** A-00–A-11 all pass; independent scenario `source outage -> stale label -> suppress fresh-alert claim`, and scenario `explicit out->in -> one event -> one inbox alert` pass at API and UI levels.

## 4. Detailed engineering requirements

### Inventory observation ingestion pseudoflow

```text
if source permission != approved: refuse check
if source quota exhausted: schedule later; no stock observation
result = provider.check(allowlisted canonical mapping)
if result.kind != observation: log health failure/unsupported; do not write negative stock
validate + normalize explicit source facts
if mapping ambiguous: quarantine; do not publish
append observation idempotently by source/check signature
project listing state by observed timestamp and source capability
if meaningful state transition: append immutable stock_event once
enqueue alert match job using immutable event id
source-specific TTL controls display freshness
```

### Alert matching pseudoflow

```text
receive immutable event + source-evidence snapshot
check rule enabled and exact identity/seller/channel/region/price/evidence match
check user quiet hours/caps/cooldown and source freshness for delayed send
insert outbox row unique(user, rule, event, channel)
if duplicate conflict: no second delivery
send inbox universally; send push only with opt-in + capability
record delivery result; retry nonfatal failures with same idempotency key
```

### Security cases you must prove

- Anonymous user: can browse catalog, cannot create watchlist or read account inbox.
- User X: can watch own products and edit own rules, cannot infer/watch/read User Y's private rules, devices or alert history.
- User tries to inject an arbitrary IP/localhost URL in listing request: rejected, not fetched.
- Unapproved retailer source is disabled independent of runtime credentials.
- Public catalog cannot leak raw provider payloads, tokens or privileged endpoints.
- Source parser uncertainty cannot be silently promoted to `retailer_api` verified.

### Out-of-scope for your lane

No consumer dashboard design system, no Local Radar moderation or store data backend, no pack rolling, no coin wallet, no real/virtual binder, no direct e-commerce purchases, no rewards tied to sightings, no public trading/marketplace features.

## 5. Developer B integration handshake

**As soon as A-01 merges**, send B:

1. Lockfile + exact launch commands and the root `README.md`.
2. DTO exports from `packages/contracts`, generated client helpers and request/error contract.
3. Deterministic `packages/fixtures/src/stock` fixture names with realistic positive/negative/stale examples marked `is_demo`.
4. Working `/api/v1/products`, `/api/v1/drops` endpoints (fixture mode initially) and note on provider permissions.
5. Session helper and agreed staff check. B must not write another auth layer.

**Before B relies on alerts**, send: stock event semantics; rule request schema; inbox behavior; local `sighting_approved` event interface for B reports to reach A alert engine, including source category `moderated_report` and unique ID. Create a versioned event envelope e.g. `{ event_id, event_type, occurred_at, evidence_type, entity_id, region_code, payload_version }` through the shared contract PR.

**Before production:** verify B's browser UX displays stock evidence and timestamps exactly; cross-test any pack/radar endpoints using same session/RLS standards. Review B migrations and privacy export/deletion hooks.

## 6. Mandatory PR/commit output from Codex

For each ticket provide:

- `Ticket`, one-sentence outcome, changed files, migrations and feature flags.
- Exact commands run and pass/fail results; if environment prevented a test, state that explicitly.
- Contract changes and B dependencies; links or files needed for handoff.
- Unit/integration/RLS test counts or cases, demo screenshots/API examples, security impact.
- Remaining blockers (source permission, API key, legal approval) and truthful coverage statement.
- Next smallest reviewable ticket; do **not** secretly proceed into B's lane.

## 7. Final acceptance checklist

- [ ] Same product mapped to distinct retailer listings, no bogus SKU merging.
- [ ] Permitted source evidence is attributable; fixture results visibly marked demo.
- [ ] Outage/429/missing field never changes state to explicit out-of-stock.
- [ ] TTL downgrades stale observations; last observation time always accessible.
- [ ] Every verified restock event is immutable/idempotent.
- [ ] Watchlists and alert rules respect seller, region, channel, price, evidence and preferences.
- [ ] Duplicate alert work causes no duplicate delivery record.
- [ ] Anonymous browsing, authenticated private endpoints and audited admin role work.
- [ ] Cross-user RLS, SSRF, secret leakage and rate-limit negative tests pass.
- [ ] Source health metrics and kill switch function.
- [ ] No external source or intellectual-property permissions are misrepresented.
- [ ] Staging app integrates with Developer B's actual screens and release report exists.

**Start with A-00 and A-01 only. Stop after each reviewable checkpoint and report results; the human developer chooses when to merge and proceed.**
