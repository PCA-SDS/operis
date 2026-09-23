# Backend Sidebar — Collapsible Rail

- **Date:** 2026-09-23
- **Status:** Implemented
- **Scope:** `packages/ui/src/backend/AppShell.tsx`, `packages/ui/src/backend/sidebar/{chrome,SidebarNavLink}.tsx`,
  `apps/mercato/src/app/(backend)/backend/layout.tsx`, `apps/mercato/src/i18n/*.json`
- **Supersedes in part:** [`2026-08-24-sidebar-navy-static-rail.md`](2026-08-24-sidebar-navy-static-rail.md)
  (its "fixed, always-open column" decision)

## TLDR

The desktop rail is collapsed by default and opens over the page on hover or keyboard focus,
without moving the content. Pinning it (topbar toggle, `Ctrl/⌘+B`, or the pin in the open panel)
gives it its own column again. The desktop rail collapses to a 69px icon column and expands back with a 200ms animation in
which no label reflows and no top-level icon moves. It is one set of rows, clipped and faded, not
the icon-only mirror that got collapse removed on 2026-08-24.

## Overview and problem

The static rail spec removed collapse because the old implementation kept every row twice (a
labelled row and an icon row) and the two drifted. Users still need the content width back on
dense pages, so collapse returns, but the reason it was removed must not come back with it.

## Proposed solution

- **Geometry.** Collapsed width = 12 gutter + 12 row pad + 20 icon + 12 + 12 + 1px rule = 69px, so
  every top-level icon keeps x = 24 and sits centred in a 44px pill.
- **One animated value.** The grid track reads `--sidebar-rail-width` and transitions
  `grid-template-columns`; the aside fills its track, so rail and content column cannot desync.
  `--sidebar-width` stays the expanded width (the customization preview sizes itself from it).
- **No reflow.** A row is a `w-full overflow-hidden` shell around content held at
  `--sidebar-content-width`. The shell narrows; the text inside never re-truncates. Labels,
  headings, injected spots and the footer fade out on the same curve and become `inert`.
- **Group headings.** Every heading carries an icon on the row icon column, declared by group id
  in `navGroupIconRows` (`auth/lib/backendChrome.tsx`, beside `defaultGroupOrder` and
  `settingsSectionOrder`) and shipped as `iconName`/`iconMarkup` on nav groups and settings/profile
  sections. Undeclared groups (injected, app modules) get `SidebarGroupDefaultIcon`. Collapsed, the
  icon stays as the group's marker, the label and chevron fade, and the heading leaves the tab
  order and only names the group in a tooltip (every group is open while collapsed, so it has
  nothing to toggle).
- **Depth.** Child rows animate their inset back to the first step so their icons join the
  column. Every group is shown open while collapsed so no icon is unreachable.
- **Default and peek.** With no `om_sidebar_collapsed` preference the rail starts collapsed. A
  collapsed rail "peeks": after 120ms of mouse hover (so a pointer passing through does not flash
  it), or at once on keyboard focus (`:focus-visible`), the aside widens to 272px while its grid
  track stays at 69px, so it overlays the page on `z-top` with `shadow-lg` instead of pushing it.
  It closes 180ms after the pointer leaves (not while keyboard focus is inside) or on Escape, and
  keeps `z-top` until it has finished narrowing. Touch never peeks. Collapsed and pinned layers
  are unchanged, so dialogs still cover the rail.
- **Pin.** While peeking the panel covers the topbar toggle, so its brand row shows a "Keep sidebar
  open" pin. Pinning moves keyboard focus to the topbar toggle, which then collapses it.
- **Search.** Collapsed, the field fades out and leaves its magnifier glyph on the icon column;
  peeking reveals the field.
- **Brand.** The built-in wordmark is clipped to its leading mark (same glyph, no swap); custom
  logos fade.
- **Controls.** Topbar `PanelLeft` toggle (`aria-expanded`, `aria-controls`, tooltip) and
  `Ctrl/⌘+B`, ignored while typing. Row tooltips were dropped: hover and focus now open the full
  panel before a tooltip could appear.
- **Persistence.** `om_sidebar_collapsed` cookie (the name upstream used), read by the backend
  layout and passed as `sidebarCollapsedDefault` (collapsed unless the cookie is `0`), so the first
  paint is already the right width.
- **Reduced motion.** Every transition carries `motion-reduce:transition-none`.

## Architecture, data models, API contracts

UI plus the chrome payload. No entities, migrations, routes, events or ACL features.
`BackendChromeNavGroup` and `BackendChromeSectionGroup` gain optional `iconName`/`iconMarkup`
(additive; the `/api/auth/admin/nav` response schema lists them). New optional `AppShell` prop
`sidebarCollapsedDefault`; new cookie `om_sidebar_collapsed` (`0`/`1`, one year, `SameSite=Lax`).
New i18n keys `appShell.collapseSidebar`, `appShell.expandSidebar`, `appShell.pinSidebar`.

## Risks and impact

- The mobile drawer and the customization preview do not publish `--sidebar-content-width`, so
  their rows fall back to `w-full` and render as before.
- `SidebarCollapse`'s inner grid item needed `min-w-0`; without it the implicit auto column held
  rows at their expanded width.

## Tests

Playwright: the shared `login` helper pins the rail open (`om_sidebar_collapsed=0`) because specs
click nav rows by label; `TC-AUTH-SIDEBAR-PEEK-001` covers the collapsed default, the hover
overlay (content column unmoved, `z-top`) and pinning. `TC-AUTH-SIDEBAR-WIDTH-001` selectors now
target the icon and label inside the row's content wrapper.

`packages/ui/src/backend/__tests__/AppShell.test.tsx` → "collapsible desktop rail": toggle and
cookie, server-read initial state, rows keep their accessible names, hidden controls leave the tab
order, headings stay as icon markers and do not toggle, groups open while collapsed, `Ctrl/⌘+B`
(not while typing), search button expands and focuses; "group heading icons": declared icon and
fallback. `packages/core/src/modules/auth/lib/__tests__/backendChrome.group-icons.test.ts`: icons
on known groups and settings sections, none on undeclared ids.

## Changelog

- 2026-09-23: Implemented.
- 2026-09-23: Group headings carry icons, so the collapsed rail has no blank heading rows.
- 2026-09-23: Collapsed by default; hover or keyboard focus opens it over the page; in-panel pin.
