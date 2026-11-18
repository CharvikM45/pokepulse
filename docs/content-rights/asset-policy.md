# Asset, source and simulation policy

Updated 2026-11-17 for the user-requested card artwork and functional Pack Lab repair. This supersedes the original fixture-only handoff configuration.

Card metadata comes from the pinned MIT-licensed TCGdex source with attribution and the preserved source notice. In response to the user’s explicit request, card surfaces display exact matching scans directly from the documented TCGdex asset service. The application enables its provider artwork setting and `licensed_card_art` flag, restricts the host to `assets.tcgdex.net`, and requires per-variant approval. These settings record project authorization, not an external copyright license, ownership, affiliation or endorsement. Artwork copyrights remain with their respective owners.

The provider availability inventory maps 100,584 localized card records and 160,626 documented variants to scans. Missing scans and failed image requests show an honest unavailable-scan fallback. No generic Pokémon image substitutes for a card. Product and sealed-set artwork uses packaging rather than chase-card art. Revocation disables rendering without rewriting saved opening facts. Arbitrary user-submitted remote URLs are not proxied.

Pack Lab contains three free custom scenarios: Base Set, 151 and Evolving Skies. Each performs ten independent uniform draws with replacement from its configured artwork-backed pool. These fictional game rules are disclosed and do not claim official booster contents or real pull rates. See [custom simulation configuration](custom-simulation.md).

Server-committed results and idempotent retries remain mandatory. Virtual results stay separate from physical ownership and portfolio valuation. There are no purchases, paid currency, transfers, cash value, redemptions or prizes. No client-controlled production random seed is accepted.

Pricing, maps and other external integrations retain their independent provider approval requirements. Metadata permission does not imply pricing or artwork ownership. Read [provider operations](../implementation/POKEDEX_PROVIDERS.md) for source counts, attribution, refresh behavior and coverage limits.
