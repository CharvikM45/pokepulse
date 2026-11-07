# PokéPulse — Issue Board, Dependencies, Merge Protocol and Release Gates

**Purpose:** Execution schedule for two parallel Codex agents. These are **rough planning points**, not hours. Points balance to **120 A / 120 B**; adjust based on weekly evidence, not nominal parity.

## 1. Full ticket board

### Developer A — inventory intelligence and platform (120 points)

| Ticket | Pts | Priority | Target | Main dependency | Evidence to merge |
|---|---:|---|---|---|---|
| A-00 Source permissions/feasibility | 5 | Gate | W1 | None | Source register, fail-closed config |
| A-01 Monorepo bootstrap/CI | 8 | M0 | W1–2 | None | Clean build, CI, shared package imports |
| A-02 Auth/profiles/RLS | 8 | M0 | W2–3 | A-01 | Cross-user denies, public browse |
| A-03 Sealed-product/listing schema | 10 | M0 | W2–4 | A-01 | Canonical IDs, 50 demo examples |
| A-04 Provider adapter + lawful POC | 12 | M0/Gate | W3–5 | A-00,A-03 | Fixture replay + approval evidence for live connector |
| A-05 Scheduling/quotas/source health | 12 | M0 | W4–5 | A-04 | Retry/circuit breaker/quota tests |
| A-06 Stock truth/TTL/events | 11 | M0 | W4–6 | A-03,A-04 | Missing-field/outage never false OOS |
| A-07 Public catalog/drops APIs | 8 | M0 | W4–6 | A-03,A-06 | Zod/OpenAPI/fixtures, consumer API |
| A-08 Watchlist/rule matcher | 12 | M0 | W5–7 | A-02,A-06 | Eligibility edge-case matrix |
| A-09 Inbox/push/delivery pipeline | 12 | M0 inbox / M1 push | W6–8 | A-08 | Exact-once logical dedup + retries |
| A-10 Source-health admin | 6 | M0 | W7–9 | A-05 | Staff-only + kill switch |
| A-11 Privacy export/deletion integration | 6 | M0 | W8–10 | A-02,B-05,B-09 | Cross-lane data coverage tests |
| A-12 Integrated security/reliability QA | 10 | M0 | W9–12 | All A + B handshake | QA report, CI, source outage drill |
| **TOTAL** | **120** | | | | |

### Developer B — product UX, local, calendar, pack & collection (120 points)

| Ticket | Pts | Priority | Target | Main dependency | Evidence to merge |
|---|---:|---|---|---|---|
| B-00 UX map + content-rights plan | 5 | Gate | W1 | None | User flow matrix + rights flag specification |
| B-01 Responsive design system/shell | 8 | M0 | W1–3 | A-01 bootstrap | Components + mobile screenshots |
| B-02 Dashboard/Drops/Explorer/detail | 10 | M0 | W2–5 | A-07 fixtures/contract | Status-truth E2E + filters |
| B-03 Watchlist/alerts/settings UI | 8 | M0 | W4–7 | A-02,A-08,A-09 API | CRUD flow & inbox demo |
| B-04 Local stores API/map/list | 10 | M0 (list) / M1 (map) | W5–7 | A-02,shared product IDs | ZIP/radius/list fallback |
| B-05 Reports/moderation/expiry | 10 | M1 | W5–8 | B-04, A auth | Staff approval, privacy/RLS, conflicts |
| B-06 Calendar/release source provenance | 7 | M1 | W6–8 | A catalog IDs | Sourced/tentative date behavior |
| B-07 Card catalog/manifests/rights | 10 | M1/Gate | W7–9 | B-00, A auth | Variant correctness + gated assets |
| B-08 Coin ledger/odds/pack transaction | 13 | M1/Gate | W7–10 | B-07 | Concurrency/idempotency/rollback |
| B-09 Real/virtual inventory + progress | 10 | M1 | W8–10 | B-07,B-08 | Manifest-based progress + RLS |
| B-10 Pack reveal UI | 9 | M1/Gate | W8–10 | B-08 | Reload/retry saved-result E2E |
| B-11 Binder/collection UI | 10 | M1 | W9–11 | B-09 | Variant/dedup/missing export |
| B-12 UX/accessibility/integrated QA | 10 | M0/M1 | W10–12 | Integrated A+B | Device, a11y, E2E QA report |
| **TOTAL** | **120** | | | | |

**Balance note:** Equal points do not guarantee equal real effort. A's approved-provider access may be blocked by outside parties; B's rights-cleared assets and detailed variant research may be blocked by outside parties. Do not “fill” blocked time by fabricating integrations or copyrighted art. Rebalance code/test workload at end of each sprint.

## 2. Week-by-week paired milestones

| Week | Developer A | Developer B | Must demonstrate together |
|---|---|---|---|
| 1 | A-00 viability; A-01 skeleton | B-00 UX/rights; prepare components on scratch branch | Agreed architecture + source/rights gates |
| 2 | A-01 merged; A-02 auth start; A-03 schema | B-01 shell; B-02 fixtures | Both working off same scaffold + `contracts` |
| 3 | A-02 RLS; A-03 catalog; A-04 adapter | B-01 shell and B-02 product screens | Browse 50 clearly DEMO listings; signed-out works |
| 4 | A-04 source validation; A-05 scheduler; A-06 truth | B-02 Explorer/detail; B-03 watch UX | Demo status truth, exact listing/watch semantics |
| 5 | A-06 event stream; A-07 public APIs; A-08 rule base | B-03 alert UI; B-04 ZIP/store finder | Typed API integrated: clear stale vs fresh badges |
| 6 | A-08 match tests; A-09 inbox groundwork | B-04 store list/map; B-05 reports; B-06 release entries | Watch -> synthetic restock -> one inbox notification |
| 7 | A-09 send+retry; A-10 operator flags | B-05 moderation; B-06 calendar; B-07 catalog/rights | Local report -> moderation -> labeled signal |
| 8 | A-10 ops; A-11 privacy design | B-07 manifest; B-08 transactional packs; B-10 UI | Fixture card pack exactly matches server result |
| 9 | A-11 privacy + system tests | B-08 concurrency; B-09 inventory; B-11 binder | Opening -> saved virtual cards; real independent |
| 10 | A-12 security/source failure drills | B-09/B-10/B-11 complete; B-12 a11y | No double spend, no false stock, no cross-user leaks |
| 11 | A-12 reliability + staging support | B-12 integrated mobile/E2E fixes | Beta walkthrough with no high-severity defects |
| 12 | A final source/ops signoff | B final UX/rights signoff | Scoped beta launch decision or honest fallback |

Weeks are illustrative for two part-time developers. Dependencies, permitted source access and rights clearance may extend timelines.

## 3. GitHub workflow and code ownership

**Branches:** `main` protected, each task on `feat/a-XX-short-name` or `feat/b-XX-short-name`; bugfixes `fix/a-...`, `fix/b-...`. No two Codex agents should write to one local working directory. Use separate clones/worktrees. Both review `packages/contracts` and cross-domain SQL; one review by other developer on all PRs when practical.

**Commit conventions:** `feat(inventory): ...`, `feat(ui): ...`, `feat(radar): ...`, `feat(packs): ...`, `test(auth): ...`, `docs(ops): ...`. Every PR mentions ticket ID, route/schema changes, tests, screenshots, feature flags, outstanding source or rights gates and known limitations.

**Folder responsibility (summary):** A — workspace config, auth, inventory, alerts, ingestion, operator panel and provider docs. B — UI design system, user routes, radar/moderation, calendar, pack/collector domain, art placeholders. Shared contract and cross-cutting migrations reviewed by both.

**PR gates:** `pnpm install --frozen-lockfile` (in CI), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; relevant Playwright, SQL/RLS and migration checks when touched. Failure blocks merge. Do not assert CI passes when commands weren't run.

**Schema protocol:** every migration includes `up` statement(s) and documented rollback/forward-fix strategy; migration files are immutable after merge; never modify prior migration silently. If B needs FK to A-owned products/profiles, A merges prerequisites first. Use UTC timestamp or ordered unique suffix to avoid merge collision; run complete migration sequence on clean DB in CI.

**API protocol:** Contract-first: change Zod DTO + OpenAPI + fixtures, get both approvals, then update handler and consumer; maintain error schemas and owned endpoints. B cannot silently add required fields to A's stock APIs. A cannot silently remove B's pack endpoints.

## 4. Required coordination checkpoints

### Checkpoint I (end week 2): app and auth foundation

- [ ] Same root package-lock strategy (pnpm; one lockfile) and one app bootstrap.
- [ ] Shared enums/DTOs compile; request/error shape exists.
- [ ] B can import `packages/ui` and consume A fixtures.
- [ ] Supabase local DB resets from ordered migrations; RLS baseline tested.
- [ ] No real retailer source marked approved without evidence.

### Checkpoint II (end week 4): evidence-first product screens

- [ ] `GET products` and `GET drops` return typed fixtures and real observed data separately.
- [ ] B labels `retailer_api` vs `moderated_report` vs demo; age/TTL is explicit.
- [ ] Seller/format/filter API matches visible filter controls.
- [ ] `404`, no-results, 429 and provider-unavailable states render correctly.
- [ ] Normalized canonical product and individual retailer listings are separate.

### Checkpoint III (end week 7): tracking + alerts + local

- [ ] Explicit stock out->in produces one immutable event; retry produces no duplicate.
- [ ] One eligible rule yields one in-app notification; cross-user inaccessible.
- [ ] Non-supported push falls back to inbox and opt-in UI.
- [ ] Pending sighting invisible; approval visible as community-reported only.
- [ ] Report conflicts and expiry work without source spoofing.

### Checkpoint IV (end week 10): Pack Lab + privacy

- [ ] Rights flag gates original/cleared content; unsupported public card art is disabled.
- [ ] Free pack uses one DB transaction, no double debit on retries.
- [ ] Pack draw fixed server-side before reveal; card variants in eligible pools.
- [ ] Real collection and virtual collection update separately.
- [ ] Base/Master/Extended denominator equals validated manifest.
- [ ] Account export/delete covers B-owned + A-owned personal tables.

### Checkpoint V (week 12): launch/no-launch

- [ ] All release gates in Section 6 are completed or explicitly restrict launch scope.
- [ ] Cross-lane E2E passes with no fabricated retailer confirmation.
- [ ] Admin can disable compromised provider / withdraw unlicensed art quickly.
- [ ] Both developers sign off on staging with source/rights limitations documented.

## 5. Mandatory cross-lane E2E scenarios

1. **Anonymous + demo:** browse product and drops in fixture mode; visible `DEMO DATA` marker and no official stock claim.
2. **Real positive source:** when approved, one explicit permitted fresh observation displays source, seller, channel, time, region and honest “in stock” label.
3. **Missing source field:** returned `unknown`, never out-of-stock, no “stock depleted” alert.
4. **Outage:** prior positive ages past TTL -> displays last seen + stale; no fresh restock push.
5. **Restock retry:** explicit out-of-stock -> in-stock twice delivered by job queue -> one stock event + one inbox message.
6. **Marketplace:** rule first-party-only + third-party listing -> does not trigger.
7. **Price:** null price + price ceiling rule -> non-match; price in wrong currency not silently compared.
8. **SKU collision:** similarly named exclusive formats don't merge into same product identity.
9. **Authenticated watch:** user saves exact SKU vs parent product, persisted after refresh.
10. **RLS:** user X cannot access user Y's rules, notifications, wallet, openings or real collection.
11. **Local approved:** ZIP radius -> store -> user report -> pending -> staff approved -> public label `Community reported`.
12. **Local conflict/expiry:** one found, one empty -> conflict indicator; after TTL neither claims current stock.
13. **Spam:** repeated user self-report cannot boost independent confirmations; unprivileged moderation denied.
14. **Calendar:** unconfirmed month-level release date doesn't become exact day in user's timezone.
15. **Pack retry:** two same-key requests return one opening/ledger debit/result; different payload with reused key conflicts.
16. **Pack rollback:** induced DB failure leaves wallet/opening/inventory unchanged.
17. **Pack eligible cards:** no unsupported finish/variant appears across deterministic fixture run.
18. **Pack UI reload:** user reloads during animation; saved result/history persists unchanged.
19. **Virtual vs real:** virtual pack only changes virtual binder; manual real edit only changes real binder.
20. **Privacy delete:** deletion/export request is authorized and covers both lanes' personal records, without remaining public user activity trails.
21. **Accessibility:** keyboard-only filter, alert creation, report form and pack reveal; reduced-motion and 360px layout.
22. **No rights:** with licensed art flag off, only original safe placeholders are served and disabled sets cannot open.

## 6. Release gates and fallback plan

**GATE 1 — Retailer source legality/operational usability.** To publish `retailer_api` or `permitted_partner` stock status, record source approval and evidence of live, permitted, correctly scoped data. Without one, ship **catalog + local community beta** only; all retailer availability statuses stay unknown or clearly historical/demo.

**GATE 2 — IP/content rights.** Legal/permission review required for public Pokémon-specific brand and official card art; working name remains provisional. Without cleared content, use original branding, fictional cards/images, and disable real-set Pack Lab. Third-party API metadata rights do not imply official art rights.

**GATE 3 — Reliability/security.** No unresolved critical/high severity bugs in stock truth, RLS, pack charges, reports or privacy. Synthetic test objectives (not achieved until measured): 100% displayed stock cards show origin/age; no stale source mislabeled current; duplicate alert deliveries 0 in replay suite; concurrent pack writes 0 double spend.

**GATE 4 — Launch experience.** Main screens work at 360px; anonymous browse, error states, keyboard accessibility, feature flags, account deletion/export and operator kill switch pass acceptance tests.

**If a gate fails:** reduce public surface area, retain feature implementation behind disabled flag, and state accurately what the beta supports. Never substitute fake inventory for unavailable data or unlicensed graphics for legal approval.

## 7. Weekly check-in template (both developers paste into PR or issue)

```text
Week:
Developer:
Completed tickets / merged PRs:
Working now:
Tests actually run / status:
UI screenshots or API evidence:
Contract/schema changes requested:
Blockers (access, rights, data, dependencies):
New risks and mitigation:
Proposed next tickets and point rebalance:
```

## 8. Final acceptance artifacts

- A: provider viability/permission register, inventory schemas and migrations, tested adapter(s) or explicit blocked mode, job/event log, watchlist/alerts, operator runbooks, security/RLS report.
- B: responsive design system, all discovery pages, Local Radar/moderation, sourced Calendar, rights-aware card catalog, transactional Pack Lab, real/virtual binders, UX/a11y report.
- Joint: shared contracts, migrations run from clean DB, fixtures and replay harnesses, Playwright E2E run, deployment and incident/rollback playbook, honest release-gate signoff.

**Finish definition:** Working staged app with truthful supported features and clear disabled-feature reasons, not a one-shot pile of generated code.
