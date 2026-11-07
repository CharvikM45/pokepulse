# Integrate collector experience, moderated Radar and free pack/collection domains

The A platform previously exposed a neutral landing scaffold and platform APIs. This change supplies the collector-facing routes and connects B's report, calendar, pack and collection domains to the existing auth, contracts, feature flags, alert engine and privacy worker.

Users can browse clearly labeled demo products/offers, share filters, watch a product or exact offer, manage alert rules/inbox/preferences, search coarse store areas, submit pending reports, review sourced releases, recover committed free simulations and keep virtual and real inventories separate. Pack draws, debits and inventory writes commit atomically. Reports require independent staff review and current revision/expiry checks before A can notify.

Eight additive migrations and 27 RLS-protected B tables are included. Global/internal gates default off; fixtures and artwork placeholders are original and fictional. Shared changes and review dependencies are explicitly recorded in CONTRACT-02. No live provider, tile permission, real-card art grant or payment flow is enabled.

Validation: pinned-toolchain build, lint/type checks, 106 unit/embedded SQL tests, 21 production-browser/transport-adapter tests, seven component suites and native PostgreSQL concurrency with 20 connections. Automated scans report no violations in the passing runs. Full evidence and limitations are in `docs/qa/B_RELEASE_REPORT.md`.

Draft until A reviews shared amendments and hosted/Docker acceptance, supported-device push, manual screen-reader checks and staging CWV are recorded. Local SQL auth stubs and transport fixtures do not establish hosted auth or staging signoff.
