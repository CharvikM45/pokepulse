# Pokédex and packs implementation audit

Baseline audited: local `4444067`, clean working tree, Next 16.4.5 / React 19.3.1 / TypeScript 5.9.3 / pnpm 10.34.9. This extends the existing modular monolith. No new runtime dependency is required.

| Area               | Existing source of truth                                  | Additive change                                                                                                    |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Retail             | products/listings, discovery.tsx                          | Preserve; distinct `/cards` route                                                                                  |
| Printings/variants | tcg_sets/cards/card_variants                              | Add provider, language, artist, normalized metadata and provenance; never merge names                              |
| Search             | per-set allRows reads, max 50,000                         | Dedicated SQL keyset search; no whole-catalog reads                                                                |
| Physical ownership | real_inventory, b_save_real_inventory, pp-real lock       | Per-condition acquisition lots joined to existing aggregate; legacy quantity edits reconcile lots                  |
| Virtual ownership  | virtual_inventory, b_open_pack, opening_cards             | Unchanged; presentation-only animation                                                                             |
| Pricing            | No singles pricing                                        | Independent licensed observations, exact condition/grade/currency/statistic matching, measured history             |
| Privacy            | collection privacy participants, auth.users cascades      | Include lots/actions/snapshots in exports; cascade erasure, same write pause and lock                              |
| Provider approvals | stock source permissions, asset policy                    | Separate card-provider permissions with metadata/art/pricing/retention approvals and evidence; disabled by default |
| Pack recovery      | savedView, pending request persistence, immutable receipt | Preserve requests; enrich presentation separately by immutable variant IDs                                         |

New migration: `20261117000000_card_pokedex_and_market.sql`. Existing migrations are not edited. Existing shell/theme, APIs, authentication, idempotency, Origin checks, manifests, pack odds, stock providers and worker lanes remain in place.

Providers researched: TCGdex REST v2 (metadata candidate), Scrydex (optional commercial pricing candidate). Public endpoint availability is not project approval or artwork clearance. No production import, image approval, or pricing retention permission is inferred. Metadata UI remains usable without images and reports actual indexed counts; no synthetic global catalog or historical market prices.
