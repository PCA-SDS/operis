# Backend Navigation — Module Switcher and Module Sidebars

- **Date:** 2026-09-25
- **Status:** Implemented
- **Scope:** `packages/ui/src/backend/AppShell.tsx`, `packages/ui/src/backend/module-nav/*`,
  `packages/ui/src/backend/sidebar/chrome.tsx`, `packages/shared/src/modules/{registry,pageRouteMetadata}.ts`,
  `packages/cli/src/lib/generators/module-registry.ts`, `apps/mercato/src/app/(backend)/backend/{layout,[...slug]/page}.tsx`,
  `apps/mercato/src/app/globals.css`, `packages/core/src/modules/tasks/components/{TasksSidebar,TasksShell}.tsx`,
  tasks / seat planner / design system `page.meta.ts`, `packages/core/src/modules/staff/widgets/*`, `apps/mercato/src/i18n/*.json`,
  `packages/core/src/modules/auth/lib/backendChrome.tsx`
- **Supersedes:** [`2026-09-23-collapsible-sidebar-rail.md`](2026-09-23-collapsible-sidebar-rail.md) and the rail
  sections of [`2026-08-24-sidebar-navy-static-rail.md`](2026-08-24-sidebar-navy-static-rail.md)

## TLDR

There is no global sidebar. A **module switcher** in the topbar lists the modules the viewer can reach, with
their names and icons. Opening one lands on its first page, and every page of that module sits beside the
module's **own sidebar**, built from the Task Manager's sidebar design. Settings and Profile use the same
sidebar for their sections.

## Problem

The global rail listed every page of every module at once (~20 groups). Users asked for navigation that
works per module: pick a module, then move around inside it, the way the Task Manager already works.

## Design

- **Module = nav group.** The unit the switcher lists is the existing nav group from `/api/auth/admin/nav`
  (RBAC-, entitlement- and customization-filtered on the server). A group appears only when it has at least
  one reachable main-context page. No new endpoint and no second source of truth.
- **One model, published once.** `AppShell` merges injected menu items, filters main-context pages and
  resolves the active group (`module-nav/model.tsx`), then publishes it through `BackendNavigationProvider`.
  The switcher (topbar) and the module frame (page) both read that context.
- **Active module** = the group holding the longest nav href on the route's branch (segment-aware), so a
  detail page like `/…/people/123` belongs to the module that lists `/…/people`. A route under no nav link
  (a hidden detail route such as `/…/people-v2/[id]`) falls back to its declared `pageGroupKey`, and its
  last breadcrumb `href` marks the active link. The catch-all page passes both from the route manifest.
- **Module frame.** The backend catch-all page wraps every page in `BackendModuleFrame`, which lays the page
  out beside the module sidebar (`ModuleLayout`, the grid the Task Manager already used). The wrapper keeps
  one DOM shape in every state, so the page never remounts when the sidebar appears.
- **Opt-out per page.** New page metadata field `moduleSidebar?: boolean` (default on). It is read on the
  server for each navigation from the route manifest, so a page that draws its own module navigation never
  flashes a second one. Set to `false` on: every Task Manager page (it keeps `TasksSidebar` with counts,
  projects and Add Task), the chat inbox, conversation and "message this person" pages (the chat shell has
  its own conversation rail and sizes its panels against the full width), the seat planner (full-width
  editor), and the design system gallery (own section nav). Chat search and My workspace keep the Chat
  sidebar, which is their way back to Conversations.
- **Shared parts.** `module-nav/ModuleSidebar.tsx` holds the sidebar family extracted from `TasksSidebar`:
  `ModuleLayout`, `ModuleSidebar`, `ModuleSidebarLink`, `ModuleSidebarAction`, `ModuleSidebarDivider`,
  `ModuleSidebarSectionLabel`, `ModuleSidebarSkeleton`. `TasksSidebar` is rebuilt from them, so the generic
  sidebar and the Task Manager's cannot drift apart.
- **Loading.** While the nav payload loads, the frame holds the column with `ModuleSidebarSkeleton` (never
  stale SSR groups, regression #1828), so the page does not jump sideways when it lands.
- **Sticky.** On document-scrolling pages the sidebar sticks under the topbar (`--module-sidebar-top`); on
  `<Page fill>` pages `main` is the scroller, so `globals.css` resets the offset and caps the height.
- **Phone.** The sidebar becomes a horizontal strip above the page (Task Manager behaviour). The switcher
  trigger stays in the topbar at every width; the mobile drawer is gone.
- **Switcher UX.** `Popover` + `SearchInput`. The search matches module names and page titles and also lists
  matching pages (replacing the rail's nav search). Enter opens the first module; arrow keys move between
  tiles; Escape closes; the current module is `aria-current` and named on the trigger.
- **Reorder.** Viewers holding `auth.sidebar.manage` can drag module tiles to rearrange them
  (`SortableModuleGrid`, dnd-kit): mouse after 6px of travel, touch after a 250ms press, keyboard with Space
  then arrows (one place in reading order, or one row, by index rather than measured edges); Escape
  cancels a drag without closing the switcher. A click still opens the module, and tiles
  keep link semantics for screen readers. Reordering is off while searching. The order is the existing
  sidebar preference's `groupOrder` (`useModuleOrder`), saved through `PUT /api/auth/sidebar/preferences`
  with the rest of the record unchanged and role-hidden pages carried over on a first save. The new order
  shows at once; a failed save reverts with a flash, and an edit conflict reloads and retries once.
  "Reset order" removes only the module positions. No new endpoint.
- **Preference key.** The nav payload reads the personal preference under the key the preferences API
  saves it with (`auth.tenantId` / `auth.orgId`), not the organization being viewed. Reading the viewed one
  showed multi-organization users the default order outside their home organization.
- **Brand.** The logo moved from the rail to the topbar (`ShellBrandLogo tone="surface"`), shown from `xl`.
- **Topbar fit.** Below `xl` the trigger is a 36px icon button (its accessible name carries the current
  module); from `xl` it also shows the module name. The left topbar column keeps `min-w-9`, so the switcher
  stays reachable even where the centre search and action cluster overflow a 768px topbar (a pre-existing
  overflow this change does not address).
- **Injection spots.** `backend:sidebar:top|nav|nav:footer|footer` and `global:sidebar:status-badges` keep
  their ids and render inside the module sidebar (desktop). The staff running-timer indicator moved to
  `backend:topbar:actions` so it stays visible on every page.

## Removed

The collapsible rail, hover peek, pin, `Ctrl/⌘+B`, the `om_sidebar_collapsed` cookie, the mobile drawer, the
rail nav search and scroll affordance, `SidebarNavLink`, and the rail-only chrome constants.
`AppShellProps.sidebarCollapsedDefault` and `mobileSidebarSlot` are gone (internal props, no callers).

## Security

Navigation only. Every destination still enforces `requireAuth`, `requireFeatures` and module entitlement on
the server (catch-all page and API dispatcher). The switcher and sidebars render only what the server's
filtered nav payload contains; nothing client-side decides access.

## Integration coverage

- `auth/__integration__/TC-AUTH-MODULE-NAV-001.spec.ts` — dashboard has no sidebar; switcher opens Customers;
  module sidebar labelled and active; in-module navigation; search + Enter; Task Manager renders exactly one
  module nav; settings route shows the settings sections; phone width opens modules with no sideways scroll.
- `auth/__integration__/TC-AUTH-MODULE-NAV-002.spec.ts` — mouse drag reorders without opening a module and
  survives a reload; Reset removes only module positions; keyboard move and Escape-cancel; no reorder
  controls without `auth.sidebar.manage`.
- `auth/__integration__/TC-AUTH-SIDEBAR-GROUP-001.spec.ts` — hiding a group in sidebar customization removes
  it from the switcher.
- `directory/__integration__/TC-DIR-015-sidebar-logo-aspect-ratio.spec.ts` — brand logo in the topbar.
- `customers/__integration__/TC-CAL-002.spec.ts` — Calendar listed in the Customers module sidebar.
- `auth/__integration__/TC-AUTH-CSP-001.spec.ts` — waits for the shell's `backend-chrome-ready` marker instead of
  the removed rail landmark as its proof that client scripts ran.
- `chat/__integration__/TC-CHAT-008-context-panel.spec.ts` — the rail stand-down case moved from a 1280 to a
  1024 viewport: with no app rail pinned beside the chat, 1280 now fits rail, transcript and panel.
- Removed as obsolete: `TC-AUTH-SIDEBAR-WIDTH-001`, `TC-AUTH-SIDEBAR-PEEK-001`, `TC-CRM-058` (rail-only).

## Changelog

- 2026-09-25 — Implemented.
- 2026-09-26 — Drag-to-reorder modules in the switcher, saved as the personal sidebar preference. The nav
  payload now reads that preference under the key it is saved with. Unit coverage in
  `module-nav/__tests__/useModuleOrder.test.tsx`, `__tests__/AppShell.test.tsx` and
  `auth/lib/__tests__/backendChrome.current-organization.test.ts`; integration in `TC-AUTH-MODULE-NAV-002`.
