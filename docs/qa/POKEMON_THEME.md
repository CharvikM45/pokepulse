# Pokémon collector theme

2026-11-08. The consumer application now uses a Pokédex-inspired red, warm paper, graphite and trainer-yellow palette. Shared navigation, controls, cards, binder placeholders, typography, dark mode and the home page use the same visual system. Original SVG/CSS ball, handheld and sealed-product graphics replace generic glyphs; catalog graphics remain labeled as illustrations.

Barlow Condensed ExtraBold is served locally with its SIL Open Font License in `apps/web/public/fonts`. The font came from the Google Fonts Barlow Condensed repository. No runtime font CDN is required.

Verification: lint, typecheck, formatting and production build pass; 106 unit/embedded database tests, 21 production browser tests, seven component suites and 80 component axe scans pass. The browser suite checks 13 routes at 360px and 1440px in both light and dark appearance, plus intermediate breakpoints. Desktop and mobile previews were visually reviewed. Screenshots are in `evidence/collector/theme`.

The browser fixture run explicitly disabled local Supabase environment values; the subsequent production build restored the existing staging configuration. Hosted source-unavailable observations remain historical rather than being relabeled to satisfy fixture expectations. A contrast failure in the decorative handheld text was corrected by darkening its red background. Component verification also exposed a deferred combobox selection reset that could overwrite immediate typing; selection synchronization now happens before the next interaction.

These checks establish local regression evidence. Manual screen-reader/device acceptance and the staging release gates in `STAGING_HANDOFF.md` remain applicable.
