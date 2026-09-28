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
| Page ground `--background` | `#FFFFFF` | `#000000` |
| Ink `--foreground` | `#1D1D1F` | `#F5F5F7` |
| Surface / card | `#FFFFFF` | `#1C1C1E` |
| Card edge `--card-edge` | `#E5E5EA` | transparent |
| Popover | `#FFFFFF` | `#2C2C2E` |
| Muted fill / hover ladder | `#EDEDF0` → `#E3E3E8` | `#2C2C2E` → `#3A3A3C` |
| Secondary label `--muted-foreground` | `#6E6E73` | `#A1A1A6` |
| Hairlines `--border` / `--border-strong` | `#E5E5EA` / `#D2D2D7` | `#38383A` / `#48484A` |
| Button blue `--primary` | `#0071E3` | `#0071E3` |
| Link blue `--accent-strong` | `#0066CC` | `#2997FF` |
| Control fill (soft button, field well) | `#E8E8ED` | `#2C2C2E` |
| Switcher rail on the ground `--segmented-rail` | `#E8E8ED` | `#1C1C1E` |
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

## Phase 6 — the topbar

Every control on the bar already stood 36px tall, but they did not look it: the organisation switcher
was a grey filled button with a shadow and the search a white field with a medium drop shadow, while
the module switcher, the AI button and the icon buttons were borderless. The chat icon and the
breadcrumb chevrons were 20px among 16px icons, the ⌘L hint was a bordered span unlike the ⌘K chip,
and the ⌘K chip sat 1.5px below the centre line.

- **No wordmark.** The bar opens with the module switcher; the breadcrumb's home link leads back to
  the dashboard. An organisation's own uploaded logo still shows.
- **Apple's navigation material.** The bar was the page ground at 80%, the same grey as the page,
  so it had no surface of its own. It is now a frosted white sheet over the grey page (`surface` at
  80%, 24px blur, 1.5× saturation) with a hairline under it, as apple.com's navigation and Safari's
  toolbar are. Action icons and labels are ink (#1D1D1F); only secondary marks are grey (menu
  chevrons, the breadcrumb's links and separators, the search glyph).
- **One control style:** borderless, 36px, one hover fill (`bg-surface-strong`, now also
  `IconButton`'s ghost hover, which was a near-invisible `accent`), 16px icons, 14px medium labels.
  The search is the one field and sits darker than the bar, as Apple's toolbar search fields do: the
  grey control fill (#EDEDF0), flat. The `raised` search tone keeps only a light `shadow-xs` and no
  hover fill.
- **Shortcut chips** are the shared `Kbd`, 28×22, centred: ⌘K white inside its grey field, ⌘L grey on
  the white bar.
- **Fits every width.** Icon buttons never shrink. The labelled controls show their labels from `xl`,
  the search narrows below `lg`, and the four secondary icons move under More below `lg`, so the bar
  neither scrolls sideways nor squeezes a button, from 360px to 1440px.

## Phase 7 — the dashboard's customise mode

The "Add a widget" panel appeared and vanished outright, so the widget grid jumped by the panel's
height (and the 24px gap under it) every time Customize or Done was pressed. It now folds: the panel
stays mounted and animates its row from `0fr` to `1fr` with its opacity, 300ms ease-out opening and
200ms ease-in closing (the DS values for a large layout change), and the gap is padding inside the
folding box, so the grid slides and nothing jumps at either end. It also folds shut by itself once
the last available widget is added. Closed, the panel is `inert`. Reduced motion makes it instant
through the global rule.

## Phase 8 — loading states that are the page

The backend drew one table shape for every loading page, without the module sidebar, so the sidebar
arrived with the page and pushed it 256px across, and a form, a record, the calendar or the dashboard
resolved into something that looked nothing like the placeholder. Three rules now:

- **Frame first.** The route-level fallback (`loading.tsx`) frames the page the way the page frames
  itself. The layout builds each route's shape from the metadata it already reads (`moduleSidebar`,
  the group and breadcrumb parent of a page no nav link leads to, and the new `loadingSkeleton`) and
  hands them down through `BackendRouteShapesProvider`, so the module's real sidebar is in place
  before the page arrives.
- **Draw only a known shape.** A page declares `loadingSkeleton` (`list`, `detail`, `calendar`,
  `conversation`) in `page.meta.ts` only when its layout is that skeleton's, and
  `loading-skeleton-declarations.test.ts` holds each declaration to the component that draws that
  layout. Any other page gets `PageLoadingIndicator`: nothing for 400ms, then a small spinner. Declared
  so far: the People and Companies lists, the person and company records, the calendar and chat.
- **The component that knows the layout draws the skeleton.** `DataTable`'s first load draws six rows
  in its own columns, with the selection and row-actions cells real rows have, so they stand 65px like
  real rows. `CrudForm` draws `FormSkeleton` from its own groups and fields while its record loads:
  the real section titles and labels, the spans, and each control's height (a 36px box, a textarea of
  its rows, a checkbox row, an editor), with its footer. The dashboard draws `DashboardSkeleton` for its
  layout and the same placeholder rows in each card while a widget's module loads. The customer
  records draw `DetailPageSkeleton` in place of the loading message.

Measured at 1440×900, the People list's fallback, its table's first load and the loaded page share
the title row (52px), the card's top (164), the toolbar (60px), the header row (40px) and 65px rows.
The person record's header card (198px) and lower block (302), the calendar's grid (748px) and bar
controls (within a pixel), and the chat rail and card land exactly. What still moves is a table's
column widths: every column takes the width of the widest cell, which only the data knows, so until
it arrives the columns are as wide as their headings.

`ButtonGroup` in a row is now its size's control height with the border inside it (36px by default).
The border used to sit outside full-height buttons, so the AI trigger beside a table's search was
38px and made every toolbar holding it 2px taller than the rest.

## Phase 9 — every side panel moves the same way

Side panels had four motions: a `Drawer` slid in 200ms and out 150ms on the default curve, a
`Sheet` took 300/200ms, the seven AI assistant panels were centred modals pushed to the right edge
and rose in with the modal's rise-and-fade, and the hand-built panels (version history, columns,
views, the UMES devtools, portal notifications, the appointment staff sheet, the AI dock and the
dockable chat) appeared and vanished outright. Three sheets its parent mounted only while open
(the tasks calendar, the chat task composer, chat's narrow context drawer) could not play an exit
at all, because the parent's unmount removed them first.

Now there is one motion, in `packages/ui/src/primitives/side-panel-motion.ts`: a panel slides the
whole way in from its edge in 500ms and out in 300ms on `ease-panel`, Apple's sheet curve (a quick
start that settles slowly), and its scrim fades on the same timing. The exit holds its last frame
and takes no clicks.

- **Primitives.** `Drawer` and `Sheet` carry it. `Dialog` gains `side="right" | "left"`, a real
  side sheet (full height, full screen on a phone), and the seven AI panels use it instead of
  overriding the modal's position. The modal's entrance is declared outside Tailwind's layers, so a
  side sheet drops it rather than trying to outrank it.
- **Hand-built panels** set `data-state` from `useSidePanelPresence`, which keeps them mounted for
  the slide out. **Sheets their parent unmounts** close themselves with `useSidePanelDismiss` and
  tell the parent once the exit has played.
- **In-page panels move their width on the same timing.** The AI dock slides in while the page's
  reserved padding grows in step, so the content edge meets the dock the whole way; collapsing it
  to its rail and back does the same. Chat's split panel keeps its width animation on the shared
  timing. The record pages' form column is now one layout that folds: the column narrows to nothing
  while the rail widens in and the tabs take the room, 300ms folding and 500ms opening. The folded
  form stays mounted but inert, so a collapse no longer throws away what was typed.

Measured with the animations sought frame by frame: the Customers AI panel covers 505 of its
576px exit in the first 100ms and lands at 300ms; docking the AI panel moves the page's padding
and the dock's edge together (their sum stays at the viewport width at every sample); the record
page's content edge glides from 864px to 340px as the form folds and back as it opens.

## Phase 10 — the record page

The lower half of a person or company record (details panel, tabs, schedule and history) was
rebuilt. The worst of it: collapsing the details panel swapped its « button for a column of four,
an expand arrow and one icon per section, and one of those ("My roles") pointed at a group the
page no longer has.

- **One sidebar button.** A button with the sidebar glyph shows and hides the panel. It leads the
  tab row in every state; the panel folds away beside it and the content under the row spans the
  full width, so the cards line up with the header card. `CollapsibleZoneLayout` loses `sections`
  and `toggleTone`. A zone-2 toolbar takes the button with `useZoneToggleSlot()`; where none does
  (the deal page), the layout keeps a column for it. Side by side, collapsed and stacked are one
  tree, so stacking no longer remounts the form either.
- **Details panel.** `CollapsibleGroup tone="card"` is an inset group: the title and a disclosure
  chevron, no field count. The reorder grip waits for hover or focus (it stays on touch screens).
  The company panel's titles are no longer upper case. An embedded form's empty header-actions row
  no longer adds 8px above its first group, so the panel's top meets the tab row's.
- **Pickers.** `DictionaryEntrySelect actionsPlacement="menu"`, and the same on `CompanySelectField`:
  Add and Manage are the last rows of the menu, and an entry's colour is a dot before its label, in
  the field and in the menu. The swatch and hex code under the field are gone. The record pages opt
  in through `createPersonEditFields` / `createCompanyEditFields(t, { dictionaryActions: 'menu' })`;
  create forms keep their buttons.
- **Tabs.** `RecordTabsBar` serves the person, company and deal records: text tabs with the count as
  a quiet number, one weight in every state, no "NEW" pill. Tabs that do not fit go behind More
  instead of scrolling out of sight, and the active tab always stays in view. The tab's own action
  is a soft button.
- **Schedule.** `ActivitiesDayStrip` is a Monday-to-Sunday week, as in Apple Calendar: weekday over
  date, the selected date in a filled circle, today in accent ink, and up to three dots for the
  day's events, red when two of them overlap. One header row holds the month (it opens a date
  picker), ‹ Today › as one group, and Add new. It replaces five 104px tiles, two rows of arrows and
  the "Weekend" labels. Each event row is its time (red when overdue), glyph, title and one quiet
  line: type, company or deal, duration.
- **History.** The person and company histories share one design (`ActivityHistoryParts`): a title,
  a compact search and one Filter button in place of the chip row. The popover holds the types with
  their counts, the date range (and the sort order on a company), and Clear; the button takes the
  accent and a dot while anything is filtered. Rows are list rows: glyph, title, a two-line body and
  one meta line ("Call · Ada Lovelace · with Sarah · 32m"), the time at the trailing edge, and Mark
  done while the activity is open, divided by hairlines that start at the text, with year headings.
  The disabled "AI:" placeholder chips are gone (nothing was behind them), and so is the "See all N
  activities" line.

Measured at 1600×1000 with the panel open: panel 288–800px, the button at 816, the tab rule from 864
and the cards 816–1568, the panel's first group and the tab row both starting at y 302. Collapsed:
the button at 288 and the cards 288–1568, the same span as the header card; the fold runs 300ms on
`ease-panel`. At 1536px the person record's Change log and Files move behind More. On a 375px phone
nothing scrolls sideways and the week's controls wrap under the month.

## Phase 11 — one tab strip, and it moves

Tab strips looked six ways. The record tabs had one weight and a quiet count; the shared underline
strip set the selected label semibold, washed the hovered tab in blue and put counts in pills, over a
rail drawn in `border-input`, which the Apple palette makes transparent; the scheduler's job log, search
settings and the AI playground used the pill tabs, the grey rail and white pill Phase 4 retired from
switchers; the Tasks module drew its own 44px strip that turned bold on hover; the tag manager, the
customer portal's notification panel and the UMES devtools drew theirs from buttons and border classes;
and the checkout and warranty screens restyled the shared strip with their own padding and count chips.
The selection jumped: the underline appeared under the new tab without moving, and the panel below
swapped in one frame. The 38px tabs sat half a pixel off the rail of their 40px row.

- **One look.** Text tabs in one weight, the selected one in full ink and the rest in secondary ink that
  darkens on hover, with no fills. The tabs are 36px in a 40px row over a 1px hairline rail, and the
  selected tab's 2px accent bar covers the rail. A count is a quiet number after the label; an icon is
  16px in the tab's ink. The pill look is gone, `variant` is deprecated and ignored, and
  `reserveActiveWidth` is gone: with one weight nothing moves when a tab is chosen.
- **It moves.** The bar glides from the old tab to the new one in 300ms on `ease-panel`. Each tab draws
  its own bar, so it is right on the first paint and in a strip that scrolls or wraps; script only
  animates a change, starting the new bar where the old one is on screen, mid-glide included, or where
  it last came to rest if the old tab has left the strip. Labels change ink over 200ms. The new panel
  fades in over 150ms, the `fadeIn` motion: `TabsContent` does it, and `TabsPanel` does it for a page
  that renders the selected tab's content itself. That panel stays mounted, so the content keeps its
  state. Reduced motion makes all of it instant.
- **Keyboard.** Arrow keys move along the strip and Home and End to its ends; Enter or Space selects, so
  a tab whose panel loads data is not fetched in passing. Every tab stays in the Tab order.
- **Room.** A strip that runs out of room wraps. The Tasks, integrations, warranty workspace and tag
  manager strips scroll sideways instead, with the scroll on a wrapper and the list `w-max min-w-full`:
  a scroll container clips at its padding edge, which would cut the half of the bar that covers the
  rail. The record tabs keep More.
- **Call sites.** The record tabs' row is fixed at 40px, so the rail stays put whether or not a tab has
  an action, and their panels are `TabsPanel`s. `TasksTabs` is now a wrapper over `Tabs`. The tag
  manager's categories, the portal's notification tabs and the devtools tabs use the strip; the tag
  manager's scroll arrows sit on the tabs' 36px band. The checkout template form and the warranty
  screens lose their overrides. Job logs, search settings and the AI playground move from pills to the
  strip. Planner schedules, resources, staff members and teams, audit logs, the attachment previews and
  the mobile person zones fade their panels in. The action button in the resources and staff card rows
  moves from 32px to 36px, the height of the tabs beside it.

### Deliberately not changed

- `SegmentedControl` and toggle lists, such as the Edit tags dialog's categories, pick a mode, not a
  panel (Phase 4).
- The AI chat's session tabs are document tabs, renamed in place and closed, a different control.
- Modules withheld from v1 keep their hand-built strips (the deals pipeline's views, the sales document
  and channel tabs) until they return to the product, as in Phase 4.
- A tab that filters a list (notifications, saved views, portal claims, translation locales) leaves the
  list to update in place, as any filter does; it does not fade.

Measured at 1600×1000 on a person record: the row 40px from y 302, the tabs 36px from y 305, the rail at
y 341 and the bar at 340–342 over it; every tab's x position and width are the same as before. From
Change log to Files the bar covers 53% of the 115px in 50ms and 95% by 150ms, and lands at 300ms; a
second change mid-glide starts from where the bar is. On a company record the row stays 40px and the
panel starts at y 422 with and without the tab's Add person button. The Tasks team view, resources,
integrations, audit logs, search settings, the AI playground, the notification panel and the tag
manager measure the same: 40px row, 36px tabs, weight 500, the bar over the rail. On a 375px phone the
zone switcher's bar glides 179.5px and nothing scrolls sideways.

## Phase 12 — one page frame

A survey of the 136 backend pages the demo admin can open without a record found most of them on the
shell's frame: content from the column's left edge, or beside a module sidebar, starting at y 88. The
exceptions fell into five groups.

- **Locked pages ran into the window's bottom edge.** A seat planner change had set the bottom padding
  of every `<Page fill>` page to 0, so chat and the booking overview ended flush on the edge while the
  calendar, which measures its own height, kept 16px. A locked page now keeps 16px under it, the
  calendar's gap, set once in the `globals.css` rule, so chat, the calendar, the booking overview and
  the Tasks team view all end on the same line. A unit test ties the rule to the calendar's constant;
  it reads the app's stylesheet, so it is listed in `scripts/repo-wide-guards.mjs` and runs on every PR.
- **A 1px line under every page.** The app-wide `FrontendLayout` wrapped its footer in a bordered div
  even when the footer rendered nothing, and `AuthFooter` renders only on the login and onboarding
  pages. Every document was 1px taller than its content, and every locked page scrolled by 1px. The
  footer now draws its own chrome, and on the login and onboarding pages there is one border above it
  where there were two.
- **The full-bleed planner stopped short.** The seat planner undoes the gutter with negative margins,
  but the page's `h-full` only moved it up, so it ended 24px above the bottom edge (40px once locked
  pages kept their gap). Its loading skeleton sat inside the gutter, so the whole frame jumped when the
  data arrived. Both now use one frame that grows into the undone gutter as a flex item and covers the
  pane under the topbar exactly.
- **Pages that drew their own frame.** The chat workspace was a centred 672px column 16px lower than
  its siblings; the custom entities settings were capped at 672px and titled by an `h3` inside the
  form; the staff timesheets' "no profile" message started 48px down outside a card, while My
  Availability showed the same kind of message in a card with a 32px button. All four now sit on the
  frame, both messages in the same card with a 36px button.
- **Page titles in three sizes.** `PageHeader` pages had the 32px large title. The AI assistant's four
  pages, search settings, the three notification settings pages, sidebar customization, the booking
  overview and the Tasks views drew their own at 24px, bold or semibold, and the chat workspace at
  18px. They now use `PageHeader`, or `PAGE_TITLE_CLASS` where the header carries its own controls,
  and drop the decorative icons beside the AI titles. Sidebar customization shows the same header
  while it loads, where its placeholder bars were sized for the old title.

`.ai/ds-rules.md` → Page gutter now states the bottom edge: 48px under an ordinary page, 16px under a
locked one, and how a full-bleed locked page undoes it.

### Deliberately not changed

- Settings panels that title themselves inside a card (system status, cache, catalog, dictionaries,
  encryption, translations, currency fetching, customers and appointments configuration, attachments,
  module telemetry, integrations, change password) keep their 14–20px card titles. Giving them page
  titles is a redesign of those panels.
- Record headers, the dashboard greeting and forms' compact `FormHeader` are their own elements.
- The settings family's 32px rhythm (`space-y-8`), consistent within the family and allowed by the
  spacing scale.
- Loading states inside the frame. The seat planner's skeleton header is 56px and the loaded one 61px,
  or 65px with a category line, so the timeline settles 5–9px lower once loaded. The AI assistant's
  settings, agents and playground pages, the notification settings page and the personal notification
  preferences page show a spinner without their header while their data loads, so the title appears
  with the data. That is skeleton work, as in Phase 8.
- Modules withheld from v1, and pages the demo admin cannot open, were not measured.

Measured at 1600×1000 against the survey before the change: 114 pages unchanged, the dashboard's
greeting changed with the hour, and the other 21 changed only as described above. Chat, the calendar, the booking overview and the Tasks team view end at y 984
and every locked document is 1000px tall (1001 before). The changed titles are 32px semibold at
(288, 88); search settings' is at y 226, under the partial-index banner. The chat workspace and custom
entities span 288–1568 from y 88; the timesheets and My Availability cards start at y 88 and span
288–1568. The seat planner and its skeleton cover 0–1600 by 64–1000 with nothing scrolling, and the same
pane at 375×812, 800×900 and 1100×900. On a 375px phone chat and Today keep 16px on every side, end at
y 796 and nothing scrolls sideways.

## Phase 13 — every page opens with its title

Phase 12's survey showed the frame holding on every page: the content column starts at y 88 and ends
at x 1568. What varied was what a page put first. Six pages put something above their title, seventeen
titled themselves inside a card or at a smaller size, and some had no title at all, or none while they
loaded.

- **List cards sit where page content sits.** `DataTable` kept an empty 12px wrapper for widgets
  injected under its title even when there were none, so a list with extension points had 36px between
  its title row and its card where every other page has 24px. The wrapper now hides when empty, and the
  list skeleton drops the copy it kept of it.
- **Nothing above the title.** Audit logs led with its tab strip and titled each table with the tab's
  name; it now has one title with the tabs under it, and each table keeps its buttons. Email templates
  led with its own search, status filter and buttons; they move into the table's card and title row,
  keeping search on submit, and the status select no longer runs 49px out of its label into the Compose
  button. The entities pages led with a collapsed help card, which now follows the table. Timesheet
  projects led with its KPI cards and titled only its table view; its title and Add Project button now
  sit on a page header in both the table and card views. Data sync led with its sync card and titled
  the runs table 977px down; it now opens with "Data Sync", and the runs table takes a section heading.
- **Titles out of cards.** Cache, system status, module telemetry, profile, change password, currency
  fetching and encryption titled themselves inside a card. The card header's title, description and page
  buttons now form the page header, and the card keeps its content. Where that card only held other
  cards (cache, system status, telemetry, currency fetching), it goes, and the inner cards sit on the
  page ground. The integrations marketplace keeps its panel under a page header that carries its search
  and sort. Catalog, customers, dictionaries, appointments, translations and storage settings are made of
  titled sections and gain the page title their sidebar entry uses; the Back button shown when they are
  opened from a record moves onto the header. AI moderation flags and AI usage drew 16px and 18px titles.
  My communication channels drew a 24px title over a 32px table title, which is now its section heading.
- **No page without a title.** Messages used the table's `embedded` mode, meant for a table inside
  another surface, which dropped its title and card. My Availability and My Timesheets had no title in
  any state. The feature toggle detail page had none either; it now takes the toggle's name with a back
  arrow, as the record pages do.
- **The title does not wait for the data.** The AI assistant's settings, agents and playground, the
  notification settings and the personal notification preferences showed a spinner and no header while
  loading. They, and every page above with a loading, empty or error state, now show the same header in
  it.

`.ai/ds-rules.md` gains a "Page title" section with these rules.

### Deliberately not changed

- The visual workflow editor is a compact editor (32px controls, bands meant to run edge to edge)
  inside a module frame. It cannot go full-bleed beside the module sidebar, and aligning its header alone
  would break its bands. It needs its own redesign.
- Chat and chat search keep their messaging layout, and the calendar's toolbar is its header.
- Forms keep the compact `FormHeader`, and record pages their record header.
- Section headings inside settings cards still run from 14px to 18px, and card padding from 16px to
  24px. That is typography inside the cards, not the frame.
- The Gmail connect button is the 40px `SocialButton` beside 36px buttons; the primitive has one size.
  The timesheet projects view toggle is 32px.

Measured at 1600×1000 against the Phase 12 survey: 12 pages unchanged, 78 only 1px shorter (Phase 12's
footer fix), 19 lists with their card 12px higher, and the other 27 are the pages above, each changed
only as described. Every list now has its card 24px under its title row, at y 152 on a standard list,
and its skeleton matches. Of 135 pages, 83 open with a 32px title at the column's origin (x 288 or 32,
y 88). The rest are 37 forms with the compact header, 4 record pages, the dashboard, the calendar, chat
and chat search, the visual editor, two pages under the partial-index banner, User Modules (its
eyebrow sits above its title), the MCP consent page and two error states. The AI settings, agents and
playground, notification settings and notification preferences hold the title at (288, 88) while
loading and after. Email templates' status select ends at x 1548, inside the card, and nothing scrolls
sideways at 375px.

## Phase 14 — bright and white, and one sidebar family

The product still read as grey: the page ground was `#F5F5F7`, Apple's grouped background, so every
page sat on a grey sheet. Apple's own content backgrounds are white. Separately, the sidebars had
drifted: Tasks drew its projects with an 11px uppercase label and rows of its own, the design-system
gallery drew its nav by hand, and Chat's conversation list was a grey panel with its own rows.

- **The ground is white.** `--background` is `#FFFFFF` in light; dark is unchanged. A card is now
  white on white, so it carries a hairline: a new token, `--card-edge` (`#E5E5EA`, transparent in
  dark, so dark mode does not change). The 204 card class strings that kept a transparent border (119
  files) take `border-card-edge`, as do the ones built another way: the `Card` primitive, the list
  card, dashboard widgets, progress jobs, form groups (whose error state recolours the same edge), the
  calendar grids, the chat transcript and their skeletons. A token-wide ring on `shadow-sm` was
  rejected because buttons use it too.
- **Wells stop using the ground.** Code blocks, previews and chips that painted `bg-background` as a
  quiet fill vanished on white; they take `bg-muted` (the AI chat and playground, tool confirmation,
  API docs, the workflow edge and node dialogs, the role dialog, the mobile workflow timeline, the
  dictionary field and the advanced filter's unselected buttons).
- **Controls on the ground take the control fill.** Three controls were white on the grey ground and
  vanished on white. The default `SegmentedControl` rail, Phase 4's white rail, takes a new token,
  `--segmented-rail`: the control fill (`#E8E8ED`) in light and, in dark, the raised surface it already
  was (`#1C1C1E`), because on the `#2C2C2E` well the dark pill fell from 1.49:1 to 1.23:1 against its
  rail. `inset` stays the field well for a card or a dialog, and both tones turn white inside a grey
  form section with the fields. The schedule toolbar's switcher sat in its own white card with the
  ground's rail, invisible in both themes; it takes `inset`. The calendar's arrows take the soft grey
  that Today and New task wear. The `raised` search (chat search) stays white and carries
  `card-edge`.
- **One sidebar family.** Every sidebar is composed only from `ModuleSidebar`'s parts, which now
  follow Apple's sidebars: the label in ink, the 16px icon in the accent, a count in the secondary
  label, and the selected row on the grey fill. The parts gained what the drifted sidebars needed
  instead of forking: `ModuleSidebarLink` takes `leading` (an avatar), `trailing` (an unread dot) and
  `emphasized`; `ModuleSidebarSection` is a group a module loads itself (a linked label, a badge, one +
  action, loading rows, an empty note, a named nav region); `ModuleSidebarNote` and
  `ModuleSidebarSkeletonRow` are exported; `ModuleSidebarAction` can open a menu; and a sidebar can opt
  into collapsing to its icons. Tasks, the design-system gallery (keeping its collapse) and Chat's
  conversation rail are rebuilt on them, and the chat skeleton follows.

`.ai/ds-rules.md` records the white ground, the card edge, controls on the ground and the sidebar
family; `.ai/ui-components.md` records the rail and the raised search.

### Deliberately not changed

- `CrudForm` section panels stay grey (`surface-muted` with white fields): the panel is what groups a
  form. Dialogs stay `#F2F2F7`, Apple's grouped background for a modal sheet.
- Chat's rail keeps its 16rem column, 2rem wider than a module sidebar, for its avatars and filter.
- Every item from Phase 13's list stands.

Measured at 1600×1000. The ground reads `rgb(255, 255, 255)` and cards carry a 1px `#E5E5EA` edge in
light and none in dark. In the Tasks sidebar, idle links are `#1D1D1F` with `#0071E3` icons, the
selected row is `#E8E8ED` with blue text, every row is 36px, the action icon is 16px, and "My
Projects" is a 12px semibold grey label on a 24px row with a 24px +. Chat's rail matches: 36px rows on
the same 40px pitch, 12px semibold section labels, unread rows semibold with a dot and announced as
"2 unread messages", sections named as nav regions, and "New chat" as wide as its rows; its menu opens
with Direct message and New space, and Escape returns focus to it. On the calendar, Today, both
arrows and both switcher rails are `#E8E8ED` at 36px, and in dark the rails are `#1C1C1E` as before;
in a form section the rail is white on `#EDEDF0`, like its fields; the chat search at rest shows its
1px edge.

## Changelog

- 2026-09-26 — Implemented.
- 2026-09-27 — Phase 2: shape, type, surfaces, focus and shell conversion.
- 2026-09-27 — Phase 3: modals. Unit coverage in `dialog.test.tsx` and `ConfirmDialog.test.tsx`.
- 2026-09-27 — Phase 4: one look for every switcher and toggle. Unit coverage in
  `segmented-control.test.tsx`, `button.test.tsx`, `WeekdayToggles.test.tsx`,
  `ScheduleSection.test.tsx`, `DateTimeFields.test.tsx`, `ViewSwitcher.test.tsx` and the invoice
  dashboard's `page.test.tsx`.
- 2026-09-27 — Phase 5: forms get room. Unit coverage in `CrudForm.spacing.test.tsx`.
- 2026-09-27 — Phase 6: the topbar. Unit coverage in `AppShell.test.tsx`, `icon-button.test.tsx`,
  `search-input.test.tsx` and `AiAssistantLauncher.test.tsx`.
- 2026-09-27 — Phase 7: the dashboard's add-widget panel folds open and shut. Unit coverage in
  `dashboard/__tests__/DashboardScreen.test.tsx`.
- 2026-09-27 — Phase 8: loading states that are the page. Unit coverage in
  `skeletons/__tests__/PageSkeletons.test.tsx`, `skeletons/__tests__/backendRouteShapes.test.ts`,
  `CrudForm.loadingSkeleton.test.tsx`, `DataTable.refetchAndBulk.test.tsx`,
  `DashboardScreen.test.tsx`, `button-group.test.tsx`, the backend `loading-shape.test.tsx`, core's
  `loading-skeleton-declarations.test.ts` and shared's `registry.test.ts`.
- 2026-09-27 — Phase 9: every side panel moves the same way. Unit coverage in
  `side-panel-motion.test.tsx`, `AiDock.test.tsx` and `CollapsibleZoneLayout.test.tsx`.
- 2026-09-27 — Phase 10: the record page. Unit coverage in `CollapsibleZoneLayout.test.tsx`,
  `CollapsibleGroup.test.tsx`, `DictionaryEntrySelect.test.tsx`, `RecordTabsBar.test.tsx`,
  `ActivitiesDayStrip.test.tsx`, `ActivitiesDayStrip.abort.test.tsx`, `ActivityTimelineFilters.test.tsx`
  and `ActivityCard.test.tsx`; TC-UX-001, TC-UX-001b, TC-CRM-051 and TC-CRM-057 follow the new controls.
- 2026-09-27 — Phase 11: one tab strip, and it moves. Unit coverage in `tabs.test.tsx`,
  `soft-opt-ins.test.tsx`, `RecordTabsBar.test.tsx`, `ManageTagsDialog.test.tsx` and resources'
  `guarded-mutations.test.tsx`.
- 2026-09-28 — Phase 12: one page frame. Unit coverage in `useAvailableHeight.gutter.test.ts` and
  `frontend/__tests__/Layout.test.tsx`.
- 2026-09-28 — Phase 13: every page opens with its title. The timesheets, communication channels and
  integrations marketplace tests mock `PageHeader`.
- 2026-09-28 — Phase 14: bright and white, and one sidebar family. Unit coverage in
  `module-nav/__tests__/ModuleSidebar.test.tsx`, `segmented-control.test.tsx` and the backend
  `loading-shape.test.tsx`.
