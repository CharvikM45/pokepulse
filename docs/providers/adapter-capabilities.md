# Adapter capabilities

| Source             | Availability         | Price                | Seller     | Shipping   | Pickup          | Region       |
| ------------------ | -------------------- | -------------------- | ---------- | ---------- | --------------- | ------------ |
| Synthetic fixtures | Simulated            | Simulated            | Simulated  | Simulated  | Not implemented | Simulated US |
| Best Buy candidate | Documented, untested | Documented, untested | Unverified | Unverified | Unverified      | Unverified   |
| Other retailers    | Unverified           | Unverified           | Unverified | Unverified | Unverified      | Unverified   |

The fixture data contains explicit positive/negative/preorder/stale cases and separate unsupported/429/timeout outcomes. FixtureAdapter now provides deterministic replay; durable scheduling and transactional ingestion are implemented. No live source-specific parser is registered. A failed check has no observation. Fixed fixture time is exported; HTTP responses apply server time to downgrade old positives to unknown/stale.
