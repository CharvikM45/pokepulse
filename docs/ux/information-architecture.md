# Information architecture

Working name: PokéPulse. Original visual language: navy foundation, teal action, restrained yellow emphasis, geometric card placeholders. Anonymous discovery is the primary experience; simulation and collection remain secondary.

| Route            | Purpose and primary action                                  | Session                                       | Data owner          |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------- | ------------------- |
| `/`              | Browse source-aware discovery; go to Drops                  | Public                                        | A listings/products |
| `/drops`         | Filter timestamped listing events; open listing             | Public                                        | A                   |
| `/products`      | Search products with shareable filters                      | Public                                        | A                   |
| `/products/[id]` | Compare distinct offers and evidence; watch product/listing | Public; saving requires sign-in               | A                   |
| `/local`         | Select ZIP/radius; list stores and moderated reports        | Public; report requires sign-in               | B                   |
| `/calendar`      | Source-curated release/preorder dates                       | Public                                        | B                   |
| `/lab`           | Disclosed free simulation and saved results                 | Catalog public; opening requires sign-in      | B                   |
| `/sets/[id]`     | Rights-aware card metadata and manifests                    | Public if permitted                           | B                   |
| `/collection`    | Separate real/virtual binder and missing checklist          | Private; explicit public demo sample optional | B                   |
| `/dashboard`     | Personal watches, activity and resume opening               | Private                                       | A + B               |
| `/watchlist`     | Product watches versus exact listing watches                | Private                                       | A                   |
| `/alerts`        | Rule builder and in-app inbox, separate tabs                | Private                                       | A                   |
| `/settings`      | Preferences, optional push, export/delete status            | Private                                       | A                   |

Mobile navigation follows the proposal: Drops, Radar, Watchlist, Collection. An accessible native “Browse all pages” disclosure includes Explorer, Calendar, Pack Lab and account destinations; public pages remain reachable without opening a private dashboard. Desktop sidebar shows all destinations in primary discovery and secondary collecting groups. Active links use `aria-current=page`; navigation names remain visible. Skip link targets one main landmark. No horizontal navigation traps at 360px.

Filters belong in URL query parameters with repeated keys for multi-select. Submit updates the URL; refresh and browser Back restore it. Do not treat a temporary client selection as saved until navigation completes. Clear filters returns to the canonical route. Results have stable cursor pagination, explicit Next/Previous labels and a count/status live region. Cursor resets when filters change.

Every inventory offer displays availability, evidence, source freshness, seller type, channel and observed/check timestamps separately. Show “Price unavailable” for null money, never zero. Third-party seller text sits beside the offer price. Raw availability remains A-owned; UI must not infer it from timeouts, empty results, prices or other listings.

No report author profile or GPS trail is public. Product and listing IDs remain opaque UUIDs. Public collection sharing and photos are outside MVP.
