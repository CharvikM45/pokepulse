# Developer B release report

Date: 2026-11-07. Branch: `feat/developer-b-product`, based on A platform commit `e9dba87a4fce51331d6597e95ac8d6b0cbab09c2`.

**The B implementation is integrated locally. Public launch and hosted staging acceptance are not cleared.** Local evidence does not establish hosted authentication, provider permission, device push delivery, screen-reader conformance or field Core Web Vitals.

## Ticket delivery

| Ticket | Implemented scope and primary paths                                                                                                                                  | Local verification / remaining gate                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-00   | `docs/ux/` IA, route/flow/state maps and wireframes; `docs/content-rights/` policy/provider comparison                                                               | All required consumer routes exist; rights-dependent features default off                                                                                            |
| B-01   | `packages/ui/src/` tokens, inputs, status, combobox, tabs, dialog, toasts, skeletons, pagination and responsive shell                                                | Keyboard/focus/error tests; five viewport widths, light/dark and reduced motion                                                                                      |
| B-02   | Consumer home, Drops, Explorer, product detail and dashboard in `apps/web/src/features/consumer/`                                                                    | A typed APIs; shareable filters/back/refresh; separate listing/product cursors; stale/unavailable/demo/third-party/null-price cases; A revalidation on source expiry |
| B-03   | Watch product/exact offer; rule wizard with preview, pause/edit/delete; inbox, auth/recovery, preferences/quiet hours, push opt-in/unsubscribe and queued privacy UX | Transport tests plus real local GoTrue/private HTTP/watch/inbox/privacy checks pass; hosted email/recovery and device push remain staging gates                      |
| B-04   | Store/ZIP-centroid tables, bounded nearby RPC/API, public directions, MapLibre adapter and list fallback                                                             | ZIP/radius/coordinate and no-GPS checks; no live directory or tile provider is configured                                                                            |
| B-05   | Private reports, independent confirmations, staff queue/revisions, expiry and transactional outbox                                                                   | RLS/staff/expiry/concurrency tests plus real local pending/approval/confirmation/A worker/inbox/reversal journey pass; hosted deployment acceptance remains pending  |
| B-06   | Sourced calendar month/list/filter UI and staff release editor, versioned edits and null unknown dates                                                               | Date/timezone, source/precision/retry/revision tests; no fabricated release dates are seeded                                                                         |
| B-07   | Rights-aware metadata boundary, original Lumen Grove catalog, explicit variants and immutable published manifests                                                    | Permission expiry/revocation, exact scope, unknown denominators and source grants tested; real provider/art access remains disabled                                  |
| B-08   | Wallet, ledger, versioned odds/slot rules and atomic server pack opening                                                                                             | Twenty independent PostgreSQL connections exercise idempotency, balances, rollback and UTC free allowance; no payments or client seed                                |
| B-09   | Private opening history/recovery, locked collection snapshots, idempotent real edits, progress and missing CSV                                                       | Two-user SQL isolation; absolute edit retry cannot overwrite a newer edit; notes preserved; private mode/version/goal exports                                        |
| B-10   | Saved-result reveal, pause/resume/skip, reload/retry/history and reference-only recovery cache                                                                       | Controller and application-adapter tests cover lost/ambiguous acknowledgment, double click, reload, rights-disabled recovery and account switching                   |
| B-11   | Nine-card grid/list, set/mode separation, number/name/rarity/finish/ownership filters, duplicates, goal provenance and real editor                                   | 1,000-variant fixture renders at most nine cards; keyboard focus after save, partial/error snapshots and export retries tested                                       |
| B-12   | Production-browser journeys, isolated component/adaptor suites, automated accessibility, screenshots, native SQL concurrency and local timing                        | Local and GitHub CI checks pass, including Docker Supabase; hosted staging, manual screen-reader/device checks and staging CWV remain outstanding                    |

## Commands and results

Environment: Node 22.14.0, pnpm 10.34.9, TypeScript 5.9.3, Next 16.4.5, React 19.3.1, Chromium Playwright 1.65.0. Native database checks used portable PostgreSQL 18.6 on loopback, with disposable auth-role stubs.

| Command                                                                          | Evidence                                                                                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                      | Passed; generated coverage/results are excluded                                                                                     |
| `pnpm typecheck`                                                                 | Passed, including interactive story fixtures                                                                                        |
| `pnpm test:coverage`                                                             | 106 tests passed across seven files; V8 coverage is scoped to the instrumented process, not browser/SQL execution                   |
| `pnpm test:collector`                                                            | Collector subset: 33 policy/provider/recovery tests; included in the main suite                                                     |
| `pnpm build`                                                                     | Production build passed for every required page and API gateway                                                                     |
| `pnpm test:e2e`                                                                  | 21 tests: actual anonymous HTTP/browser flows plus explicitly named transport-stub private flows                                    |
| `pnpm test:components`                                                           | Seven isolated controller/component suites; 80 viewport/theme axe scans                                                             |
| `B_TEST_ADMIN_URL=… pnpm test:collector:concurrency`                             | Eleven native concurrency groups with 20 independent connections; generated isolated database retained for inspection               |
| `pnpm format:check`                                                              | Passed before handoff                                                                                                               |
| `B_ACCEPT_DISPOSABLE_LOCAL=true pnpm test:collector:http <temporary-status.env>` | Six real local Supabase acceptance groups passed, including one production Playwright browser journey; no intercepted API responses |

The native groups cover same-key pack replay, distinct-key balance/ledger consistency, injected rollback, one UTC allowance, used-odds immutability, binder reads waiting for commit, deduplicated report submission, competing stale moderation, parallel outbox publication real-edit replay after a newer quantity, and deletion waiting for in-flight curation before audit redaction.

GitHub [PR CI run 42420003614](https://github.com/CharvikM45/pokepulse/actions/runs/42420003614) passed all three jobs for source commit `7006b38`: `quality` (install, lint, typecheck, coverage, build, browser E2E and component suites), `database` (Docker Supabase start/reset/pgTAP), and `collector-concurrency` (PostgreSQL 18 service). The sanitized job/step status record is `docs/qa/evidence/collector/github-ci.json`. These CI services do not establish hosted email, supported-device push, manual accessibility or field performance.

The later [PR CI run 42421816758](https://github.com/CharvikM45/pokepulse/actions/runs/42421816758) passed all three jobs for commit `a8e976e`, including six new acceptance groups against actual Docker GoTrue, PostgREST and production Next. They cover cookie sign-in/CSRF/anonymous denial; watch replay/two-user isolation; pack replay/history and separate real/virtual edits; pending reports, independent approval/confirmation, opt-in, A matching/inbox and reversal; a real Playwright watch/dashboard/pack-reveal/reload/binder-edit journey; and B export contents/account deletion through the actual privacy worker. `authenticated-http/` holds the downloaded, credential-free result and two 360px screenshots. The job/step record now references this latest source run.

That integration exposed and fixed a worker startup defect: `web-push@4.0.0` has named ESM exports, so the shared worker now uses a namespace import. The test also explicitly opts into inbox delivery through the preferences API; fresh accounts correctly default to opted out. Native ESM module loading and local typecheck passed after the fix. No migration changed.

## Accessibility, mobile and evidence

The application sweep covers 13 routes at 360/1440px in light/dark themes, using WCAG 2/2.1/2.2 AA axe tags. Private adapter screens add checks for binder, alerts and calendar. Component suites cover 360, 390, 768, 1024 and 1440px, keyboard tabs/combobox/dialog/focus, errors, notifications, reduced-motion reveal controls and large binder pagination. No automated violations or horizontal overflow were reported in the passing runs. This is not a full WCAG conformance audit.

Evidence is under `docs/qa/evidence/collector/`: application screenshots, component result JSON, native result summary, coverage summary and local timing. Test-generated bundles/screenshots remain under ignored `test-results/` during development. The performance record is one unthrottled loopback Chromium observation; it is not staging or field CWV, and INP is not claimed.

## Migrations, contracts and privacy

Eight additive B migrations (`20261107000000` through `20261107070000`) create 27 RLS-protected B tables and the platform bridge. No A migration was rewritten. B global and internal gates remain off. The original fictional seed uses ZIP `00000`, an imaginary store and original geometry/text placeholders; it does not establish live inventory or real-store data permission.

`docs/adr/0003-collector-contracts.md` lists every shared amendment, including nullable unknown dates/scopes, source revalidation, gateway routing, staff/flag/current-signal integration, session refresh, privacy registration, tooling and seed changes. Cross-developer review is pending; no A approval is implied.

B exports/erasure register with A's existing privacy worker. Exports include ownership, quantities/notes, edit requests, saved opening cards, balances/ledger and authored report/audit records. Erasure is idempotent, removes report outboxes and owned records, redacts authored private audit prose and leaves remaining historical event snapshots without reporter identity. Current-signal checks suppress removed, withdrawn or expired reports at enqueue/delivery.

## Remaining release gates and reviewable next task

1. Supply a hosted staging environment or local env-file path, keeping secret keys out of chat. Verify signup/email/recovery and deployed cookie behavior, repeat the locally passing private HTTP/staff/wallet/binder/inbox/privacy journeys against that deployment, and verify expiry under its scheduler. Disposable local GoTrue acceptance does not establish hosted delivery or deployment configuration.
2. Docker Supabase reset and pgTAP passed in the [PR CI database job](https://github.com/CharvikM45/pokepulse/actions/runs/42420003614) for source commit `7006b38`. Docker remains unavailable on this Windows host; hosted authentication and private HTTP acceptance remain separate gates.
3. Review shared changes with Developer A, run supported-device push and manual screen-reader checks, and measure staging/field CWV. No review, legal clearance, staging signoff or deployment is fabricated.
4. Keep real inventory sources, live directories/maps, unlicensed art and unsupported physical odds disabled until their permission evidence is supplied. No live vendor adapter or payment mechanism is enabled.

The next external step is the hosted acceptance matrix, using the supplied runbook and existing feature branch. The application remains usable as an explicitly labeled public demo without secrets.

Latest local timing: LCP 100 ms, TTFB 1.60 ms and raw layout-shift sum 0.1121; INP was not measured. These local diagnostics do not establish staging/field performance. The corrected application sweep asserts each new scan page’s actual viewport and media settings before checking it.

Repository publication: source commit `7006b38f9f97cd34af52d743ca08b754eb686168` is pushed to `feat/developer-b-product`. [Draft PR #1](https://github.com/CharvikM45/pokepulse/pull/1) targets Developer A's `feat/developer-a-platform` branch. It remains unmerged pending review and the outstanding release gates. GitHub authentication is available; hosted staging configuration remains absent.
