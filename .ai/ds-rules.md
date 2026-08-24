# Design System Rules

> Referenced from root `AGENTS.md`. Also see `packages/ui/AGENTS.md` for component-level usage (Avatar, Tag, Kbd, Button, CrudForm, DataTable, etc.).

## Colors
- NEVER use hardcoded Tailwind colors for status semantics (`text-red-*`, `bg-green-*`, `text-emerald-*`, `bg-blue-*`, `text-amber-*`, etc.)
- NEVER use hardcoded hex/rgb values in className — always use semantic tokens
- All semantic tokens have dedicated dark mode values — NO `dark:` overrides needed

Decision tree — ask "what color do I need?":

| Question | Answer | Token |
|----------|--------|-------|
| Is it a status indicator (error/success/warning/info/neutral)? | Yes → | `{property}-status-{status}-{role}` (e.g. `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`) |
| Is it a destructive action (delete/remove/discard trigger or its icon)? | Yes → | `text-destructive`, `bg-destructive` — NOT for error copy, see the row above |
| Is it the confirm button inside a confirmation dialog? | Yes → | `Button variant="destructive-solid"` (the only filled-red control) |
| Is it primary text? | Yes → | `text-foreground` |
| Is it secondary/placeholder text? | Yes → | `text-muted-foreground` |
| Is it disabled/placeholder-weight text? | Yes → | `text-disabled-foreground` |
| Is it a primary action (the CTA)? | Yes → | `bg-primary`, `text-primary-foreground`, hover `bg-primary-hover` |
| Is it an *interactive* accent (link, active tab underline, sort indicator, slider, progress)? | Yes → | `text-accent-strong`, `bg-accent-strong`, `border-accent-border`, tint `bg-accent-soft` |
| Is it a filled selection control (Checkbox / Radio / Switch, checked)? | Yes → | `bg-primary`, `text-primary-foreground` — NOT `accent-strong` |
| Is it a raised plane (card, table, menu, dialog)? | Yes → | `bg-surface` |
| Is it inside the backend sidebar (rail, nav row, group overline, hairline)? | Yes → | the `sidebar-*` family — see **Sidebar** below. NEVER the content-side neutrals |
| Is it a quiet fill (table header, chip, inactive tile)? | Yes → | `bg-surface-muted` |
| Is it a **chrome hover** (topbar button, toolbar tile)? | Yes → | `bg-surface-strong` |
| Is it modal chrome / a filled input? | Yes → | `bg-surface-modal`, `bg-modal-muted` |
| Is it a selected row / soft primary tint? | Yes → | `bg-primary-soft`, `border-primary-border` |
| Is it a subtle background (legacy hover, accent)? | Yes → | `bg-secondary`, `bg-accent`, `bg-muted` |
| Is it a border? | Yes → | `border-border`; emphasised `border-border-strong`; inputs `border-input` |
| Is it a focus ring? | Yes → | `ring-ring` / `ring-focus-ring` |
| Is it a card/popover surface? | Yes → | `bg-card`, `bg-popover` |
| Is it part of a data table? | Yes → | `bg-table-header`, `bg-table-row-hover`, `bg-table-selected`, `border-table-border` |
| Is it a non-status pill? | Yes → | `bg-badge-bg`, `text-badge-text`, `border-badge-border` |
| Is it a chart/data visualization? | Yes → | `chart-blue`, `chart-emerald`, `chart-amber`, etc. |
| Is it brand accent? | Yes → | `brand-violet` |

Status token structure: `{property}-status-{status}-{role}` where status = `error`|`success`|`warning`|`info`|`neutral`|`pink` and role = `bg`|`text`|`border`|`icon`.

`pink` is a **categorical accent**, not a semantic state: use it for stage/category chips (e.g. pipeline stage badges, Tag variants) where a sixth distinct hue is needed. NEVER map an entity's success/failure state to `pink` — semantic outcomes stay on `error`/`success`/`warning`/`info`/`neutral`.

## Brand Colors

Brand colors express identity and are **separate from semantic tokens**. Semantic tokens drive 99% of the UI — brand colors are reserved for brand moments.

| Token | Hex |
|-------|-----|
| Brand Sky | `#A9C4EC` |
| Brand Lilac | `#C9C2F0` |
| Brand Violet | `#BC9AFF` |
| Brand Black | `#0C0C0C` |
| Brand Gray 700 | `#434343` |
| Brand Gray 500 | `#B6B6B6` |
| Brand Gray 100 | `#E7E7E7` |
| Brand White | `#FFFFFF` |

Brand colors do NOT flip in dark mode.

#### When to use brand colors

| Use case | Token |
|----------|-------|
| **AI / intelligence touchpoints** (buttons, dots, chips marking AI features) | `brand-violet` |
| **Custom views / perspectives pills** (user-created views saved by user) | `brand-violet` (10% bg, 30% border, 100% text) |
| **Floating feedback / onboarding widgets** | Full gradient (`#A9C4EC → #C9C2F0 → #BC9AFF`) |
| **Hero sections on marketing / landing pages** | Full gradient OR Brand Sky as standalone hero bg |
| **Loading / progress for AI operations** | `brand-violet` or gradient stroke |
| **Splash / onboarding / success celebration moments** | Full gradient |

Decision tree — ask "is this a brand moment?":

| Question | Answer | Token |
|----------|--------|-------|
| Is it flagging AI functionality or AI-generated content? | Yes → | `brand-violet` |
| Is it a user-saved view / perspective / custom entity pill? | Yes → | `brand-violet` (10% bg, 30% border, 100% text) |
| Is it a landing page hero, marketing banner, or splash screen? | Yes → | Full gradient `from-brand-sky via-brand-lilac to-brand-violet` |
| Is it a floating CTA widget (feedback, onboarding invite, celebration)? | Yes → | Full gradient |
| Is it a standard UI element in the backend admin (button, input, card, table)? | **No brand** → | Use semantic tokens |
| Is it a status indicator (error/success/warning/info)? | **No brand** → | Use status tokens |

```tsx
// Brand violet — semantic CSS token
<div className="text-brand-violet" />
<div className="bg-brand-violet/10 border-brand-violet/30 text-brand-violet" />

// Brand gradient — inline style (floating widgets and hero sections only)
<div style={{ background: 'linear-gradient(135deg, #A9C4EC 0%, #C9C2F0 50%, #BC9AFF 100%)' }} />
```

## Chart Colors

Data visualization uses the dedicated `--chart-*` palette — never status tokens, and status semantics never come from chart colors.

| Token | Purpose |
|-------|---------|
| `chart-blue`, `chart-emerald`, `chart-amber`, `chart-rose`, `chart-violet`, `chart-cyan`, `chart-indigo`, `chart-pink`, `chart-teal`, `chart-orange` | Named series colors — pick in this order for multi-series charts so palettes stay consistent across dashboards |
| `chart-1` … `chart-5` | Legacy unnamed base palette (shadcn default) — prefer the named tokens in new code |

- Charts MUST use `chart-*` tokens (`text-chart-blue`, `bg-chart-emerald`, `stroke`/`fill` via `var(--chart-*)`)
- NEVER color a chart series with `status-*` tokens, and never derive an entity's status color from `chart-*`
- Exception: a chart that literally encodes status (e.g. error-rate line) may use `status-{status}-icon` for that one series — document it in the component
- All `chart-*` tokens have dedicated dark-mode values — no `dark:` overrides

## Surfaces & Elevation

The product sits on a four-step neutral ladder. Pick by **job**, not by how dark you want it:

| Step | Token | Job |
|---|---|---|
| 0 | `bg-background` | the page ground; nothing else uses it |
| 1 | `bg-surface` (= `bg-card`, `bg-popover`) | the raised plane: cards, tables, menus, dialogs |
| 2 | `bg-surface-muted` (= `bg-muted`, `bg-accent`, `bg-secondary`) | quiet fill inside step 1: table headers, chips, inactive tiles |
| 3 | `bg-surface-strong` | **chrome hover only** — topbar buttons, toolbar tiles |

`surface-strong` exists so a chrome hover reads as "quieter chrome" rather than as an accent
tint. Do NOT use `bg-primary/10` for a hover on a neutral control — that is the *selected* look.

`bg-surface-modal` / `bg-modal-muted` are the dialog-chrome equivalents; `modal-muted` also marks
a **filled** input so a populated form reads at a glance without adding border weight.

Elevation is carried by the shadow scale, not by stacking borders. A list-view card takes
`rounded-xl bg-surface shadow-md` with **no border** — a border plus a shadow reads as two
competing edges.

## Sidebar

The backend rail is **not** a step on the neutral ladder. It is painted in the CTA navy
(`--sidebar` is the same value as `--primary` in light mode), so anything rendered inside it
must come from the `sidebar-*` family — `text-foreground` on navy is unreadable and a
`surface-muted` hover is invisible.

| Part of the rail | Token |
|---|---|
| The column itself, and anything that must match it (sticky footer, scroll fade) | `bg-sidebar` |
| Row label at rest, brand mark, drawer ink | `text-sidebar-foreground` |
| Icons at rest, group overlines, quiet meta | `text-sidebar-muted-foreground` |
| Row hover fill / ink | `bg-sidebar-accent`, `text-sidebar-accent-foreground` |
| Active row pill / its ink | `bg-sidebar-primary`, `text-sidebar-primary-foreground` |
| Hairline, divider, child guide line | `border-sidebar-border` / `bg-sidebar-border` |
| Focus ring inside the rail | `ring-sidebar-ring` |

### The rail's one grid

The aside owns a 12px gutter (`px-3`). **Every** box inside spans that full inner width — no
negative margins, no extra right pad — and every box carrying an icon pads another 12px, so the
logo, the search glyph, the group overlines and every row icon start at the same x. Break this and
the rows silently end up a few pixels narrower than the search field above them.

| Element | Box |
|---|---|
| Brand row | `h-16` — the topbar's height, so the two share a centre line and the aside takes no top padding |
| Search field | `h-10`, `px-3` (size `default`; `lg` would move the glyph off the icon column) |
| Group heading | `h-8`, `px-3` |
| Nav row | `h-10`, `px-3`, `gap-3` |
| Subpage row | `h-9`, `pl-6 pr-3`, `gap-3` — one 12px step in, so a child icon lands where a parent label starts |
| Icon slot | `size-5` with `[&_svg]:size-4`, `shrink-0` |
| Label | `min-w-0 flex-1 truncate` — without `min-w-0` a flex item keeps its content width and `truncate` overflows the row instead of clipping |
| Column stack / between groups | `gap-3` |
| Between rows in a group | `gap-1` |
| Group divider | `mt-3 border-t`, inset to the row edges (the nav's own `gap-3` supplies the 12px below) |
| Sticky footer | `-mx-3 px-3 pt-3 border-t empty:hidden` — the ONE full-bleed rule, because it divides the column rather than the list |

`AppShell` (`packages/ui/src/backend/AppShell.tsx`) owns the rail. Its contract:

- It is a fixed, always-open 240px column — no collapse toggle, no persisted collapsed flag, no
  icon-only variant. Below `lg:` the same nav renders inside the mobile drawer, same tokens.
- Row chrome is declared once at the top of the file (`SIDEBAR_ITEM_BASE`, `SIDEBAR_ITEM_BOX`,
  `SIDEBAR_CHILD_BOX`, `SIDEBAR_GROUP_LABEL`, `sidebarItemStateClass`). Reuse those constants — a
  hand-rolled row makes the rail read as several lists stacked together.
- Group headings are `text-xs font-bold uppercase tracking-wide text-sidebar-muted-foreground`
  (the table-column-header treatment), NOT `text-overline` — see the Typography caveat.
- Settings / Profile **swap** their section nav into the same rail, with
  `appshell-section-back-to-main` as the way out. Do not reintroduce a second aside.
- Main-nav **subpages are always listed** — indented via `SIDEBAR_CHILD_BOX`, with no guide line
  beside them. A subpage that only unfolds once you are already on its parent cannot be found from
  the sidebar. (The Settings / Profile section nav still reveals children on their branch: its
  "User Entities" row expands to one child per user-defined entity.)
- Group expand/collapse goes through `SidebarCollapse`: a `grid-template-rows` `0fr → 1fr`
  transition plus an opacity fade, with the clip released once open so hover pills and focus rings
  are not cropped. `Chevron` turns a quarter turn. Keep both at `SIDEBAR_COLLAPSE_MS`, and keep the
  `motion-reduce:` escapes.
- The brand header is a link with **no hover fill** — it is an identity mark, not a nav row.
- Every interactive element in the rail takes `outline-none focus-visible:shadow-focus`.
- Group headings are real `Button`s with `type="button"`, `aria-expanded` and `aria-controls`
  pointing at the collapse region's id; the `<nav>` carries an `aria-label`.
- The scroll affordance anchors to the nav's own scroll frame, not to the aside — from the aside it
  paints over the sticky footer, whose top edge is not the aside's bottom edge. Its fade paints
  ONLY while there is more list below (held on at the bottom it washes out the last row and
  promises content that is not there), and the list reserves the overlay's band (`pb-10`) while it
  is on screen so the last row can always be scrolled clear of the chevron.
- A widget injected into a `backend:sidebar:*` spot MUST style itself from this family too.

## Corner Radius
- NEVER use arbitrary radius values (`rounded-[24px]`, `rounded-[32px]`, etc.)
- The scale is explicit in `globals.css` (`--radius-sm|md|lg|xl|2xl`), not derived from one base

| What am I rounding? | Token |
|---------------------|-------|
| Pill / badge / avatar / toggle | `rounded-full` |
| Modal / dialog panel | `rounded-2xl` (16px) |
| Card, table card, popover, menu, large panel | `rounded-xl` (12px) |
| Default control (button, input, select, nav item) | `rounded-lg` (8px) |
| Compact control (xs/sm button, menu item, chip) | `rounded-md` (6px) |
| Tiny inline element (checkbox, color dot) | `rounded-sm` (4px) |
| Remove radius (table cells, flush edges) | `rounded-none` |

Pill vs no-pill chips: the shipped primitives (`Badge`, `Tag` pill variant, `SegmentedControl`, `ActiveFilterChips`) are `rounded-full` by design. When a design explicitly calls for **no-pill chips** (dense filter rows, "Add filter" affordances, toolbar chips), do NOT force the pill primitives — build the chip on semantic tokens with `rounded-md` (or use `Tag shape="square"`). Never mix pill and no-pill chips in one row.

## Typography
- NEVER use arbitrary text sizes (`text-[10px]`, `text-[11px]`, `text-[13px]`, `text-[15px]`)
- NEVER use arbitrary tracking — use `tracking-widest` (0.1em) for uppercase labels
- USE Tailwind scale: `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px), `text-xl` (20px), `text-2xl` (24px)
- For 11px uppercase labels: use `text-overline` (custom token, 11px / 16px line-height)
- `text-overline` is a CUSTOM utility, so `tailwind-merge` classifies it as a text *colour*, not a
  size. Passing it through a component that runs `cn()` (any `Button`, `Input`, primitive with a
  `className` prop) alongside another `text-{color}` token silently DROPS it and the component's
  own `text-sm` wins. On such a call site use a real scale size (`text-xs`) instead
- Exception: `text-[9px]` for notification badge count and `Avatar size="sm"` initials (documented exceptions)
- Font families come from tokens: `--font-geist-sans` (default UI) and `--font-geist-mono` (`font-mono`) — never declare `font-family` inline

Weight is spent where things are **scanned** — table headers, tabs, nav items — not on the page
title, which already has size. A page title is therefore LIGHT and large, never bold.

| What text am I styling? | Classes |
|--------------------------|---------|
| Main page title (one per page) | `text-2xl sm:text-3xl font-normal` (use `PageHeader`) |
| Page description under the title | `text-sm font-medium text-muted-foreground` |
| Major section heading | `text-xl font-semibold` |
| Dialog title | `text-base sm:text-xl font-semibold tracking-tight` |
| Subsection / card title | `text-sm font-semibold` |
| Table column header | `text-xs font-bold uppercase tracking-wide text-muted-foreground` |
| Table cell | `text-sm font-medium` |
| Form label | `text-sm font-medium` (use `Label` component) |
| Default body text | `text-sm` |
| Emphasized body text | `text-base` |
| Secondary info, timestamps, hints | `text-xs text-muted-foreground` |
| Section label / category tag (uppercase) | `text-overline font-semibold uppercase tracking-widest` |
| Placeholder text | `font-normal text-input-placeholder` |
| Code / technical content | `text-sm font-mono` |

## Feedback
- USE `Alert` for inline messages — `Notice`/`ErrorNotice` are deprecated shells (migration complete; a guard test enforces the BC allowlist — do not add new imports)
- USE `flash()` for transient toast messages
- USE `useConfirmDialog()` for destructive action confirmation
- Every list/data page MUST handle empty state via `<EmptyState>` or `emptyState` prop on DataTable
- Every async page MUST show loading state via `<LoadingMessage>`, `<Spinner>`, or `<DataLoader>`
- Alert API: `status="information|success|warning|error|feature"` × `style="light|lighter|stroke|filled"` × `size="xs|sm|default"` — see `.ai/ui-components.md` § Alert for the full matrix
- The Alert `variant` prop (`destructive`/`info`/…) is **deprecated BC** — in-repo migration complete (2026-07); the lint rule `om-ds/no-legacy-alert-variant` guards against regressions, the shim in `primitives/alert.tsx` stays for third-party code

## Spacing
- NEVER use arbitrary spacing values (`p-[13px]`, `gap-[10px]`, `mt-[7px]`, etc.)
- USE Tailwind 4px grid scale: `1` (4px), `2` (8px), `3` (12px), `4` (16px), `6` (24px), `8` (32px), `12` (48px)
- AVOID half-steps (`0.5`, `1.5`, `2.5`) unless matching a specific visual rhythm

| What am I spacing? | Classes |
|---------------------|---------|
| Icon-to-text gap, chip internals, tight inline flex | `gap-1` (4px) or `gap-2` (8px) |
| Standard gap between inline/flex items | `gap-2` (8px) — **default** |
| Gap between distinct items in a list (cards, sections) | `gap-3` (12px) or `gap-4` (16px) |
| Padding inside an interactive control (button, input, select) | `px-3 py-2` |
| Padding inside a compact container (tag, inline panel, row) | `p-3` (12px) |
| Padding inside a card, section, or alert | `p-4` (16px) — **default for containers** |
| Padding inside a dialog, large card, or feature panel | `p-6` (24px) |
| Vertical stack of related items (form fields, list rows) | `space-y-2` (8px) |
| Vertical stack of distinct sections on a page | `space-y-4` (16px) or `space-y-6` (24px) |
| Page-level section separation | `space-y-8` (32px) or `py-8` |
| Margin below heading / above content | `mb-2` inline, `mb-4` sections |

## Opacity & Transparency
- NEVER invent new opacity values ad hoc — stick to the DS scale
- NEVER use arbitrary opacity (`opacity-[0.33]`, `bg-black/[0.22]`)
- USE the standard values: `5`, `10`, `20`, `30`, `50`, `70`, `80`, `90`, `95`, `100`

| What am I making transparent and why? | Value |
|---------------------------------------|-------|
| Disabled state on any control | `disabled:opacity-50` |
| Hover dim effect | `hover:opacity-80` |
| Restore full opacity | `opacity-100` |
| Hidden but layout-preserving | `opacity-0` |
| Modal / centered dialog backdrop | `bg-black/50` |
| Drawer / side panel backdrop | `bg-black/20` |
| Frosted surface (sticky header, floating card) | `bg-background/80` |
| Nearly-opaque surface | `bg-background/95` |
| Subtle tint (muted background, zebra row) | `bg-muted/30` |
| Medium tint (hover/selected list row) | `bg-muted/50` |
| Very subtle highlight (selected primary/destructive) | `bg-primary/5` or `bg-destructive/5` |
| Soft highlight (active primary/destructive) | `bg-primary/10` or `bg-destructive/10` |
| Hover on primary/destructive button | `bg-primary/90` or `bg-destructive/90` |
| Softened border | `border-border/70` |

## Z-Index (Layering)
- NEVER use arbitrary z-index values (`z-[1000]`, `z-[9999]`, `z-[60]`, etc.)
- NEVER use numeric `z-10`/`z-20`/`z-40`/`z-50` for elements that overlap **other components** — use semantic tokens
- Numeric `z-*` is OK **only** for local stacking inside a single component

| What is this element? | Token | Value |
|-----------------------|-------|-------|
| Normal page content | no class / `z-base` | 0 |
| Sticky header/footer | `z-sticky` | 10 |
| Inline dropdown rendered in-place (no portal) | `z-dropdown` | 20 |
| Backdrop behind modal/drawer | `z-overlay` | 30 |
| Modal, dialog, drawer, side panel | `z-modal` | 40 |
| Portaled overlay content (popover, select menu, combobox suggestions) | `z-popover` | 45 |
| Toast / flash message | `z-toast` | 50 |
| Modal stacked above another modal/drawer (confirm-on-drawer, dialog-in-dialog) | `z-modal-elevated` | 55 |
| Tooltip | `z-tooltip` | 60 |
| Global notice bar (cookie banner, system-wide) | `z-banner` | 70 |
| Always-on-top (dev tools, AI chat, command palette) | `z-top` | 100 |

`z-popover` (45) sits above `z-modal` (40) so dropdowns/selects/popovers opened from inside a modal, drawer, or filter side panel render above the panel rather than behind it. Tooltips stay highest among floating UI (60 > 45) because a tooltip on a button inside a popover must remain visible. Tokens defined in `globals.css` as `--z-index-*`. Do NOT add new numeric values — add a token to the scale.

## Shadows
- NEVER use arbitrary shadow values (`shadow-[...]`)
- NEVER use colored shadows (e.g. `shadow-violet-500/25`) except for brand-specific decorative elements (AI dot)
- NEVER build glow effects — no colored box-shadow halos and no radial-gradient glow backgrounds; for emphasis use solid color, border, scale, or opacity

| What elevation does this element need? | Token |
|----------------------------------------|-------|
| Flat element with subtle depth (input, checkbox, button) | `shadow-xs` |
| Card, panel, or section on a page | `shadow-sm` |
| Hover state or slightly elevated card | `shadow-md` |
| Dialog, overlay, or popover | `shadow-lg` |
| Floating panel (dockable chat, side drawer) | `shadow-xl` |
| Top-level modal or command palette | `shadow-2xl` |
| Focus halo on a custom focusable element | `shadow-focus` (composite two-ring token — see Focus States) |
| Remove shadow | `shadow-none` |

`--shadow-switch-thumb` exists for the Switch primitive's thumb only — component-internal, do not reuse.

## Motion & Transitions
- NEVER use arbitrary duration values (`duration-[250ms]`, etc.)
- NEVER use `transition` without specifying the property — prefer `transition-colors`, `transition-opacity`, `transition-transform` over `transition-all`
- USE `transition-all` only when multiple unrelated properties change simultaneously

| What is animating? | Classes |
|--------------------|---------|
| Hover color/background change | `transition-colors duration-150` |
| Fade in/out | `transition-opacity duration-150` |
| Rotation or scale (chevron, icon) | `transition-transform duration-150` |
| Dropdown/popover opening | `duration-200 ease-out` |
| Dialog/modal opening | `duration-300 ease-out` |
| Dialog/modal closing | `duration-200 ease-in` |
| Loading spinner | `animate-spin` |
| Loading placeholder | `animate-pulse` |
| Panel sliding in | `animate-slide-in` (0.3s ease-out) |
| Accordion/collapsible | `animate-accordion-down` / `animate-accordion-up` |

Duration: **150ms** for micro-interactions, **200ms** for standard transitions, **300ms** for large layout changes.

## Content & Copy
- NEVER use "·" (middot) as a separator in UI text — use an em dash "—" or restructure the sentence
- NEVER use raw amber/yellow text or fills in chips and badges (weak contrast) — warning chips go through `status-warning-*` tokens (the `text` role is darkened for contrast); for non-warning emphasis use `foreground`, `emerald`/success, or `destructive`

## Status Display
- USE `StatusBadge` for entity status display — NEVER hardcode colors on Badge
- Define a `StatusMap` per entity type in your module:
```typescript
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

const dealStatusMap: StatusMap<'open' | 'won' | 'lost'> = {
  open: 'info',
  won: 'success',
  lost: 'error',
}
```

## Forms
- USE `FormField` wrapper for standalone forms (portal, auth, custom pages)
- CrudForm handles field layout internally — do NOT wrap CrudForm fields in FormField
- Every input MUST have a visible label (never placeholder-only)
- Error messages use `text-status-error-text` (FormField handles this automatically)

## Icons
- USE `lucide-react` for ALL UI icons — NEVER inline `<svg>` elements
- Icon sizes: `size-3` (12px), `size-4` (16px, default), `size-5` (20px), `size-6` (24px)
- Stroke width: 2 (lucide default) — do NOT override per-instance
- Icon-only buttons MUST have `aria-label`
- Brand/logo icons (Stripe, Google, etc.) = standalone SVG files in `public/brands/` or integration-provided assets

## Sections
- USE `SectionHeader` for detail page section headers (title + count + action)
- USE `CollapsibleSection` when section content should be collapsible

## Components — quick reference
| I need to… | Use this |
|---|---|
| Show an error/success/warning message inline | `<Alert status="error\|success\|warning\|information\|feature" style="light\|lighter\|stroke\|filled">` |
| Show a toast notification | `flash('message', 'success\|error\|warning\|info')` |
| Confirm a destructive action | `useConfirmDialog()` |
| Display entity status (active, draft, etc.) | `<StatusBadge variant={statusMap[status]} dot>` |
| Display a user-applied entity tag | `<Tag variant={tagMap[tag.type]} dot>` |
| Display a user / entity avatar with initials | `<Avatar label="Jan Kowalski" size="md">` |
| Display multiple avatars overlapping | `<AvatarStack max={4}><Avatar .../></AvatarStack>` |
| Show a keyboard shortcut hint | `<KbdShortcut keys={['⌘', 'Enter']}>` |
| Wrap a form field with label + error | `<FormField label="..." error={...}>` |
| Build a section header with count + action | `<SectionHeader title="..." count={n} action={...}>` |
| Build a collapsible section | `<CollapsibleSection title="...">content</CollapsibleSection>` |
| Filter tabs with unread/result counts | `<Tabs variant="underline">` + `<TabsTrigger count={n}>` (see NotificationPanel) |
| Side sheet / secondary form | `<Drawer>` + `DrawerContent/Header/Body/Footer` — never a hand-rolled fixed panel |
| Single-month date picker | `DatePicker` — header click opens the built-in month/year grid; do not build custom month navigation |

## Reference Implementation
When building a new module UI, use the **customers module** as reference:
- List page: `packages/core/src/modules/customers/backend/customers/people/page.tsx`
- Detail page: `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx`
- Create page: `packages/core/src/modules/customers/backend/customers/people/create/page.tsx`
- Status mapping: `packages/core/src/modules/customers/components/formConfig.tsx`

## Breakpoints (Responsive Design)
- NEVER use arbitrary media queries (`[min-width:850px]:...`) — stick to the Tailwind scale
- NEVER use `max-*` (desktop-first) — our approach is **mobile-first**
- USE the Tailwind scale: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px), `2xl` (1536px)

| At what screen size should this layout change? | Breakpoint |
|------------------------------------------------|------------|
| Stacked buttons/labels → inline row | `sm:flex-row sm:items-center` |
| Form field full-width → half-width side-by-side | `md:grid-cols-2` |
| Dashboard 1-col → 2-col layout | `md:grid-cols-2` (not `sm:`) |
| 2-col → 3-col dashboard | `lg:grid-cols-3` |
| Sidebar drawer → always-visible rail | `lg:grid-cols-[240px_1fr]` |
| 4th column for dense dashboards | `xl:grid-cols-4` |
| Constrain max content width | `max-w-screen-2xl mx-auto` |
| Show/hide based on device | `hidden lg:block` or `lg:hidden` |

`md:` is the first breakpoint for layout changes. The backend sidebar is a fixed 240px rail at `lg:` (1024px) and above; below that it is the mobile drawer. It never collapses to an icon rail.

## Borders (Widths & Styles)
- NEVER use arbitrary border widths (`border-[3px]`, `border-[1.5px]`)
- USE the Tailwind scale: `border` (1px), `border-2` (2px), `border-4` (4px), `border-0` (reset)
- Always pair border width with a semantic color token (`border-border`, `border-input`, `border-status-*-border`, `border-destructive`)
- NEVER use hardcoded Tailwind shades (`border-gray-300`, `border-slate-200`, `border-blue-500`)

| What is this border for? | Classes |
|--------------------------|---------|
| Standard container edge (card, input, dialog, divider) | `border border-border` — **default** |
| Input/form control edge | `border border-input` |
| Active tab indicator (bottom underline) | `border-b-2 border-primary` |
| Selected / active state emphasis | `border-2 border-primary` or `border-2 border-ring` |
| Left-accent indicator (notices, status highlights) | `border-l-4 border-status-{status}-border` |
| Empty state / placeholder / drop zone | `border border-dashed border-border` |
| Horizontal divider between sections | `border-t border-border` (use `<Separator>` when possible) |
| Error state on input | `aria-invalid:border-destructive` |
| Remove border | `border-0` |

## Focus States (Accessibility)
- NEVER use `focus:` for rings/outline — use `focus-visible:` (rings appear on keyboard nav only)
- NEVER use hardcoded focus colors (`focus-visible:ring-blue-500`, etc.)
- USE `aria-invalid:` for error state rings

Standard focus recipe (the Figma two-ring halo — white inner ring + soft outer ring via `--focus-ring-inner`/`--focus-ring-outer`):
```
focus-visible:outline-none focus-visible:shadow-focus
```

| What focus treatment? | Classes |
|-----------------------|---------|
| Button / Input / Select / standard form control | Already handled by the primitive |
| Custom focusable element (div with tabIndex, link, interactive row) | `focus-visible:outline-none focus-visible:shadow-focus` |
| Legacy ring recipe (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`) | Still present in a few primitives — do not copy into new code; migrate to `shadow-focus` when touching the file (Boy Scout Rule) |
| Tight layout where the halo overflows | `focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0` |
| Error state needing red focus ring | Add `aria-invalid:ring-destructive aria-invalid:ring-2` |
| Menu item / dropdown item | `focus:bg-accent focus:text-accent-foreground` (without `-visible`) |
| Disable focus ring | `focus-visible:ring-0` (rare — accessibility concern) |

Ring on `focus-visible:` for keyboard accessibility; bg/text on `focus:` for visual affordance.

## Dark Mode
- NEVER add `dark:` overrides on semantic tokens (`text-foreground`, `bg-muted`, `bg-card`, etc.) — they already flip
- NEVER add `dark:` overrides on status tokens (`bg-status-*`, etc.) — they have dedicated dark values
- NEVER pair hardcoded Tailwind status colors with `dark:` fallbacks (e.g. `bg-amber-50 dark:bg-amber-950/40`)

Legitimate `dark:` use cases:
- `dark:prose-invert` — Tailwind Typography plugin (content module)
- shadcn primitives that touch `--input` directly — part of component internals
- Brand/decorative colors that genuinely need different dark values (violet AI dot, rare cases)

If you find yourself writing `dark:{something}`, first check whether a semantic token already handles that context.

## Boy Scout Rule
When modifying a file that contains hardcoded status colors (`text-red-*`, `bg-green-*`, etc.), arbitrary text sizes (`text-[11px]`), or `dark:` overrides on status colors, you MUST migrate at minimum the lines you touched to semantic tokens.

