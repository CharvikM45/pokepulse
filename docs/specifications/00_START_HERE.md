# PokéPulse — Two-Developer Codex Build Kit

**Version:** 1.0 | **Basis:** *PokéPulse Comprehensive Project Proposal*, v2.0, 6 November 2026 | **Status:** Execution plan, not a claim that retailer data rights or Pokémon IP permissions have been obtained.

## What this kit is

This kit converts the approved product concept into two near-equal, parallel implementation assignments. It is intended for **two developers using separate Codex sessions in one GitHub repository**. Neither Codex instance should independently invent a competing architecture.

**Files in this kit**

1. `00_START_HERE.md` — this operating guide, milestone sequencing, effort balance and launch gates.
2. `01_SHARED_ARCHITECTURE_AND_CONTRACTS.md` — binding paths, types, API behaviors, security rules and handoff contract. **Give this file to both Codex sessions.**
3. `02_DEVELOPER_A_CODEX_MASTER_PROMPT.md` — copy into Developer A's Codex task, together with shared contracts.
4. `03_DEVELOPER_B_CODEX_MASTER_PROMPT.md` — copy into Developer B's Codex task, together with shared contracts.
5. `04_ISSUE_BOARD_AND_INTEGRATION.md` — tickets, estimates, checkpoints, cross-lane acceptance tests and release criteria.

## Assignment decision

| Lane | Owner | Technical mandate | Rough relative effort |
|---|---|---|---:|
| A | Developer A (you) | Infrastructure/auth and inventory truth; provider adapters; retailer catalog; job processing; alerts/push; privacy and operational controls | 120 planning points |
| B | Developer B (partner) | UX/UI; discovery pages; local store reports/moderation; release calendar; Pack Lab transaction and presentation; real/virtual collection; accessibility | 120 planning points |

**Planning points are relative estimates, not hours or a promise that work is exactly equal.** Rebalance each week based on actual blockers and merged work. Both must review schema changes affecting the other lane.

## Exact starting procedure

1. Create a **private** GitHub repository named `pokepulse` (working name; public trademark/IP questions remain open). Add both developers with access. Never commit credentials.
2. Both read `01_SHARED_ARCHITECTURE_AND_CONTRACTS.md`. Agree to its domain and API decisions before generating production code.
3. **Bootstrap handshake:** Developer A creates the one-time minimal Next.js/TypeScript workspace + tooling + empty domain modules + Supabase migration skeleton, merges PR `A-01-bootstrap`. This is a short initial sequential dependency; Developer B can simultaneously prepare design tokens, component mockups and fixture data in a scratch branch, but does not independently initialize another Next.js app. Developer B rebases onto the merged bootstrap before creating PR `B-01-shell`.
4. Create `feat/a-...` and `feat/b-...` branches off current `main`, not off each other's half-finished branch. Prefer narrowly scoped PRs. Never directly push to `main`.
5. Give **A** `01_SHARED...md` + `02_DEVELOPER_A...md` to Codex. Give **B** `01_SHARED...md` + `03_DEVELOPER_B...md` to a separate Codex session. The prompts tell Codex to inspect the repository and implement **in milestones**, not make unreviewed wholesale replacements.
6. Review PRs at least twice weekly. Use `04_ISSUE_BOARD_AND_INTEGRATION.md` to verify gates. Merge migration/contract PRs ahead of dependent application code.
7. On each PR, require `pnpm lint`, `pnpm typecheck`, `pnpm test`, relevant integration/RLS tests and `pnpm build`, plus screenshots for visible features. Do not mark external integration as completed from tests using only mock data.

## Dependency graph

```text
                        A-01 bootstrap + CONTRACT V0
                              /            \
                             /              \
                A: auth/RLS + catalog      B: design system + UX fixtures
                     |                            |
                A: provider adapter      B: Explorer / Drops pages
                     |                            |
                A: state/event engine    B: Radar API + UI + moderation
                     |                            |
                A: rules + alert jobs    B: Pack Lab + real/virtual binder
                     \                            /
                      \                          /
                         Integration + security QA
                                  |
                      Source rights / IP launch gates
                                  |
                      Beta (or honest fallback mode)
```

B may implement mock views independently using **clearly labeled fixture data**; verified stock badges must not be hard-coded in UI. A must provide contract-compatible fixtures and a deterministic event simulator. Both integrate against the same typed API.

## Product release hierarchy

- **M0 / core beta:** accessible responsive shell, anonymous browsing, normalized product Explorer, one *permitted* stock source **if available**, trustworthy stock provenance/freshness, watchlists, in-app notifications, manual ZIP/radius local discovery, private user controls, basic operator controls. If no permitted source exists, launch **catalog + moderated community reports only**, with no false verified-status claim.
- **M1 / after core:** web push where supported, expanded Local Radar/moderation, release calendar, second approved stock source, limited free Pack Lab with **original or cleared assets**, real/virtual binder, validated variant manifests. These can be developed earlier behind flags but must not delay M0.
- **M2 / later:** image recognition of physical cards, advanced market value forecasts, public profiles/trading/marketplace, wider geography. Not part of the two-person build.

## Non-negotiable red lines

- No aggressive scraping or bypass of retailer anti-bot controls; no auto-checkout, bot purchases, resale automation, or bypass of site access restrictions.
- An outage/rate limit is `unknown` or `unavailable`, **never** `out_of_stock`. Stale stock must not be rendered as current.
- Community sightings are not retailer-verification signals. Users' exact locations, daily movement routes and report trails are not public.
- Do not use official Pokémon brand identity/card art/packaging in a public build without rights review. `PokéPulse` is a **working** project name; do not claim official affiliation.
- Pack Lab is free-only, entertainment-only, and has no cash, purchases, gambling, trading or prizes. No manipulative daily-streak penalties. Card odds estimated from external studies are never represented as official odds.
- A third-party TCG API is metadata access, not automatically an image license. Use original placeholders and feature flags until permission is reviewed.
- Authentication, RLS, rate limits, key secrecy, audited writes and safe account export/deletion are production requirements.

## When the two Codex sessions disagree

`01_SHARED_ARCHITECTURE_AND_CONTRACTS.md` wins over a lane prompt, and both win over ad hoc generated architecture. The proposal is the product source of truth. Document all proposed deviations in an ADR (`docs/adr/NNNN-topic.md`), obtain both reviews, update shared contracts, *then* modify implementation.

## Suggested Codex kickoff wording

For Developer A: “Read `01_SHARED_ARCHITECTURE_AND_CONTRACTS.md` and `02_DEVELOPER_A_CODEX_MASTER_PROMPT.md` fully. Implement A-01 first and stop at the bootstrap checkpoint; provide changed files, tests, and a PR summary. Do not alter B-owned files except the agreed skeleton.”

For Developer B: “Read `01_SHARED_ARCHITECTURE_AND_CONTRACTS.md` and `03_DEVELOPER_B_CODEX_MASTER_PROMPT.md` fully. Prepare B-00/B-01 using contract-defined fixtures; do not create a second application bootstrap. When A-01 merges, implement the UI lane in owned directories and provide a PR summary with accessibility checks.”

**Rule:** Never run two writing agents against the **same working tree**. Use separate local clones or isolated worktrees to avoid accidental overwrite even when branches differ.
