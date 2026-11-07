# B backend implementation and acceptance plan

Status updated 2026-11-07: B's additive migrations and HTTP/UI adapters are integrated with A's platform on the B feature branch. Combined embedded PostgreSQL tests, native multi-connection tests, anonymous production-browser tests and explicitly isolated transport/controller tests provide local evidence. Hosted Supabase auth, Docker execution, supported-device delivery and staging signoff remain separate gates. See `../qa/B_RELEASE_REPORT.md` and `../adr/0003-collector-contracts.md`.

## Pack transaction

Authenticated endpoint derives user from A's verified session, validates shared Zod input/output, verifies UUID Idempotency-Key and body size, applies per-account limits and calls one Postgres RPC. The authenticated RPC executes on the server and locks per user. No wallet table is writable directly by clients.

1. Normalize body defaults (`use_free_open=false`) and persist canonical request identity. Serialize a user's openings before checking idempotency. Unique `(user_id,idempotency_key)` is a database constraint.
2. If a committed opening with same key/body exists, return immutable cards and original metadata before applying today's rights/balance/odds checks. A different normalized body returns 409. A rights revocation must hide unauthorized image rendering but not destroy historical facts.
3. Read active, rights-approved, internally consistent set/odds configuration under transaction protection. Freeze it on the opening. Validate every declared slot and eligible variant; no inferred finishes. Configuration versions become immutable once referenced.
4. Lock/create wallet with deterministic free grants, ledger grants and UTC daily allowance state. Evaluate balance/allowance before writing; zero cost is still an explicit free opening operation.
5. Use cryptographic server RNG with unbiased bounded integer selection. No client seed; fixture deterministic RNG exists only in tests. Derive each slot from exact allowed pool. Draws are transaction-local until commit.
6. Atomically consume allowance or debit coins, add ledger operation, opening, opening_cards and upsert virtual quantities. Unique `(opening_id,slot_index)`; ledger reference unique per operation; balance CHECK >=0; quantities nonnegative; all variant/set relationships constrained.
7. Commit then return `PackOpeningDTO`. Output serialization errors must be considered before commit where feasible; lost HTTP response retries use same key and committed record. No reveal action submits a new opening.

Opening history and virtual inventory are private: owner SELECT RLS only. Wallet, ledger, opening/cards, virtual inventory have **no direct client write policies**. Security-definer RPC must pin `search_path`, revoke PUBLIC execute and check authenticated identity/role; never grant browser service credentials. Staff cannot bypass wallet ownership through client-supplied IDs.

Required transaction tests include same key×20 → one result/debit; different bodies same key → one success/one conflict; different keys with one affordable balance → one success/no negative; induced failure → unchanged wallet/ledger/cards/inventory; free UTC reset; retry after rights/version switch → original saved result. Local PostgreSQL suites now cover the listed contention and rollback scenarios (details and scope in the database report); hosted Supabase and A route/session behavior remain unverified.

## Reports and moderation

Submission is authenticated and rate-limited under per-account transactional lock. Require store, optional existing canonical product, constrained report type, valid recent/nonfuture observation time. Notes are constrained and screened, then staff review before any public note. Reporter locations are neither accepted nor stored; image input rejected until explicitly supported. All reports start pending, independent of submitted moderation fields.

Trusted staff approval rejects self-approval, audits actor/revision/reason and writes approval outbox once. Public reads select approved AND `expires_at > now()`, project only `SightingDTO` and compute independent distinct accounts. Unknown-product reports do not contradict every known product. Reversals update moderation, write invalidation and cancel stale pending delivery eligibility. Maintenance expires records, while read predicates enforce immediate expiry even if maintenance stops.

RLS tests: anonymous public report projection only; user A cannot see B's pending/notes or alter report status; A cannot confirm own report; repeated confirmation has unique `(sighting_id,user_id)`; regular user cannot moderate; staff cannot approve own submission. Reject malicious input without logging it. Validate ZIP 5 digits/radius 1–100, bounded provider/geocoder cache and no unrestricted fetch/redirect.

## Collection and catalog

Separate `real_inventory` from `virtual_inventory`; only real authenticated quantity/note edits are user-writable through validated API. Idempotent absolute quantity updates, not client-controlled increment. Scope reads to the authenticated owner. Opening/catalog lists use bounded cursor pages; binder inventories use a complete, account-locked, manifest-bound snapshot before UI pagination. Manifests versioned and validated against exact set+variant FKs; Master exact in-set variants, Extended separately published scope. Base counts a numbered card once across declared eligible alternatives. Unknown scope displays incomplete.

Public catalog separates permitted metadata from rights-cleared images. No active real-set adapter until provider/licensing review. Missing CSV needs private authentication, exact mode/goal/version, safe escaping and content disposition; preserve Unicode while neutralizing spreadsheet formula injection.

## Calendar

Source-curated entries require approved HTTPS source, region/type/date precision and verification/editor audit history. Unconfirmed dates sort in a separate group; day-only dates stay plain calendar dates. Month/list UI uses same data. The additive shared contract represents unconfirmed dates as null and includes explicit demo provenance; cross-developer review remains pending.

## Privacy dependencies

| Table                             | Export                                                         | Deletion/retention decision for A integration                                                                            |
| --------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| wallets, coin_ledger              | Balance and ledger history                                     | No financial cash ledger; delete user-linked records unless a documented security retention policy requires minimization |
| pack_openings, opening_cards      | Immutable opening facts/version/cards                          | Delete with user; remove derived virtual inventory in same job                                                           |
| real_inventory, virtual_inventory | Separate lists, variants/quantities; real notes private        | Delete all owned rows; sharing off                                                                                       |
| sightings, confirmations          | Private submitted history and confirmations                    | Remove author links/public note PII per reviewed policy; no public activity trail                                        |
| sighting_moderation_actions       | Subject history with staff-sensitive fields excluded as agreed | Minimized security audit retention, documented basis and duration                                                        |
| b_sighting_outbox                 | Subject event references if included by privacy policy         | Cascade with removed report; cancel queued A deliveries before deletion                                                  |

Account deletion must cancel queued B report events/reminders and enforce A's request status semantics. Do not claim completion on enqueue. Staff IDs in retained audits are access-controlled. No invented retention duration or legal approval is asserted.

`b_real_edit_requests` stores owner-scoped normalized edit requests and receipts, including private note drafts; it is exported by the binder participant and erased with the account. Replays precede rate/rights checks and cannot overwrite a newer edit. `release_edit_history` and `b_manifest_actions` export only the requesting actor’s actions and redact authored private audit prose/identity on erasure.
