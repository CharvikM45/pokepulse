# Integrate collector experience, moderated Radar and free pack/collection domains

The A platform previously exposed a neutral landing scaffold and platform APIs. This change supplies the collector-facing routes and connects B's report, calendar, pack and collection domains to the existing auth, contracts, feature flags, alert engine and privacy worker.

Users can browse clearly labeled demo products/offers, share filters, watch a product or exact offer, manage alert rules/inbox/preferences, search coarse store areas, submit pending reports, review sourced releases, recover committed free simulations and keep virtual and real inventories separate. Pack draws, debits and inventory writes commit atomically. Reports require independent staff review and current revision/expiry checks before A can notify.

The collector UI now has a Pokémon field-kit theme: Pokédex red, warm paper, graphite, trainer-yellow navigation, locally hosted condensed typography and original SVG/CSS illustrations. Light/dark desktop and mobile layouts were checked, including 52 public-route axe scans and 80 component scans. The redesign also fixes a combobox selection timer that could overwrite immediate typing. `docs/qa/POKEMON_THEME.md` records validation and screenshots.

Eight additive migrations and 27 RLS-protected B tables are included. Global/internal gates default off; fixtures and artwork placeholders are original and fictional. Shared changes and review dependencies are explicitly recorded in CONTRACT-02. No live provider, tile permission, real-card art grant or payment flow is enabled.

Validation: pinned-toolchain build, lint/type checks, 106 unit/embedded SQL tests, 21 production-browser/transport-adapter tests, seven component suites and native PostgreSQL concurrency with 20 connections. Automated scans report no violations in the passing runs. Full evidence and limitations are in `docs/qa/B_RELEASE_REPORT.md`.

GitHub CI for source commit `7006b38` additionally passed Docker Supabase reset/pgTAP and the native PostgreSQL concurrency job. The release report links the run and records the quality job result separately.

The later CI run for `a8e976e` passed six real local GoTrue/PostgREST/production-Next acceptance groups, including a Playwright watch/dashboard/pack/reload/binder journey, independent report approval/confirmation to A's opt-in inbox, and private export/deletion through B's worker hooks. This exposed a shared-worker startup bug: `web-push@4.0.0` has named ESM exports, and the worker now imports the namespace. No migration changed. The downloaded credential-free summary and mobile screenshots are committed with the release evidence.

Hosted `pokepulse-staging` is now Healthy, with all 16 migrations recorded, 54 public tables under RLS, original fictional seeds and all feature gates off. The local production app passed seven actual hosted HTTP smoke groups, including sign-in/logout, watch replay/two-user isolation, preferences and separate private collection reads; both synthetic users were removed. `docs/qa/STAGING_HANDOFF.md` records evidence and the pending repository-owner GitHub integration step. No credentials are committed.

Draft until A reviews shared amendments and the remaining hosted email/recovery/deployment/scheduler acceptance, supported-device push, manual screen-reader checks and staging CWV are recorded. Admin-confirmed test users do not establish email delivery or full staging signoff.
