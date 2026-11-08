# CODEX MASTER PROMPT — DEVELOPER B

**Assignment:** PokéPulse Developer B — mobile-first product experience, Local Radar + moderation backend, release calendar, free Virtual Pack Lab + transactional wallet, real/virtual collections and accessibility. **Estimated scope: 120 relative planning points.**

> **Codex: treat this file as your work order. FIRST read `01_SHARED_ARCHITECTURE_AND_CONTRACTS.md` and `00_START_HERE.md` in full, inspect the actual repository, and honor their boundaries. Developer A owns the one-time Next.js bootstrap, auth platform, inventory truth APIs, alerts and contracts merge. You own the main UI, radar/calendar domain and Pack Lab/collections domain, including their server and SQL components. Build in small mergeable tickets; never label fixture stock “live.”**

## 1. Role and outcome

You own everything a collector **sees and touches**—an elegant and unusually clear mobile-first experience—and the independent backend domains for physical store reports and virtual collecting. The result must be useful to a shopper who just wants accurate listings, and fun for a collector who optionally wants to browse cards, open **free simulated** packs and track real/virtual collection progress.

Your screens consume A's typed product, stock-truth, watchlist, alert and authentication contracts; they **must not** reimplement stock or alert rules, query retailer systems directly, or compute a separate availability truth. Conversely, A does not implement your sighting/moderation, card catalog, wallet, pack draw or collection services.

## 2. UX principles and constraints

- Mobile-first at 360px, high-contrast, WCAG 2.2 AA target, accessible keyboard and screen-reader flows, reduced-motion mode, usable light/dark themes.
- An honest inventory experience: **availability**, **evidence**, **freshness**, **seller**, **channel** and **age** must all be readable in appropriate context; don't use visually impressive but false “LIVE NOW” badges.
- Anonymous browse, progressive sign-in when saving a watchlist, alert, sighting or collection. Request notifications only after an explicit user action; the in-app inbox works even without push.
- Original PokéPulse working-name aesthetic, **not** official Pokémon trade dress. No unlicensed card artwork or logos in publicly served assets. Build original neutral placeholders and swap via permissions-controlled asset provider.
- Virtual coins are free-only, cannot be purchased/transferred/redeemed/wagered, and virtual cards are not physical or tradable. Avoid streak-loss penalties or prompts pressuring repeat openings.
- A free simulated pack is not a real purchase, prize or guaranteed exact physical pull odds. Any third-party estimates need published methodology, sample size, date, source and uncertainty disclaimer. No supported source → clearly fictional odds or disabled set.
- Existing proposal is scope guidance; the binding architecture lives in `01_SHARED_ARCHITECTURE_AND_CONTRACTS.md`.

## 3. Parallel-start instructions

Before A's bootstrap is merged, draft a UI system and fixture-driven pages/components in your **own** scratch directory/branch, following agreed component names. Do **not** initialize a second Next.js project or create competing toolchain configs. When `A-01-bootstrap` merges, rebase onto `main`, populate B-owned `packages/ui`, `apps/web/src/features/` and consumer routes. Ask A for fixture client and auth helper exports if missing; do not build duplicates.

## 4. Milestone-by-milestone execution

### B-00 — UX architecture, scope/rights map (5 points; week 1)

**Build:** `docs/ux/information-architecture.md`, `docs/ux/user-flows.md`, `docs/content-rights/asset-policy.md`. Map routes: `/`, `/drops`, `/products`, `/products/[id]`, `/local`, `/calendar`, `/lab`, `/sets/[id]`, `/collection`, `/dashboard`, `/watchlist`, `/alerts`, `/settings`. Define navigation, no-login browsing, saved interactions, error/empty/denied-source states. Create low-fidelity wireframes / component inventory using text and original wireframe assets; no official brand mimicry.

**Acceptance:** Every flow has loading, empty, error, stale/demo and signed-out states. Stock displays do not obscure evidence. All features dependent on licensed art or estimated physical odds are behind explicit flags. Document mobile and keyboard interaction maps.

### B-01 — Design system and responsive app shell (8 points; weeks 1–3)

**Build:** `packages/ui` design tokens and components: typography scale, semantic status styles, color contrast, cards, inputs, searchable combobox, filters, tabs, modal/dialog, toasts, accessible form validation, skeleton, pagination, empty/error cards, bottom mobile navigation, desktop sidebar/top bar, focus restoration. Use subtle navy/teal/yellow accent with accessible neutral alternatives; support light/dark. Establish accessible status badge that presents text + icon **not color alone**.

**Acceptance:** At widths 360, 390, 768, 1024 and 1440 px, no horizontal overflow or inaccessible controls. Reduced motion disables decorative animation. Components have keyboard and focus tests. App shell loads without private API keys or auth state. Commit screenshot/story fixtures.

### B-02 — Dashboard, Live Drops, Explorer and product detail UX (10 points; weeks 2–5)

**Build:** Screens consuming A's **typed** endpoints and fixtures only:

- Home/dashboard: contextual featured drops, followed products, recent alert activity, source freshness warning, opt-in onboarding; signed-out mode shows browsing CTA without revealing personal data.
- Live Drops: time-stamped event feed with availability/evidence/freshness/seller/channel/price; exact “source checked N min ago” text; price and marketplace seller clarifiers; filters; quick watch.
- Product Explorer: search/sealed-product format/set/retailer/price/seller/channel filters, sort, query URL shareability, skeleton/empty/error views.
- Product detail: canonical product, distinct retailer offers, clear direct retailer link, price-per-pack only when pack count verified, reference MSRP only when sourced, stock timeline that includes gaps, source and age explanation.
- Distinct visually labeled fixture mode for missing real integrations; no misleading “verified live” badges.

**Acceptance:** A URL with filters can be refreshed; browser back works; source unavailable and stale states are always visible; listings without prices do not show `$0.00`; third-party seller is obvious; user never accidentally treats simulation/demo as observed stock. No client-side invented `in_stock` truth. Responsive product grid/table switch is accessible.

**Tests:** Playwright browsing/filter/detail/signed-out/empty/stale/third-party/demo; keyboard filter operation; contract fixtures from A.

### B-03 — Watchlist, alert builder, notification inbox and account UX (8 points; weeks 4–7)

**Build:** Consumer UIs for A-owned API: sign-in/recovery screens, personal dashboard, watch product vs watch exact listing, alert-rule wizard, live preview of match criteria, chosen retailers/sellers/region/price/channel, quiet hours, per-day caps, notifications inbox/read status, account preferences, account export/delete request. Show push permission flow only after a user asks to enable it. Provide platform support message (including iOS Home Screen caveat) without implying universal browser push.

**Acceptance:** Form inputs align exactly with `AlertRuleDTO` and A's server validator, server errors render actionable messages, rule pause/edit/delete round-trips with A's API. Account screens never expose other users' data; deletion text describes queued/pending status accurately. If push permission denied, inbox remains functional.

### B-04 — Local Radar store finder, APIs and private data handling (10 points; weeks 5–7)

**Build:** `stores` schema + compliant store directory source/seed; `GET /api/v1/stores` by ZIP/radius; store detail with permitted store-address details and map directions; map with MapLibre plus licensed/compliant tile provider behind env config; list fallback if tiles unavailable; bounded geocoding and cache. Avoid collecting/reporting real-time GPS; use ZIP centroid / coarse general region with user control. Store data can be seeded as **demo** with visible markers until licensed store data access is established.

**Acceptance:** ZIP validation, radius bounds, map/list, no public reporter location, no tracking user movement. Selecting a store displays timestamped moderated reports and contradiction indicators, not store-verified guarantees. Map absence still allows usable store list. Tiles/attribution comply with provider terms.

**Tests:** ZIP/radius bounds, missing coordinates, store listing, no location permission fallback, cross-user privacy and responsive touch controls.

### B-05 — Sightings, report moderation and local confidence (10 points; weeks 5–8)

**Build:** `sightings`, `sighting_confirmations`, `sighting_moderation_actions` and staff review queue. Authenticated report submission for `found_stock` or `shelf_empty` with observation time, optional selected product/store, safe text limits, anti-spam and per-user cooldown. Reports default pending; independent staff approval then public display; conflicting reports remain visible as conflicts. Expire by configured age and enforce expiry at read time (not solely cron). `independent_confirmations` excludes same user and self-report repeats. Optional photo upload is *off* until storage/privacy/moderation is actually built.

**Alert interface:** On approval, publish a versioned, deduplicable `sighting_approved` envelope with `moderated_report` evidence; A's rules engine handles notifications. Do not send your own ad hoc push. Ensure a moderation reversal/expiry cannot leave a report showing fresh stock.

**Acceptance:** Report never masquerades as official stock; regular users cannot approve; repeated same account doesn't boost confidence; `shelf_empty` reports don't become authoritative out-of-stock retailer statuses; no rewards for filing reports; rate-limited abusive accounts cannot publish unreviewed content.

**Tests:** Pending/approved/rejected/expired, conflicts, repeated self-confirmation, spam, staff role RLS, malicious notes, personal-info leakage, report expiry and notification event integration.

### B-06 — Drop Calendar and release-data integrity (7 points; weeks 6–8)

**Build:** `releases` schema + source-curated release entry workflow (no fabricated dates). Source URL, region, type, `date_precision`, last verified date and edit history. Calendar month/list UI with confirmed vs tentative, preorders vs product releases, link to product Explorer, optional “follow reminder” integration through A's alert-rule event interface. Treat time-zone dates carefully so day-only releases don't shift a day in local time.

**Acceptance:** Unknown dates visibly say unconfirmed and sort separately. Source/editorial entries are not retailer stock. User can filter by set/type/region. Cache dates but retain audit trail.

### B-07 — Rights-aware set/card/variant catalog and manifests (10 points; weeks 7–9)

**Build:** Abstraction to compare permitted TCG card metadata services (TCGdex/Scrydex or equivalents) under documented access/licensing. Keep metadata provider separate from inventory provider. Curate sample set config with **fictional original art** for safe demo plus separate disabled real-set metadata records as allowed. SQL: `tcg_sets`, `cards`, `card_variants`, `master_set_manifests`, requirements. Each card's eligible finishes/variants must be explicit, not inferred by a blanket reverse-holo flag. Three collection goals: Base (all numbered cards), Master (published manifest of in-set eligible variants), Extended (separate eligible promo/special editions). Version manifests.

**Acceptance:** `GET /api/v1/sets` and `/sets/:id/cards` return accurate source/rights state; no copyrighted card images published without clearance. Missing variant data is reported as unknown/incomplete; master-set denominators derive only from validated manifests. Do not assume a third-party API license is artwork permission.

**Tests:** Correct variant eligibility, duplicate collectible card numbers from unrelated sets, disabled rights, manifest version migration, no placeholder denominators presented as real.

### B-08 — Free-only wallet, versioned odds and atomic pack generator (13 points; weeks 7–10)

**Build:** `wallets`, `coin_ledger`, `pack_odds_versions`, `pack_slot_rules`, `pack_openings`, `opening_cards`, `virtual_inventory`, all with RLS and idempotent server transaction. Opening starts with authenticated request and server-side random draws from an active pack configuration. Backend checks free opening allowance/coin balance; derives eligible variant per slot; atomically debits/grants appropriate free balance, writes ledger+opening+cards+virtual inventory; returns immutable result. Retry same idempotency key+body returns identical committed opening; retry with different body conflicts. If insufficient coins or disabled set, return correct typed error **without** any write.

**Economy:** All coins are freely earned; optional free opening allowance and transparent deterministic daily reset with timezone rules. Avoid paid purchases, speculative financial value, trading, cash-out, reward-driven store sighting abuse or punitive streak design. Initial coin prices are **tunable defaults**, not physical pack prices. Do not add payment SDKs.

**Odds:** For real set simulation, exact English physical pull odds are often unpublished; source independently estimated probabilities, methodology/sample/checked date and confidence caveat, or explicitly call the model fictional. Version every rule/odds change and preserve version on opening. Respect set-specific slot composition; no unsupported finish. Make a test harness for large-run aggregate sampling and stable seeded test mode (not client-controllable production seed). Server result precedes any animation.

**Acceptance:** In concurrent requests, no negative balance, double debit, inconsistent ledger, duplicated idempotency results or variant outside declared slot pool. `pack_lab` stays disabled publicly until rights/content gates pass; internal original-card fixtures may be used in staging. Clear result disclosure: free simulation, no physical ownership, probabilities are estimates/fictional as labeled.

**Tests:** Concurrent same/different idempotency keys, rollback on DB failure, known output under seeded testing, unsupported variants, coin shortage, reset boundary, manifest/odds version migration, ownership RLS, statistical conformity to **configured** distribution.

### B-09 — Separate real/virtual inventory and accurate completion (10 points; weeks 8–10)

**Build:** APIs for opening history, real collection manual editing, virtual collection reads, `CollectionProgressDTO` by set+manifest version, missing list CSV, duplicate quantities, binder pagination. `virtual_inventory` changes exclusively via pack-opening transaction; user may add/remove only `real_inventory`. Validate `card_variant_id`, owned quantity, real notes; protect export and share settings. `Base`, `Master`, `Extended` manifests differ as specified.

**Acceptance:** Virtual pull never appears in real inventory; manually added real card never appears as virtual pull; exact variant count increments once per opening; reverse finish counts separately from standard. Manifest changes recalculate progress with displayed version and no silent count drift. Unknown master-set scope is labeled incomplete, not shown as 100%.

**Tests:** 2 users separation, duplicate pull aggregation, real add/edit/delete, unsupported variant, missing checklist integrity, CSV escaping, completed vs partial set counts.

### B-10 — Pack Lab UI, reveal animations and transparent disclosures (9 points; weeks 8–10)

**Build:** Landing page with available (rights-approved) simulated sets, free coin wallet and optional free opening allowance, disclosed odds/version/methodology, opening action, server response and then tasteful optional pack animation, sequential card reveals, recap, graceful network retry/resume from persisted result, pack opening history. If browser reloads after transaction but before animation, user must still see the saved opening. Keep placeholder original pack and card graphics. Honor reduced-motion settings and a “Reveal all” skip action.

**Acceptance:** No visual randomization that disagrees with server result; no fake “guaranteed rarity” language; free simulated content is labeled as not a real card or prize; animation never charges twice; keyboard/screen-reader mode offers straightforward card list. Prefer optional achievements/progress over compulsory daily engagement loops.

**Tests:** Reload mid-reveal, double click, network retry, server error, disabled set/rights, pause/resume, skip animation, accessibility/reduced-motion.

### B-11 — Binder, real collection and collector tools UI (10 points; weeks 9–11)

**Build:** Virtual/real segmented collection pages, 3x3/nine-card binder grid with compact list fallback, set tabs, variant/rarity/number search/filter/sort, owned/missing silhouettes using original licensed-safe placeholders, duplicate counts, total/base/master/extended completion, “why missing?” explainer, opening history and missing-card CSV export. Real collection manual add quantity/note modal. Shareable collection view is private/off by default and **not MVP** unless privacy rights are reviewed.

**Acceptance:** Variant-specific completion, explicit goals and manifest provenance. No copyrighted imagery without approval. Large inventories virtualize/paginate efficiently; mobile cards and overlays remain usable. Anonymous view may show a **demo sample** but must not imply possession of physical cards.

### B-12 — Accessibility, mobile E2E and integrated release QA (10 points; weeks 10–12)

**Build/test:** Full Playwright journey: browse -> product/watch -> rule -> A event -> inbox; select ZIP -> submit local report -> approve -> surface with evidence + expiry; choose free pack -> transaction -> reveal -> virtual binder update; manually add real card -> real only; anonymous/unauthorized flows. Run automated a11y checks where practical and manual keyboard/screen-reader smoke; measure core web vitals in staging; verify 360px, keyboard, contrast, focus, semantic status, reduced-motion and no forced login for public browsing. Document `docs/qa/B_RELEASE_REPORT.md` with screenshots, test logs, known gaps and rights status.

**Acceptance:** No UI implies live stock when A is in fixture mode; no keyboard-only dead ends, no PII map trails, and all high-risk wallet/sighting/privacy flows pass with actual backend integration.

## 5. Screen-level acceptance requirements

### Dashboard

Shows source status banner if data source disabled/degraded; personalized cards only after sign-in; recent verified listing events show retailer/time/evidence; easy watchlist access. Keep Packs/Collection secondary to Live Drops for product hierarchy.

### Live Drops & Explorer

Separate availability status from evidence and freshness, visible seller + channel; time-localized observed timestamps and tooltips explaining age; no hidden price comparison when missing MSRP. Preview/activate exact-product vs all-listings watch semantics. Degrade gracefully when permitted inventory source unavailable.

### Local Radar

Store map + accessible text alternative, ZIP/radius, public store information, approved report history, conflicts and expiry, clear “community reported / not store verified” label. No public precise reporter GPS, no reputation score that simply rewards mass reporting.

### Alerts Settings

Exact rule filters, quiet hours and daily caps, inbox/push opt-in and unsubscribe. Validation must reflect A's backend. If enabled alert requires source not currently available, say so clearly rather than silently claiming operation.

### Pack Lab

Fictional/estimated simulated rates disclosed *before* opening; free-only, no cash value, no real prizes or physical ownership. Server-committed result visible after retry/reload. No manipulative streak breaks, social wagering or pay-to-open.

### Collections

Virtual and real tabs visually distinct; Base vs Master vs Extended definitions clear; every completion fraction backed by a validated manifest; duplicate finish quantities accurate; export missing list. Disable questionable real-set content until license/rights review.

### Error & empty states

A failed source check shows stale/unavailable, not empty inventory = sold out; a missing map provider shows list view, not app crash; a pack DB error does not deduct coins; unsigned user sees noncoercive sign-in explanation and can still browse public pages.

## 6. Developer A integration handshakes

**At bootstrap:** obtain contract package, standardized API response/fixture client, session/auth helper and feature flag API from A. Send A the consumer route inventory, component props and user journey acceptance list.

**At drops:** B consumes A's DTOs; A is the only source of truth. Test `in_stock_fresh`, `last_known_stale`, `rate_limited_source`, `third_party_seller`, `SKU_collision` and demo warnings. Do not create a second server API endpoint to match UI assumptions; propose contract PR instead.

**At local:** give A `sighting_approved` event envelope and store/radius handling assumptions; use A alert engine for notifications; coordinate shared `products` FK and `profiles` RLS.

**At pack:** send A B-owned migrations/table retention policy and privacy export/delete requirements. Pack backend uses A session and shared response envelope, but B alone owns transactional pack logic.

**At release:** request A's permission/source status and ensure flags disable unapproved live inventory and unlicensed art. Test shared E2E, not just isolated mock screens. Review A's stock-timestamps text for misleading freshness.

## 7. Codex completion/reporting format

For each B ticket return:

1. Ticket ID and scope completed, changed paths, migrations and screens.
2. Commands actually executed and passing/failing test results; do not fabricate test results.
3. Screenshot coverage for 360px/mobile + desktop, accessibility checklist and empty/error states.
4. Contract dependencies or proposed amendments (do not silently change A files).
5. Content-rights limitations and flags, including all placeholder/demo sources.
6. Known limitations, PR description and next reviewable task.

## 8. Final acceptance checklist

- [ ] Responsive, accessible light/dark UI with no bogus “live” labels.
- [ ] Public browsing works without login; account features use A's auth.
- [ ] All discovery pages consume A's typed stock/feed/product APIs.
- [ ] No one could infer user's exact location/activity trails from Radar.
- [ ] User reports remain pending until moderated; conflicting/expired states are explicit.
- [ ] Release calendar differentiates confirmed vs unconfirmed sourced dates.
- [ ] Card metadata, art and set eligibility obey rights flags and provenance.
- [ ] Free-only virtual wallet and pack writes are atomic/idempotent; no cash/prize mechanisms.
- [ ] Simulated odds are versioned and transparently estimated or fictional.
- [ ] Virtual versus real collection ownership never contaminates the other.
- [ ] Base/Master/Extended progress derives from validated variant requirements.
- [ ] E2E, RLS, keyboard/reduced-motion and mobile tests pass with integrated A services.

**Start with B-00 and B-01. Keep separate working tree/branch from Developer A, stop after each PR-sized milestone and report work honestly.**
