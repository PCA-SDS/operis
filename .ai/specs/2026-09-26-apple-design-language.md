# Apple design language: colour tokens, theme enforcement, and component conversion

- **Date:** 2026-09-26
- **Status:** Implemented
- **Scope:** `apps/mercato/src/app/globals.css` (token values, shadow scale, calendar and select overrides),
  `.ai/ds/ds-tokens.json`, UI files that bypassed the tokens, and the guard
  `packages/core/src/__tests__/theme-token-colors.test.ts`. Phase 2 (below) adds the shape, type, surface
  and focus conversion of the shared components in `packages/ui` and the shell.
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
- **Unchanged in phase 1:** the brand ramp (sky, lilac, violet, which tests pin) and social brand colours.
  Radii, typography and focus were left for phase 2.

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

## Phase 2 — shape, type, surfaces and focus

The colour pass left the components' own shapes untouched. Phase 2 converts them at the token and
shared-component level, so every screen built from the design system inherits the result. Business
logic, routes, APIs, permissions and data are untouched; the change is classes, tokens and markup
order only.

### Tokens (`globals.css`)

- **Radius:** `sm` 4 · `md` 8 · `lg` 10 · `xl` 14 · `2xl` 18px (was 4/6/8/12/16). Concentric: a menu row
  inside a menu's 6px padding meets the menu's corner.
- **Type:** the stack is `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
  "Helvetica Neue", "Inter", Arial, sans-serif` (only locally installed faces are named; Inter stays
  self-hosted). One new step, `text-large-title` (32px), for page titles; everything else uses
  Tailwind's scale. `cn()` registers it as a font size.
- **Shadows are themeable.** `@theme inline` bakes literals into utilities, so the old `.dark` shadow
  overrides never applied. Each `--shadow-*` now points at `--shadow-elevation-*`, defined per theme.
  The floating steps (`lg` and up) open with a 0.5px edge (dark in light, light in dark), which is
  what lets menus and popovers drop their borders.
- **Scrim:** `--scrim` (black 32% light, 60% dark) replaces `bg-foreground/40`, which was a light veil
  in dark mode, on every dialog, sheet, drawer, command palette and portal overlay.
- **Table header** shares the card's white; one hairline under the header strip separates it.
- **Reduced motion:** transitions and `animate-in`/`animate-out` collapse to 0.01ms.

### Focus — reversal of an earlier request

The product had removed every focus indicator by explicit request (a documented WCAG 2.4.7
failure). This brief requires visible keyboard focus, so the removal block is gone: the
`shadow-focus` halo shows on `:focus-visible` (Tab), never on a pointer click on a button, and a
focused text field shows its quiet blue edge while active. Seventeen `focus:ring` utilities that
would have drawn on click became `focus-visible:`. Rolling back is re-adding the removed block.

### Components

- **Buttons:** `outline`, `secondary` and `soft` are one borderless grey floating button;
  `destructive`/`destructive-outline` are red text on that fill. Inside a grey form section the fill
  flips to `surface` (`in-data-[crud-section=true]:bg-surface`), as fields already do. `IconButton`
  `outline` matches.
- **Fields:** values are regular weight (placeholder differs by colour); date triggers match `Input`;
  the rich editor content is a field; date and editor fields join the form-section and dialog rules.
- **Surfaces:** `Card`, popover, select/dropdown/command menus, tooltip, sheets, drawers, badges,
  tags, pagination, calendar nav, kbd, switch track and accordion lose their hairlines. The copied
  card recipe `rounded-xl border border-border bg-surface shadow-sm` (200 copies in 116 files) keeps
  its box with `border-transparent`, so state borders still work and nothing shifts. Address tiles and
  the collapsed zone rail take the same card; nested boxes (filter sub-groups, attachment
  assignments) take the muted fill instead of a hairline; the notes inline editor is a field.
- **Type:** `PageHeader` title is the 32px semibold large title, exported as `PAGE_TITLE_CLASS` and
  used by `DataTable`, `FormHeader` and six hand-rolled module titles; dialog/sheet/drawer titles are
  `text-lg`; table headers are sentence-case `text-xs font-medium`; cells and field values regular;
  form labels match the `Label` primitive (`FORM_FIELD_LABEL`), no longer uppercase.
- **Shell:** frosted topbar on the page ground, aligned to a wider gutter (16 / 24 / 32px), no footer
  band; the module sidebar loses its panel, gets a two-step heading hierarchy, and no longer squeezes
  its headings when it scrolls.
- **Menus:** `RowActions` uses the shared menu rows; the DataTable column menu and AI model picker use
  the shared floating surface.
- **Colour:** the default tooltip is ink rather than blue; the default `Avatar` and the profile disc
  are neutral; user-picked entity colours render as a tint without an outline.
- **Motion:** `CloseButton` no longer zooms on hover.

### Deliberately not changed

- Data-dense text stays at `text-sm` (14px); the brief's 15–17px body would cost table and form density.
- The brand violet of AI surfaces, user-assigned data colours, emails, and the AI assistant's own panels.
- About 250 module files still hand-roll bordered boxes that are not the card recipe (nested panels,
  selection tiles, drop zones). Each needs a judgement call rather than a mechanical rewrite.

## Changelog

- 2026-09-26 — Implemented.
- 2026-09-27 — Phase 2: shape, type, surfaces, focus and shell conversion.
