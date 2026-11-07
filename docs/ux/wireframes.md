# Original low-fidelity wireframes

```text
360px / Discovery
[Skip to content]
[Pulse mark]                 [Theme]
[DEMO DATA — no live stock integration]
Drops
Source-aware updates for collectors
[Search_____________________]
[Seller v] [Channel v] [Apply]
┌ Product / format ──────────────┐
│ Availability: Unknown         │
│ Evidence: Editorial           │
│ Freshness: Unavailable         │
│ Seller: Third party           │
│ Channel: Ship to home          │
│ Price unavailable              │
│ Observed: Unknown              │
│ Source check: unavailable       │
│ [View offers] [Watch listing]   │
└───────────────────────────────┘
[Previous]               [Next]
[Drops] [Radar] [Watchlist] [Collection]
Browse all pages disclosure: Explorer / Calendar / Lab / Account

Local
[ZIP____] [Radius v] [Find stores]
Map unavailable — list remains usable
[DEMO store / address / directions]
Community reported • not store verified
Found / observed / expires / contradictions
[Report a sighting → sign-in when needed]

Lab (disabled until approved)
Free simulation • no physical cards or prizes
[Set] [Fictional odds + version + pools]
[Wallet: free-only balance / reset UTC]
[Open — disabled if no rights/config]
[Committed opening → Reveal all / Next]
[Saved opening history]

Collection
[Real] [Virtual]
[Set / manifest version / Base Master Extended]
[Search / Finish / Owned-Missing / List toggle]
[Card][Card][Card]
[Card][Card][Card]
[Card][Card][Card]
[Previous][Next] [Export missing checklist]
```

Desktop: 240px sidebar, bounded 1120px main column; filters above 2–3-column offer cards. Evidence remains in each card. No essential metadata is tooltip-only. `preview/index.html` is the original shell/style story, separate from integration-bound screens.

Component inventory: Button, Input, Field, StatusBadge, StateCard, Skeleton, Pagination, Tabs, SearchCombobox, Dialog, ToastRegion, AppShell, ListingEvidence, ReportCard, DatePrecisionLabel, RightsNotice, WalletDisclosure, RevealList, BinderCard. First nine primitives and shell are provided as source; domain screens remain integration work.
