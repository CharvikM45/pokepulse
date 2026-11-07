# A-01 handoff notes (joint review pending)

The provided types are preserved in contracts/src/types.ts. The source requires every seed DTO to carry is_demo but omits it from ProductDTO. `DemoProductDTO` is an additive fixture-only type with `is_demo: true`; ProductDTO is unchanged. Developer B should review this before adopting the initial contract. No source permissions or reviews are claimed.

Bootstrap /drops returns demo ListingDTO[] for UI iteration, not durable events. This shape is explicitly documented in openapi.json; A-07 must settle the feed model with B before production use. Only cursor/limit are supported; unsupported filters are rejected. One product is intentional at A-01; the 50-product catalog is A-03.

No consumer routes beyond the neutral landing page are implemented. Domain modules owned by B are empty. Authentication is an anonymous service boundary; actual Supabase sessions, private routes and user RLS are A-02. The flags table is the only bootstrap table. No live provider adapter or production-ready app is claimed.
