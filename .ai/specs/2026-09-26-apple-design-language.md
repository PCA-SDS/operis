# Apple design language: colour tokens and theme enforcement

- **Date:** 2026-09-26
- **Status:** Implemented
- **Scope:** `apps/mercato/src/app/globals.css` (token values, shadow scale, calendar and select overrides),
  `.ai/ds/ds-tokens.json`, UI files that bypassed the tokens, and the guard
  `packages/core/src/__tests__/theme-token-colors.test.ts`
- **Supersedes:** the pastel-navy colour values of
  [`2026-08-23-pca-design-language-migration.md`](2026-08-23-pca-design-language-migration.md) §4

## TLDR

The palette follows Apple's: minimal and white in light mode, true black in dark, neutral greys for every fill,
and Apple blue as the one saturated colour. Token names are unchanged, so no component had to move; only values
did. Everything that painted colour outside the tokens was fixed, and a repo-wide guard now keeps it that way.

## Palette

| Role | Light | Dark |
|---|---|---|
| Page ground `--background` | `#F5F5F7` | `#000000` |
| Ink `--foreground` | `#1D1D1F` | `#F5F5F7` |
| Surface / card | `#FFFFFF` | `#1C1C1E` |
| Popover | `#FFFFFF` | `#2C2C2E` |
| Muted fill / hover ladder | `#EDEDF0` → `#E3E3E8` | `#2C2C2E` → `#3A3A3C` |
| Secondary label `--muted-foreground` | `#6E6E73` | `#A1A1A6` |
| Hairlines `--border` / `--border-strong` | `#E5E5EA` / `#D2D2D7` | `#38383A` / `#48484A` |
| Button blue `--primary` | `#0071E3` | `#0071E3` |
| Link blue `--accent-strong` | `#0066CC` | `#2997FF` |
| Control fill (soft button, field well) | `#E8E8ED` | `#2C2C2E` |
| Destructive | `#E30000` | `#FF453A` |

- **Status families** start from Apple's system red, green, orange, blue, gray and pink. The icon role uses
  Apple's increased-contrast variant, and the text role is a deep shade of the hue that is AA on its own tint.
  Charts use the system colours, light and dark variants.
- **Why `#0071E3` and not `#007AFF`:** the system blue carries white text at only 4.0:1, and the dark system blue
  `#0A84FF` at 3.7:1. apple.com's button blue clears AA (4.7:1) in both themes, which
  `scripts/check-token-parity.mjs` enforces.
- **Sidebar family:** it is the product's inked chrome, the selected capsule of the default segmented control.
  It is near-black in light (apple.com's selected chips) and a raised grey in dark.
- **Shadows:** neutral black at low alpha with a wide blur, in place of the navy-tinted scale.
- **Unchanged:** the brand ramp (sky, lilac, violet, which tests pin), social brand colours, radii, typography
  (SF Pro first on Apple devices, Inter elsewhere), and the product-wide focus-ring removal.

## Enforcement

Fixed to follow the theme:

- **Workflows:** status and node colour maps, instance-graph node styles, canvas dots and edges, and `bg-white`
  editor panels.
- **Messages:** priority badges.
- **Schedule calendar:** event styles.
- **react-big-calendar:** its light-only stylesheet, overridden in `globals.css`.
- **Native select:** the chevron gets a dark variant.
- **Charts:** `hsl(var(--…))`, which is invalid CSS around hex tokens and was silently ignored in both themes.
- **Stripe payment element:** it now reads resolved token values and uses Stripe's `night` theme in dark.
- **Customers:** the deal-won popup and `FancyButton primary` (dark brand ink on the fixed pale gradient), and
  the deals filter dot.
- **Checkout:** input and status-card fills.
- **Global error page:** it now honours the saved theme.
- **Redundant `dark:` overrides:** removed.

The guard `theme-token-colors.test.ts` runs in `yarn test:repo-wide-guards` and fails on Tailwind palette
classes, fixed white/black fills and borders, arbitrary colour classes, `hsl(var(--…))`, `dark:` overrides
(except `prose-invert`), and hex inline styles.

- **Allowed exceptions:** colours that must not follow the theme sit in its `ALLOWED` map with a reason. These
  are the AI orb, the switch thumb, the fixed-black `FancyButton`, and data defaults saved with a record. A
  third test fails when an allowance is no longer needed.
- **Out of scope:** emails, because mail clients have no theme switch, and user-assigned data colours (tags,
  projects, dictionaries, calendar events).

## Changelog

- 2026-09-26 — Implemented.
