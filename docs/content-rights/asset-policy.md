# Asset, source and simulation policy

All feature flags default off. `licensed_card_art` and real-set `pack_lab` remain off until reviewed rights and server configuration exist. A metadata API permission is not artwork permission. No official logos, card scans, pack designs, official trade dress or affiliation claims are included in this handoff.

Original fixture set: **Lumen Grove**, cards Moss Courier, Harbor Lantern, Cloud Archivist. These are invented names and neutral geometric placeholders. Demo provenance must remain visible. The working product name requires separate public branding review.

| Asset/data                          | Default                                    | Clearance record needed                                                   |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| Original CSS geometric placeholders | Internal demo permitted                    | Author/origin, revision, review                                           |
| Official card/pack/logo imagery     | Disabled                                   | Licensor, permitted use/territory, expiry, attribution, proof             |
| Third-party metadata                | No fetch configured                        | Provider terms, fields permitted, attribution, retention, checked date    |
| Map tiles and store data            | No provider configured; text-list fallback | Provider license, attribution, caching/rate limits, access evidence       |
| Real-set simulated odds             | Disabled                                   | Methodology, sample size/date/source/uncertainty and legal/content review |
| Fixture pack rules                  | Internal only                              | Fictional distribution label, version, pools, validated manifest          |
| Release dates                       | No fabricated seed dates                   | HTTPS source, region, precision, verified date, editor audit              |

A preliminary provider comparison was checked against primary documentation on 2026-11-07; see `metadata-provider-comparison.md`. Actual application access/terms and asset clearance remain unapproved, and no vendor was selected or recommended. Keep provider metadata adapters entirely separate from A's stock providers.

Only server-approved image URLs should leave the asset provider. Reject unapproved remote hosts; use original placeholder when rights are absent. Do not proxy arbitrary submitted URLs. Expiry or revocation must disable rendering and pack configuration without deleting immutable historical opening facts.

No paid coins, transfers, redemptions, cash value, wagering, prizes, physical ownership claims or report-filing rewards. No payment SDK. No client-controlled production random seed. Sample odds describe the configured fictional distribution only.
