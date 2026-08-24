# Backend Sidebar — Navy Static Rail

- **Date:** 2026-08-24
- **Status:** Implemented
- **Scope:** `packages/ui/src/backend/AppShell.tsx`, `apps/mercato/src/app/globals.css`,
  backend nav labels across every module
- **Supersedes:** [`implemented/2026-05-04-settings-sidebar-two-level.md`](implemented/2026-05-04-settings-sidebar-two-level.md)
  (its two-column arrangement depended on the icon rail this spec removes)

## Problem

The backend sidebar had accumulated four separate problems:

1. It could collapse to an 80px icon rail. Every nav row therefore existed twice — once as a
   labelled row and once as an icon with a `title` tooltip — and the two treatments drifted. The
   collapse state was persisted in both `localStorage` and a cookie, read server-side to avoid
   hydration flicker, and force-toggled by a route effect when entering Settings.
2. Settings and Profile opened a **second** 240px column beside the collapsed rail, which only
   fitted because the main rail had shrunk. That second column needed its own "panel" chrome
   (`bg-surface-muted` inset card, a different row radius, a different hover step, its own bottom
   fade) — a whole parallel row treatment maintained for one surface.
3. The rail was white, indistinguishable from the page ground, so the product's one saturated
   colour appeared only on buttons.
4. Nav labels were sentence case (`Customer related tasks`, `External systems`) while the rest of
   the chrome was title case.

A fifth problem was latent: `SIDEBAR_GROUP_LABEL` declared `text-overline` (11px), but the string
is passed to `Button`, whose `cn()` runs `tailwind-merge`. `text-overline` is a custom utility, so
tailwind-merge classifies it as a text *colour*; the neighbouring `text-disabled-foreground`
displaced it and the button's own `text-sm` survived. Group headings had been rendering at 14px.

## Decisions

| Decision | Rationale |
|---|---|
| The rail is a fixed, always-open 240px column | A nav that can hide itself has to keep an icon-only mirror of every row, and the two drift. Removing collapse deletes the mirror, the persistence, the cookie and the route effect. |
| Settings / Profile **swap** into the same rail | The two-column layout only worked while the main rail could shrink. One column also retires the panel variant and its parallel row chrome. |
| The rail is painted in the CTA navy (`--sidebar` = `--primary`) | Anchors the product's one saturated colour at the left edge and separates chrome from content without a border. |
| Dark mode uses a deep navy (`#1B2A42`), not the dark CTA | The dark CTA is a pale navy (`#8FAEDA`); a full-height column in it would be the brightest object on screen. |
| Group headings become `text-xs font-bold uppercase tracking-wide` | One size smaller than what was actually rendering, heavier, and on a real Tailwind size so the tailwind-merge collapse cannot recur. This is the table-column-header treatment already in the DS. |
| Main-nav subpages are always listed, with no guide line | A subpage that unfolds only once the route is already inside its parent cannot be discovered from the sidebar — you had to know Deals had a Pipeline and a Map before it would say so. With the rows permanently present, a hairline behind them adds a second standing vertical line to a column that already has one at its edge; the child indent carries the depth on its own. The Settings / Profile section nav keeps reveal-on-branch, because its "User Entities" row expands to one child per user-defined entity. |
| Nav labels and page titles go Title Case | The same i18n keys drive the sidebar row, the page `<h1>` and the breadcrumb, so casing them separately would split one string into three. |

## Token model

The `sidebar-*` family stops being a near-copy of the neutral ladder and becomes the rail's own
palette. `--sidebar-muted-foreground` is new; the rest are re-seated.

| Token | Light | Dark | Job |
|---|---|---|---|
| `--sidebar` | `#43608E` | `#1B2A42` | the column, its sticky footer, its scroll fade |
| `--sidebar-foreground` | `#EDF2FA` | `#DFE8F4` | row label at rest, brand mark |
| `--sidebar-muted-foreground` | `#CAD9EF` | `#9DB3D3` | icons at rest, group overlines |
| `--sidebar-primary` / `-foreground` | `#EAF1FA` / `#33507B` | `#31496F` / `#CFE0F8` | active row pill and its ink |
| `--sidebar-accent` / `-foreground` | `#55719C` / `#FFFFFF` | `#26385A` / `#EAF1FB` | hover fill and its ink |
| `--sidebar-border` | `#5A749D` | `#32456A` | hairline, dividers, child guide line |
| `--sidebar-ring` | `#B6C7DF` | `#5D82B4` | focus ring inside the rail |

The active row is a pale pill whose ink is the rail's own colour — the row reads as cut out of the
rail. Idle rows keep full ink with a quieter icon: a sidebar is a reading surface, and dimming
every label to make one stand out costs more than it buys.

## Layout audit

A full pass over the rail's boxes turned up eight defects, all now fixed. They are listed because
each is the kind that typechecks, renders, and is only visible once you measure it.

| Defect | Effect | Fix |
|---|---|---|
| The nav scroll area carried `-ml-3 pl-3 pr-1` | Rows rendered **4px narrower** than the search field above them. The negative margin was a no-op (the matching `pl-3` cancelled it); only the stray right pad survived, and `scrollbar-hide` means no scrollbar needed it. | Scroll area spans the column exactly |
| Group dividers used `my-2` inside a `gap-2` nav | 8px above a divider, 16px below | `mt-3` inside a `gap-3` nav — 12px either side |
| No gap between a group heading and its first row | The heading sat flush on the row | `pt-1` **inside** the collapse's clip, so it animates away instead of leaving a 4px ghost under a closed group |
| Row labels had `truncate` but no `min-w-0` | A flex item keeps `min-width: auto`, so long titles ("Customer Related Tasks") overflowed the row rather than clipping | `min-w-0 flex-1 truncate` on every label, and `min-w-0 truncate` on group headings so the chevron cannot be pushed out |
| Brand row was `h-14` on top of the aside's `pt-4` | The logo sat 12px below the topbar's centre line and the search started 20px below the first page content | `h-16` (the topbar's height) and no top padding on the aside |
| The sticky footer always painted its rule | A stock install with no sidebar widgets carried a stray hairline and a band of dead space at the foot of the rail | `empty:hidden` — all three spots return `null` when unfilled |
| The scroll affordance was anchored to the aside | Its gradient and chevron painted over the sticky footer's rule and widgets | Anchored to the nav's scroll frame |
| The scroll fade painted at every scroll position | At the bottom of the list it washed out the last row and claimed there was more below; the chevron sat on top of that row with no way to scroll it clear | Fade gated on `state === 'down'`; the list reserves the overlay's 40px band (`pb-10`) while the affordance is on screen |
| `--topbar-height: 61px` | The topbar is `h-16` plus a 1px rule, so every `Sheet` drawer slid 4px up under it | `65px` |

Alongside those: row gaps moved off the `gap-2.5` half-step to `gap-3`; subpage indent moved from
`pl-5` (an 8px nudge) to `pl-6`, a real 12px step that lands a child icon where a parent label
starts; the search field took `h-10` so it shares the rows' rhythm, and dropped its resting border
(a visible hairline plus a fill is two edges on a control sitting among rows with neither);
`aria-disabled` is emitted only when true; group headings gained `type="button"` and
`aria-controls`; the `<nav>` gained an `aria-label` (`appShell.mainNavAria`, five locales); and the
bouncing scroll chevron gained `motion-reduce:animate-none`.

## Parent row active state

`isParentActive` used to infer "the route is inside this branch" from the children being visible.
With children always visible that conflation makes every parent with subpages read as active, so
the branch test is now asked directly (`isOnParentBranch`). A parent lights up when the route is
exactly its href, or is inside its branch with no child matching — the previous behaviour, minus
the `navQueryActive` guard, so the active row now keeps its highlight while the nav search filters.

## Collapse animation

`SidebarCollapse` keeps the `grid-template-rows: 0fr → 1fr` trick (the only CSS transition that
resolves to content height) and adds the two things that separate a smooth reveal from a
rubber-band one, both taken from PCA ERP's `Collapse` (`shared/common-component/inspector.tsx`):

- the rows **fade with the height**, so the group grows into view instead of being unmasked at full
  opacity inside a 0px box;
- the clip is **released** once the group is open — `overflow-hidden` is only needed while the box
  is shorter than its content, and leaving it on crops a focus ring or a hover pill at the group's
  edge.

`Chevron` turns a quarter turn (down when open, right when closed) rather than a half turn: a
quarter turn reads as "this folds away", a half turn reads as "this scrolls the other way". Height,
fade and chevron all run at `SIDEBAR_COLLAPSE_MS` (200ms, `ease-out`) with `motion-reduce:` escapes.

## Removed

- `AppShellProps.sidebarCollapsedDefault`, the `om:sidebarCollapsed` localStorage flag, the
  `om_sidebar_collapsed` cookie and its server-side read in `apps/mercato/src/app/(backend)/backend/layout.tsx`
- the collapse toggle button and the `appShell.toggleSidebar` i18n key (all five locales)
- `SIDEBAR_ITEM_BOX_COMPACT`, `SIDEBAR_CHILD_BOX_COMPACT`, and every `compact` branch
- `SIDEBAR_PANEL`, `SIDEBAR_PANEL_ITEM_BASE`, `SIDEBAR_PANEL_ITEM_BOX`,
  `SIDEBAR_PANEL_GROUP_LABEL`, `sidebarPanelItemStateClass`, `renderSectionAside`, and the
  second `<aside>`

`data-testid="appshell-section-sidebar"` and `data-testid="appshell-section-back-to-main"` are
retained on the section nav inside the single rail, so existing queries still resolve.

## Label casing

90 English i18n values reached by a `pageTitleKey` / `pageGroupKey` / breadcrumb `labelKey`, plus
the literal `pageTitle` / `pageGroup` / breadcrumb `label` fallbacks in 114 `page.meta.ts` files and
43 inline `t(key, fallback)` call sites, were re-cased. Small words stay lowercase mid-phrase;
tokens already carrying an inner capital (`API`, `MCP`, `SKU`, `E-H`) are untouched. Non-English
dictionaries keep their own conventions.

## Coverage

- `packages/ui/src/backend/__tests__/AppShell.test.tsx` — single-rail swap, one desktop `<aside>`,
  section nav owns the nav search, identical row chrome for settings and profile, active row uses
  `bg-sidebar-primary`; subpages listed off-branch, indented with no guide line, and the parent row
  staying inactive off-branch and when a child is active; plus a **layout contract** block pinning
  the brand/topbar height match, the scroll area carrying no width-stealing classes, labels
  shrinking, `empty:hidden` on the footer, heading→region wiring, the named nav landmark, and
  `--topbar-height`; plus a **scroll affordance** block covering the fade gating, the reserved
  band, and neither appearing when the nav fits
- `packages/core/src/modules/core/__integration__/admin/TC-ADMIN-009.spec.ts`,
  `packages/core/src/modules/wms/__integration__/TC-WMS-DASHBOARD-UI-001.spec.ts`,
  `packages/core/src/modules/catalog/backend/catalog/products/__tests__/ProductsDataTable.test.tsx`
  — re-cased label assertions

## Docs updated

- `.ai/ds-rules.md` — new **Sidebar** section (token table + `AppShell` contract), sidebar removed
  from the `bg-surface` rows, the responsive rows no longer describe an icon-rail collapse, and the
  Typography section records the `text-overline` + `cn()` trap
