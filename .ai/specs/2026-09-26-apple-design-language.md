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

## Phase 3 — modals

Every modal surface reads as one design: dialogs, the confirm alert, sheets, drawers and the
hand-rolled side panels. The work is in the shared primitives first, then in the call sites that
drew their own chrome.

### Primitives

- **Close button:** `CloseButton` is Apple's filled close, a grey circle in the control fill with a
  half-size secondary-grey mark, rather than a bare `X` that filled only on hover.
- **Insets:** header, body and footer share one set of constants exported from `dialog.tsx`
  (`DIALOG_*_CLASS`). The outer margin is 20px on a phone and 24px from `sm` on all four sides, and
  the close button sits on the title's centre line at the same inset. `Sheet`, `Drawer` and the
  confirm dialog use the constants instead of copies.
- **Footer gap:** the footer owns the 20px above its buttons, and a body or header directly above
  it drops its bottom padding. A body that scrolled hid its own padding, leaving buttons 4px under
  the last visible field.
- **Sizing is desktop-first.** The base put the desktop size under `sm:`, so a plain `max-w-3xl`,
  `h-[…]` or `top-16` on `DialogContent` lost from 640px up: about 20 dialogs rendered at 512px
  whatever they asked for, fixed-height dialogs grew with their content, and the task detail panel
  (meant to fill the window) opened 502px wide. The phone bottom sheet now lives under `max-sm:`.
- **Confirm alert:** title at the dialog's 18px (was 20px), the dialog's entrance (was a 300ms
  zoom), and no close button beside Cancel, as in Apple's alerts.

### Call sites

- **Tasks:** Quick add is a titled dialog with the embedded composer, anchored 64px from the top;
  the label trigger takes the filled picker style. The task detail header uses the shared close and
  a 28px delete.
- **Customers:** Schedule activity, Edit tags, Manage tags and Mark deal lost drop their hand-built
  headers, close buttons, 10–14px radius overrides and header badges for the shared slots. Header
  icons are gone from the pipeline dialogs, Link entities, option groups and MCP config.
- **Forms in dialogs:** `CrudForm`'s in-dialog footer takes the dialog insets (its sticky bar no
  longer overhangs a phone's padding by 4px); the message composer and the HR profile dialog render
  their forms `embedded` under the dialog header instead of a page header inside the dialog.
- **Buttons:** the four ghost Cancel buttons (adjustment kinds, both Move dialogs, HR profile) take
  the grey `soft` every other dialog uses.
- **Position overrides:** with desktop-first sizing a plain `top-*` needs `translate-y-0` too; the AI
  command palette gains it, and stays top-anchored on a phone, where the bottom sheet would sit
  under the keyboard.
- **Switchers in modal forms** take `SegmentedControl tone="inset"`; the default white rail is
  invisible on a white panel.
- **Hand-rolled panels:** Filters, Saved views, Version history and the appointment staff sheets
  take the scrim token, drop their seam borders and header dividers, and use the shared title and
  close. The three search confirmations are rebuilt on `Dialog`, which also gives them a focus trap.
- **Kept intact:** the AI assistant panels' own layout (their full-screen phone sheet is restated
  under `max-sm:`), the deal won/lost celebration, and body content inside dialogs.

## Phase 4 — one look for every switcher and toggle

A chosen option looked three different ways. The calendar bar's switcher was a near-black pill
filling the bar's 36px; the same control in a dialog was a white pill 26px tall, inset in a grey
rail, with grey labels; and a toggle chip that was on took the blue primary fill. Side by side in
one dialog (the weekly repeat's days above its "Ends" switcher) they read as parts of three
products.

### Primitives

- **`SegmentedControl` has one look.** The pill is always the near-black `sidebar` pill and fills
  the track (`flush` is now the default, 36px at `default`, 32px at `sm`); unselected labels are
  full ink with a quiet hover fill. `tone` changes the rail only: white on the grey ground, the grey
  control fill on a white dialog, card or popover, the same flip the fields make.
- **`Button variant="toggle"`.** At rest the second-rank `soft` button; with `aria-pressed="true"`
  the switcher's pill. It replaces `variant={on ? 'default' : 'soft'}`, which made "on" the blue
  of a primary action. Blue stays for the primary action and a checked Checkbox, Radio or Switch.
- A label with a switch is the shared `SwitchField`, whose label is set like a field label.

### Call sites

- **New event:** attendees move to the right-hand column, so a meeting is three fields and three
  rather than four beside two with an empty corner, and a task three and two; All day is a
  `SwitchField` with a 14px label (was a 12px grey one); the weekday picker is the shared
  `WeekdayToggles`.
- **New meeting / Log call (Schedule activity):** the type switcher is centred, as in New event;
  All day is a switch (was a checkbox); the recurrence settings drop their warning-coloured box and
  use the same weekday row (were round, blue, hard-coded English "Mo/Tu"); the title field's text
  weight matches the other fields.
- **Toggle chips → `toggle`:** activity and change-log filters, call direction and outcome, task
  priority, role team filters, tag categories, link filters, chat task assignee and "Assigned to
  me", integration categories, and the appointment service tabs and Fit screen.
- **Hand-built switchers → `SegmentedControl`:** the staff timesheet period and view switchers
  (their row's Save moves to the same 36px) and the invoice forecast range. A forecast preset equal
  to the horizon keeps its own segment, so exactly one segment is ever lit.
- **Copy:** the event dialog's title is "New event", matching the button that opens it, and the
  calendar settings save reads "Save changes" like every other dialog.

### Deliberately not changed

- `Tabs` keep their underline: they switch panels, a different control.
- Date selections (the activity day strip, the date picker) keep the blue selected day.
- Modules withheld from v1 (deals, sales, WMS, warranty and the rest) keep the old chip pattern
  until they return to the product.

## Phase 5 — forms get room

The create and edit pages read as cramped. Measured on Create Company at 1440px: a section title sat
16px under the panel above it, the same 16px as above its own panel, so titles did not group with
their sections; rows of fields and the columns within a row were 16px apart; the main and side
columns were 16px apart; and the side column's three Lifecycle dates each got about 90px, cutting
their placeholders to "Pick a ...".

### Shared form chrome (`formChrome.ts`, `CrudForm`)

- **Spacing on the 8px grid:** 8px from label to control (unchanged), 24px between fields across and
  down, 32px panel padding from `sm`, and 32px between sections and between the two columns. A
  section title now sits 36px under the panel above it and 16px over its own.
- **Fields split by the width they are given.** `half` and `third` fields sit side by side only when
  the screen is `md`+ AND the field grid's own column is at least 28rem, via a named container
  query (`@container/crud-fields`). The side column's dates now stack at full width; the main
  column is unchanged. On a tablet, where the form column is about 400px, fields stack rather than
  splitting into two 190px halves.
- A group's explanatory line is 14px, the size of a section description (was 12px).

### Call sites

- **Create person:** Primary email and Primary phone sit side by side, as on Create company (they
  were a full row each). The person edit form shares the fields and follows.

## Changelog

- 2026-09-26 — Implemented.
- 2026-09-27 — Phase 2: shape, type, surfaces, focus and shell conversion.
- 2026-09-27 — Phase 3: modals. Unit coverage in `dialog.test.tsx` and `ConfirmDialog.test.tsx`.
- 2026-09-27 — Phase 4: one look for every switcher and toggle. Unit coverage in
  `segmented-control.test.tsx`, `button.test.tsx`, `WeekdayToggles.test.tsx`,
  `ScheduleSection.test.tsx`, `DateTimeFields.test.tsx`, `ViewSwitcher.test.tsx` and the invoice
  dashboard's `page.test.tsx`.
- 2026-09-27 — Phase 5: forms get room. Unit coverage in `CrudForm.spacing.test.tsx`.
