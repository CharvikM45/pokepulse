# Developer B integration handoff

Use the root README and locked pnpm workspace. Shared contract changes are recorded in CONTRACT-01; review them before integrating. All consumer UI/radar/packs/binder domain directories remain yours.

- Anonymous catalog: products, product detail with offers/history, listing drops and retailers. Demo-only fallback works without secrets. Every record carries `is_demo`; render DEMO DATA prominently.
- Authentication: apps/web/src/auth/use-session.ts and the /auth handlers. Email confirmation/recovery callbacks exchange tokens server-side. Staff comes from a protected database membership table.
- Private data: watchlists distinguish product versus exact listing; rules support additive listing, region and source filters. The typed client validates success/error envelopes. POST/PATCH/DELETE require same-origin JSON and UUID idempotency keys.
- Notifications: preferences default off; inbox is universal after opt-in. Web Push requires a user gesture and separate subscription/opt-in. Show the iOS Home Screen installation caveat. The service worker is served at /push-worker.js.
- Local integration: call publishLocalSighting only after server-side approval and with the version 1 envelope. A accepts moderated_report only. Supply a vetted ZIP-distance resolver for non-identical ZIP-radius matching.
- Privacy: implement radar/binder/packs export and erase participants, register them with privacyOne, and cross-test. Missing hooks block completion when your tables exist.

Deterministic fixture names remain available; expanded catalog has 50 products and 51 offers. `pnpm simulate` runs the database replay scenarios without calling a provider. Please jointly review migrations and additive contracts, then run the staging acceptance flows listed in docs/runbooks/migrations.md. No legal review, live integration, staging signoff or B review is implied by this handoff.
