# PCA ERP design-language migration (Operis pastel-navy identity)

- **Status**: in progress
- **Owner**: design system
- **Created**: 2026-08-23
- **Scope**: UI/UX only. No API, domain, auth, RBAC, tenancy, schema or workflow changes.

## 1. Why

Operis takes its **functional** foundation from Open Mercato and keeps it unchanged. Its
**visual** language, however, was inherited along with it — a stock shadcn/Tailwind-v4 look
(neutral-grey `oklch` tokens, `rounded-lg border bg-card` cards, `h-9` controls, semibold page
titles). The product direction is that Operis should look and behave as though it were built by
the team that built **PCA ERP**, carrying an Operis-specific *pastel dark-blue / muted-navy*
identity.

Source-of-truth split for every decision in this migration:

| Concern | Source of truth |
|---|---|
| Backend, APIs, data model, auth, RBAC, tenancy, module behaviour, business rules | Open Mercato / existing Operis implementation |
| Visual design, components, page structure, layout, spacing, typography, interaction patterns | PCA ERP (`~/Documents/Github/pca_erp`, read-only reference) |
| Colour identity | Operis pastel navy (§4) |

Where Operis has functionality PCA has no equivalent for, the interface is designed as a natural
**extension of PCA's rules** — never left on Open Mercato styling, and never given a third look.

`pca_erp` is a read-only reference. No PCA backend logic, APIs, models, auth or business rules
are copied.

## 2. PCA's design system, as measured

PCA's frontend is Vite + React + Tailwind 3. Its whole visual language lives in two files —
`apps/frontend/src/index.css` (CSS custom properties, space-separated RGB triplets) and
`apps/frontend/tailwind.config.js` (which maps them via `rgb(var(--x) / <alpha-value>)`) — and is
consumed by ~20 shared components under `src/shared/{erp,pca,common}-component/`.

### 2.1 Token families

Per PCA `AGENTS.md §4.2`, components consume **semantic tokens only** — never hex literals, never
fixed Tailwind ramps (`text-slate-700`), never palette-named tokens (`bg-erp-primary`).

| Family | Tokens |
|---|---|
| Surface | `background`, `surface`, `surface-muted`, `surface-strong`, `surface-modal`, `modal-muted`, `border` |
| Foreground | `foreground`, `muted-foreground`, `disabled-foreground` |
| Primary (CTA) | `primary`, `primary-hover`, `primary-soft`, `primary-border`, `primary-foreground` |
| Secondary | `secondary`, `secondary-hover`, `secondary-soft`, `secondary-border`, `secondary-foreground` |
| Accent (links, inline actions) | `accent`, `accent-hover`, `accent-soft`, `accent-border`, `accent-foreground` |
| Danger | `danger`, `danger-hover`, `danger-soft`, `danger-border`, `danger-foreground` |
| Table | `table-header`, `table-row-hover`, `table-selected`, `table-border` |
| Badge | `badge-bg`, `badge-text`, `badge-border` |
| Input | `input-bg`, `input-border`, `input-border-focus`, `input-placeholder`, `input-disabled-bg` |
| Focus | `focus-ring` |

`surface-strong` is the third neutral step (darker than `surface-muted`, lighter than `border`)
and is reserved for **chrome hover** — topbar buttons, toolbar tiles — so the hover reads as
"quieter chrome" rather than as an accent tint. `surface-modal` / `modal-muted` are the modal
equivalents.

### 2.2 Measured component specs

Every row is read from the PCA source, with `file:line`.

| Element | PCA value | Source |
|---|---|---|
| Page stack | `space-y-5` | `erp-component/PageShell.tsx:31` |
| Page header | `flex-col gap-3 sm:flex-row sm:items-end sm:justify-between` | `PageShell.tsx:33` |
| Page title | `text-2xl sm:text-3xl **font-normal** text-foreground` | `PageShell.tsx:67` |
| Page description | `text-sm font-medium text-muted-foreground max-w-2xl` | `PageShell.tsx:72` |
| Page greeting | `text-xl sm:text-2xl font-semibold tracking-wide text-muted-foreground` | `PageShell.tsx:62` |
| Button size xs | `px-2.5 py-1.5 text-xs rounded-md` | `erp-component/Button.tsx:20` |
| Button size sm | `px-3 py-2 text-sm rounded-md` | `Button.tsx:21` |
| Button size md | `px-3.5 py-2.5 text-sm rounded-lg` | `Button.tsx:22` |
| Button size lg | `px-4 py-3 text-sm rounded-xl` | `Button.tsx:23` |
| Button size icon | `h-8 w-8 rounded-lg` / iconSm `h-6 w-6 rounded-md` | `Button.tsx:25-26` |
| Button base | `inline-flex items-center justify-center gap-2 transition disabled:opacity-60 disabled:cursor-not-allowed` | `Button.tsx:45` |
| Button primary | `font-medium text-primary-foreground bg-primary hover:bg-primary-hover border border-transparent` | `Button.tsx:30` |
| Button secondary | `font-medium text-foreground bg-surface hover:bg-surface-muted border border-border shadow-sm` | `Button.tsx:32` |
| Button ghost | `text-muted-foreground hover:bg-surface-strong hover:text-foreground border border-transparent` | `Button.tsx:41` |
| Button destructive | `text-danger-foreground bg-danger hover:bg-danger-hover` | `Button.tsx:34` |
| Button destructiveOutline | `text-danger bg-surface hover:bg-danger-soft border border-danger/40 shadow-sm` | `Button.tsx:36` |
| Table card | `rounded-xl bg-surface shadow-md`, **no border** | `erp-component/DataTable.tsx:145` |
| Table header row | `bg-surface-muted`, sticky when filling | `DataTable.tsx:161` |
| Table header cell | `px-3 sm:px-5 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground` | `DataTable.tsx:267` |
| Table body cell | `px-3 sm:px-5 py-4 text-sm font-medium text-foreground` | `DataTable.tsx:265` |
| Table row dividers | `divide-y divide-border/60` | `DataTable.tsx:170` |
| Table row hover | `hover:bg-surface-muted/50` (`/70` when clickable) | `DataTable.tsx:191-199` |
| Table row selected | `bg-primary-soft/40` + `w-0.5 h-4 rounded-full bg-primary` leading bar | `DataTable.tsx:197,216` |
| Table footer | `border-t border-border bg-surface-muted/70 px-5 py-2 text-xs text-foreground` | `DataTable.tsx:252` |
| Table empty | centered `py-12 text-sm text-muted-foreground` | `DataTable.tsx:243` |
| Sort indicator | active `text-accent` chevron, idle `text-disabled-foreground` | `DataTable.tsx:84-95` |
| Modal panel | `rounded-2xl border border-border bg-surface shadow-2xl max-h-[90dvh]` | `erp-component/Modal.tsx:134` |
| Modal mobile | bottom-sheet: `rounded-t-2xl`, slide from `y:100%`, spring 320/30, drag pill | `Modal.tsx:90-138` |
| Modal backdrop | `bg-black/40 backdrop-blur-sm` | `Modal.tsx:122` |
| Modal header | `border-b border-border px-4 py-3 sm:px-6 sm:py-4` | `Modal.tsx:164` |
| Modal title | `text-base sm:text-xl font-semibold leading-none tracking-tight` | `Modal.tsx:182` |
| Modal body | `flex-1 overflow-y-auto px-6 py-4` | `Modal.tsx:227` |
| Modal footer | `border-t border-border px-6 py-3 justify-end gap-3` | `Modal.tsx:212` |
| Menu / popover surface | `rounded-xl border border-border bg-surface p-2 shadow-lg animate-fadeInUp` | `TenantTopbar.tsx:158` |
| Menu item | `rounded-md px-3 py-2 text-sm hover:bg-surface-muted` | `TenantTopbar.tsx:327` |
| Menu group label | `px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-disabled-foreground` | `TenantTopbar.tsx:235` |
| Topbar | `sticky top-0 h-16 bg-surface-muted px-4 sm:px-6` | `TenantTopbar.tsx:84-85` |
| Topbar nav item | `rounded-md px-3 py-1.5 text-sm font-semibold`, active/open `bg-surface-strong` | `TenantTopbar.tsx:116-120` |
| Sidebar shell | `w-64 border-r bg-surface`, logo block `h-20 px-4`, nav `space-y-1.5 px-2 py-3`, footer `border-t px-2 pb-3 pt-2` | `PCASidebar.tsx:62-140` |
| Sidebar item | `h-10 w-full gap-2.5 px-3 rounded-lg text-base font-medium`, icons `size={17}` | `PCASidebar.tsx:12-13,88` |
| Sidebar active | `bg-<brand>/10 text-<brand>` with the icon tinted; idle icon `muted` | `PCASidebar.tsx:17-27` |
| Content region | `mx-auto max-w-7xl px-6 sm:px-8 pt-8 pb-8`, breadcrumbs above content | `TenantLayout.tsx:26-32` |
| Shell scroll model | `h-dvh overflow-hidden`; only `<main>` scrolls | `TenantLayout.tsx:20`, `AGENTS.md §4.2` |
| Search input md | `h-9 rounded-lg border border-border pl-9 text-sm font-medium`, placeholder `font-normal text-disabled-foreground`, filled → `bg-modal-muted`, idle → `bg-surface hover:bg-modal-muted` | `erp-component/SearchInput.tsx:52` |
| Search clear | `h-6 w-6 rounded-md text-disabled-foreground hover:bg-modal-muted` | `SearchInput.tsx:62` |
| Switch | `h-5 w-9 rounded-full border`, thumb `h-4 w-4 bg-surface shadow`, on `bg-primary border-primary`, off `bg-surface-strong border-border` | `erp-component/Switch.tsx:32-42` |
| Checkbox | `h-4 w-4 rounded-[4px] border`, checked `border-primary bg-primary text-primary-foreground` + `Check strokeWidth 3`, idle hover `border-primary/50` | `erp-component/Checkbox.tsx:25-32` |
| Status pill | `rounded-full px-2 py-0.5 text-sm font-medium` | `erp-component/StatusPill.tsx:22` |
| Status tones | success/warning stay on fixed semantic hues by design; neutral `surface-muted`, danger `danger-soft`, info `accent-soft` | `StatusPill.tsx:10-16` |
| Loading | centered `Loader2` + label; page `min-h-[18rem] py-16`, card `py-12`, inline `py-3 text-xs` | `common-component/LoadingState.tsx` |
| Motion | `fadeInUp` 180ms ease-out (`translateY(8px) scale(.98)` → rest), `fadeIn` 150ms; table row exit 250ms `cubic-bezier(.4,0,.2,1)` | `tailwind.config.js:103-116`, `DataTable.tsx:262` |
| Responsive | popovers cap at `max-w-[calc(100vw-2rem)]`; dialogs `max-h-[calc(100dvh-4rem)] overflow-y-auto`; tables fold columns below 768px | `AGENTS.md §4.2` |

### 2.3 Rules PCA states explicitly

- Vertical rhythm uses a single `space-y-*` on the parent, never `mt-*` chains on children.
- Shared primitives carry viewport adaptation so call sites don't re-solve it.
- No hand-rolled buttons / close icons / confirm dialogs — always a shared primitive.
- Status tones (success/warning) are deliberately *not* theme-swappable; their meaning is stable.
- Hex literals are allowed only as **data** (user-picked swatches, fixtures), never as styling.

### 2.4 Deliberate deviation: focus indicators

PCA suppresses **every** focus indicator app-wide (`*:focus { outline: none !important }`, ring
zeroing on inputs, buttons and links — `index.css:479-612`), documented there as a product
decision. Operis **keeps visible `:focus-visible` rings**, restyled quiet (2px `--focus-ring` at
low opacity) so keyboard users retain the affordance. We reproduce PCA's *design intent* (calm,
non-shouty chrome), not the accessibility defect.

## 3. What Operis already has (and therefore what changes)

Operis is also token-driven, which is what makes this a genuine migration rather than a per-page
restyle:

| Layer | Location | Reach |
|---|---|---|
| Tokens | `apps/mercato/src/app/globals.css` (`@theme inline` + `:root` / `.dark`) | whole app |
| Primitives | `packages/ui/src/primitives/` (~70 files) | whole app |
| Shell | `packages/ui/src/backend/AppShell.tsx` | every backend screen |
| List views | `packages/ui/src/backend/DataTable.tsx` | 109 files |
| Forms | `packages/ui/src/backend/CrudForm.tsx` | 218 files |
| Page frame | `packages/ui/src/backend/Page.tsx` | list/detail pages |
| Portal | `packages/ui/src/portal/` | customer portal |

Beyond that, ~678 `.tsx` files carry their own local visual declarations; those are swept in
Phase 5.

Guardrails that stay in force: `.ai/ds-rules.md` (no hardcoded status colours, no arbitrary
values, no `dark:` on semantic tokens), `yarn lint:ds`, and `yarn check:tokens` (token parity +
WCAG contrast in **both** themes).

## 4. The Operis pastel-navy palette

Calm, muted navy — not royal, not saturated, not neon, not near-black. Status hues stay semantic
so an error never reads as "just more blue".

### Light

| Token | Hex | Role |
|---|---|---|
| `background` | `#F7F9FC` | page ground |
| `surface` | `#FFFFFF` | cards, tables, menus |
| `surface-muted` | `#EDF1F7` | table header, chips, quiet fills |
| `surface-strong` | `#E2E8F1` | chrome hover |
| `surface-modal` | `#E9EEF5` | modal chrome |
| `modal-muted` | `#F4F7FB` | filled inputs, inner modal panels |
| `border` | `#D9E0EA` | hairlines |
| `border-strong` | `#C3CEDC` | emphasised edges |
| `foreground` | `#1D2735` | ink (navy, not black) |
| `muted-foreground` | `#54637A` | secondary text |
| `disabled-foreground` | `#94A2B5` | disabled / placeholder |
| `primary` | `#43608E` | CTA |
| `primary-hover` | `#375077` | |
| `primary-active` | `#2D4363` | |
| `primary-soft` | `#E7EEF8` | selected rows, soft fills |
| `primary-border` | `#B6C7DF` | |
| `secondary` | `#55677F` | second-rank action |
| `accent` | `#3F6DA3` | links, inline actions, sort indicator |
| `accent-soft` | `#E9F1F9` | |
| `focus-ring` | `#7FA3CF` | |

### Dark

| Token | Hex |
|---|---|
| `background` | `#10151E` |
| `surface` | `#171E2A` |
| `surface-muted` | `#1E2735` |
| `surface-strong` | `#28323F` |
| `surface-modal` | `#1A2230` |
| `modal-muted` | `#212B39` |
| `border` | `#2E3948` |
| `border-strong` | `#3C4859` |
| `foreground` | `#E6ECF4` |
| `muted-foreground` | `#9AA8BB` |
| `disabled-foreground` | `#6B7889` |
| `primary` | `#8FAEDA` (foreground `#101822`) |
| `accent` | `#8CB4E4` |
| `focus-ring` | `#5D82B4` |

Contrast is enforced mechanically by `yarn check:tokens` for every `--X` / `--X-foreground`
pair in both themes, plus `foreground` on `background`.

## 5. PCA → Operis component map

| PCA | Operis |
|---|---|
| `ERPButton` | `primitives/button.tsx` (`Button`, `IconButton`, `LinkButton`) |
| `ERPSearchInput` / `PCASearchInput` | `primitives/search-input.tsx` |
| `ERPCheckbox` | `primitives/checkbox.tsx` + `checkbox-field.tsx` |
| `ERPSwitch` | `primitives/switch.tsx` + `switch-field.tsx` |
| `ERPDropdown` / `PCADropdown` | `primitives/select.tsx`, `compact-select.tsx`, `popover.tsx`, `command-menu.tsx` |
| `ERPDataTable` | `primitives/table.tsx` + `backend/DataTable.tsx` |
| `ERPPagination` | `primitives/pagination.tsx` |
| `ERPPageShell` | `backend/Page.tsx` (`Page`, `PageHeader`, `PageBody`) |
| `ERPStatusPill` | `primitives/status-badge.tsx`, `badge.tsx`, `tag.tsx` |
| `ERPModal` (+ Header/Body/Footer/Title) | `primitives/dialog.tsx`, `drawer.tsx`, `sheet.tsx` |
| `ERPFilterToggle` / `ERPDateRangeFilter` | `backend/FilterBar.tsx`, `FilterOverlay.tsx`, `backend/date-range/` |
| `ERPCalendarView` | `backend/schedule/` |
| `ERPDatePicker` / `ERPTimePicker` | `primitives/date-picker.tsx`, `time-picker.tsx` |
| `ConfirmDialog` | `backend/confirm-dialog/` |
| `LoadingState` | `primitives/spinner.tsx`, `backend/detail/LoadingMessage` |
| `EmptyState` | `primitives/empty-state.tsx`, `backend/EmptyState.tsx` |
| `CloseButton` / `DeleteIconButton` / `EditIconButton` | `primitives/icon-button.tsx` |
| `PCABreadcrumb` | `primitives/breadcrumb.tsx` |
| `PCASidebar` | `backend/AppShell.tsx` sidebar |
| `TenantTopbar` | `backend/AppShell.tsx` header |
| `TenantLayout` | `backend/AppShell.tsx` shell + `apps/mercato/src/app/(backend)/backend/layout.tsx` |
| `inspector.tsx` | `backend/detail/`, `PerspectiveSidebar.tsx` |

### Operis functionality PCA has no equivalent for

Designed as extensions of PCA's rules (PCA menu/panel/toolbar/dialog surfaces recomposed):
workflow designer, AI chat dock and assistant launcher, UMES devtools, advanced filter builder,
perspective / column chooser, progress top bar, custom-field and entity editors, webhook setup
guide, upgrade and conflict banners, notification feed.

## 6. Phases

0. Design audit — this document.
1. Token layer — `globals.css`, `layout.tsx` fonts, `check-token-parity.mjs` fix.
2. Primitives — `packages/ui/src/primitives/**` (style only, no API change).
3. Application shell — `AppShell.tsx` and neighbours.
4. Composites — `Page`, `DataTable`, `CrudForm`, `FilterBar`, forms, detail states, portal, AI.
5. Module sweep — the ~678 files with local visual declarations.
6. Cleanup — dead tokens, superseded style constants, duplicate wrappers.
7. Verification — full gate + manual pass.

## 7. Coverage log

Updated as work lands, so the final report can state exactly what was migrated.

| Area | Status | Notes |
|---|---|---|
| Phase 0 — spec | done | this document |
| Phase 1 — tokens, fonts, parity script | done | 124 `:root` / 120 `.dark` tokens; 36 contrast pairs pass in both themes; `--radius` base removed (dead once the scale became explicit); `check-token-parity.mjs` no longer crashes on the removed create-app template |
| Phase 2 — primitives | done | button, inputs (text/textarea/select + typed variants), select & menu surfaces, checkbox/radio/switch, table, dialog/drawer/sheet/popover/tooltip/command-menu, badge, card, tabs, pagination, segmented-control, empty-state, skeleton, spinner, icon-button |
| Phase 3 — shell | done | sidebar rows unified behind `SIDEBAR_ITEM_*` constants (4 duplicated call sites → 1 decision), active marker bar removed in favour of the tint, topbar → solid `h-16` chrome band, content gutters, footer |
| Phase 4 — composites | done | `Page`/`PageHeader` (+`fill`), DataTable re-architected (page header above the card; toolbar/filters/rows/pagination inside it), CrudForm field + section chrome, FormHeader detail mode |
| Phase 5 — module sweep | done | 763 token replacements across 182 files; 65 `dark:` ramp overrides removed; 35 categorical ramps mapped; 79 arbitrary values normalised; **0 hardcoded Tailwind colour ramps remain repo-wide** |
| Phase 6 — cleanup | done | dead `--radius`, stale selection-control docs, stale Figma hex annotations, gallery entries refreshed |
| Phase 7 — verification | done | see §8 |
| Verification pass (runtime) | done | app driven under Chromium against a live Postgres; see §9 |

### Deliberate non-goals found during the sweep

- **`bg-card` / `bg-muted` / `bg-accent` call sites were left in place.** `--card` now equals
  `--surface` and `--muted`/`--accent` equal `--surface-muted`, so these render correctly in the
  new palette. Rewriting ~230 of them would be churn, not migration. The Surfaces table in
  `.ai/ds-rules.md` documents them as aliases of the same planes.
- **`JsonDisplay` keeps a categorical syntax-highlighting palette.** The colours encode JSON
  types, not product meaning. They now come from status tokens rather than raw ramps, so they
  still theme correctly.
- **`text-[9px]`** remains the documented exception for notification counts and `Avatar size="sm"`.

## 8. Verification

```bash
yarn check:tokens && yarn ds:tokens:check
yarn generate && yarn build:packages
yarn typecheck && yarn lint && yarn lint:ds && yarn i18n:check
yarn test && yarn ds:code-connect:check
yarn build:app
```

Manual: auth flow, tenant/organization switching, module visibility under a non-admin role, a list
page, create/edit forms, a detail page, confirm dialog, drawer, filter overlay, command palette,
bulk actions with progress, customer portal. Component states (default / hover / focus-visible /
active / selected / disabled / loading / error / empty / read-only). Breakpoints 1920 → 390.
Keyboard traversal, `Cmd/Ctrl+Enter` submit, `Escape` cancel. Console free of warnings.

## Changelog

- 2026-08-23 — spec created; PCA design system audited and measured; Operis pastel-navy palette
  defined; phase plan agreed (hybrid shell, dark mode retained, Figtree via Google Fonts link,
  full long-tail sweep).


## 9. Verification pass — findings and fixes (2026-08-23)

The migration was re-verified independently against the reference, with the app
**running** rather than only built. Nine defects were found and fixed; four of
them were invisible to lint, typecheck, tests and the production build.

| # | Finding | Severity | Origin | Fix |
|---|---|---|---|---|
| 1 | The Google Fonts `<link>` was blocked by the app's own CSP (`style-src 'self' 'unsafe-inline'`), so **Figtree never loaded at runtime** — the whole typography half of the migration was inert. | critical | migration | Self-hosted the woff2 files under `public/fonts/` + `src/app/fonts.css`; served from `'self'`, no CSP change, no build-time network. |
| 2 | Sticky table columns painted `--background` (page ground). Once the card became `--surface`, they showed a grey band across every row. | high | migration | Header sticky cells → `md:bg-table-header`, body sticky cells → `md:bg-surface`. |
| 3 | `DataTable` column headers rendered sentence-case at body size — the sortable header's ghost `Button` (`text-sm font-medium`) overrode `TableHead`'s micro-label. | high | migration | Header button inherits the header typography and drops its hover fill; sort indicator moved to `accent-strong` / `disabled-foreground`. |
| 4 | 66 raised planes (menus, drawers, dropdowns, cards, wizard panels) painted `bg-background`, making floating surfaces the same colour as the page behind them. | high | migration | Any className pairing `bg-background` with a shadow → `bg-surface`. |
| 5 | A second input family (`border-input bg-background`) never migrated with the `Input` primitive — two input fills side by side. | medium | pre-existing | 59 field chromes → `bg-input-bg`. |
| 6 | `bg-foreground text-background` used across modules as the "selected/active" fill — inverted near-black blocks (buttons, wizard steps, selected day, count chips, marker bars). | high | pre-existing + amplified | 53 sites → `bg-primary text-primary-foreground`; verified zero near-black interactive fills remain at runtime. |
| 7 | AI chat / command palette shipped a **dark** shell while their contents used light-theme text tokens — dark-on-dark, and a third design language. | medium | pre-existing | Panels → `bg-surface`, matching the `CommandMenu` primitive. |
| 8 | Form validation showed only a message: no `aria-invalid`, no `aria-describedby`, no `role="alert"`, and the control kept its normal border. | medium | pre-existing | Field region marks `data-crud-field-invalid`; one CSS rule colours any control family; ARIA wired on the control. |
| 9 | 14 of 16 form controls had **no programmatic label** (visual `<label>` with no `htmlFor`). | medium | pre-existing | Field region wires `aria-labelledby` on its first control, with a `MutationObserver` so async-mounted relation/dictionary triggers are covered. Now 15/15. |

Component specs additionally corrected against a fresh read of the reference:
`Pagination` (current page is a **solid** primary chip; pager buttons bordered
`surface`), `SegmentedControl` (bordered `surface` rail with the selected item
as the quiet fill — the inverse of what shipped), `EmptyState` (dashed hairline
on the card plane, soft-square icon chip, `text-base font-semibold` title).

### Verified at runtime

- Login, navigation, list, search, detail, create, validation, settings, gallery.
- **Authorization**: a restricted user gets `Forbidden` from `/api/auth/users`,
  `/api/auth/roles`, `/api/directory/organizations` while retaining
  `/api/customers/people` — enforced server-side, not by hidden UI.
- **Module gating**: 48 nav entries for superadmin vs 35 for the employee role.
- **Tenant isolation**: both sessions return exactly one distinct organization id.
- **Responsive**: 1920/1440/1280/1024/768/390 — no page-level overflow on list,
  form or dashboard; table scroll is contained inside the card.
- **Focus**: 16/16 tabbed elements show a visible indicator.
- **Console**: no errors, page errors or 5xx across the driven flows.


## 10. Follow-up fixes (2026-08-23, same day)

Three items were left open by the verification pass. Two were real and are now fixed;
the third was investigated and deliberately not changed.

### Brand ramp re-authored to Operis's identity

Open Mercato's brand gradient — neon lime → yellow → violet (`#B4F372 → #EEFB63 →
#BC9AFF`) — was still the "brand moment" fill on `FancyButton`, the floating feedback
widget and the celebration popup. Against pastel navy it read as another company's
identity, which is precisely the leakage this migration exists to remove.

`--brand-lime` / `--brand-yellow` are **renamed**, not just repointed, because a token
called `lime` holding a blue is a naming defect in its own right:

| Was | Now | Value |
|---|---|---|
| `--brand-lime` | `--brand-sky` | `#A9C4EC` |
| `--brand-yellow` | `--brand-lilac` | `#C9C2F0` |
| `--brand-violet` | unchanged | `#BC9AFF` |

`--brand-violet` is kept: it is the documented AI/intelligence accent across 146 sites,
it stays clearly distinct from `--primary`, and a violet reads correctly beside navy.
Only the neon half of the ramp was the problem. Updated together: `globals.css`,
`check-token-parity.mjs` (theme-invariant allowlist), `fancy-button.tsx`,
`DemoFeedbackWidget.tsx`, the design-system gallery, `.ai/ds-rules.md`,
`.ai/ui-components.md`, and the exported token snapshot.

### `entityColorStyle` extracted

The recipe for rendering a **user-picked** entity colour as a chip — full-strength text
and border, same hue at 10% behind — was written out at seven call sites across five
files. Colours chosen in settings are data and must stay inline, but the recipe is
styling and is now one exported helper (`packages/ui/src/primitives/tag.tsx`), so a chip
cannot drift to a different tint. `EventBlock` keeps its own background-only variant,
which is a genuinely different treatment.

### Not changed: the `packages/cli` worker segfault

`yarn test` intermittently fails `@open-mercato/cli` with
`A jest worker process was terminated by another process: signal=SIGSEGV`. Investigated
and deliberately left alone:

- `yarn jest --runInBand` passes **89/89 suites, 1708/1708 tests**, repeatedly.
- A **different** suite dies each run — the signature of a runner-level crash, not a test.
- The failure is `Test suite failed to run` (bootstrap), never an assertion.
- None of this migration's changed files are reachable from those suites: they are all
  `.tsx` / `.css` / `.md`, and `packages/cli`'s jest config maps in only `shared` and
  `queue`, neither of which this work touched.

The plausible lever is `workerIdleMemoryLimit` in `jest.config.base.cjs` recycling a
TypeScript-compiler-heavy worker mid-parse. That value is deliberately tuned to a memory
budget (issue #2402), so raising it trades a documented RSS guarantee for a fix that
cannot be validated on CI hardware from here. Flagged for the repo owner rather than
changed as a side effect of a UI migration.


## 11. Readiness pass (2026-08-23)

Work done so the codebase is a stable base for new modules rather than a
finished-looking one. Everything here was verified by running the app.

### The test gate — root-caused, NOT fixed

`yarn test` fails intermittently with
`A jest worker process was terminated by another process: signal=SIGSEGV` on a
different, arbitrary suite each run. The cause is the fork boundary, established
by experiment rather than inference:

| Hypothesis | Test | Result |
|---|---|---|
| Worker recycling kills a worker mid-parse | `--workerIdleMemoryLimit=4096MB` | **refuted** — still 2 in 3 |
| Worker contention | `--maxWorkers=1` | **refuted** — still crashes |
| The child_process pool itself | `--runInBand` (no worker process) | **confirmed** — never crashes |

**An attempted fix was reverted.** Setting `workerThreads: true` in
`jest.config.base.cjs` did stop the segfault (8 clean runs on `packages/cli`,
and marginally faster), but it broke the run in two other ways:

1. `cli`, `queue` and `events` have suites that `process.chdir()` into a temp
   directory, which throws under worker_threads. Moving those three to
   `--runInBand` worked around it.
2. With threads, the run then **hung**: all 24 packages printed passing
   summaries, but a jest process never exited and turbo never printed its
   final line. Threads keep a process alive on an open handle where a forked
   child is simply killed.

A hang is worse than an intermittent segfault — it blocks CI silently instead
of failing loudly — so the whole change was reverted and `jest.config.base.cjs`
is back to its tuned state. Every package passes standalone (core 10,924 ·
cli 1,708 · ui 1,878 · checkout 159); the flake only appears in the parallel
turbo run.

Two viable directions for whoever picks this up, neither of which should be
taken as a side effect of unrelated work:
- find and close the open handle, then adopt `workerThreads: true` (fastest,
  keeps parallelism, no memory cost — threads share a process);
- or run the whole repo in band (deterministic, ~1.8x slower on `cli`).

### New modules land on-system with no design work

Proved end to end with a throwaway module (created, registered in
`apps/mercato/src/modules.ts`, generated, loaded, removed). A page written the
obvious way — `PageHeader` + `Card` + `Button` — measured: title 30px/400
Figtree, primary button `#43608E` at h-9 with an 8px radius, page ground
`#F7F9FC`. Nothing had to be styled.

### Coverage closed

24 module pages driven in the browser (sales, catalog, WMS, warranty claims,
inbox ops, staff, workflows, business rules, checkout, messages, attachments,
resources, channels, EUDR, logs, events, companies, deals, integrations,
settings, design system): **zero page errors, zero 5xx, and zero elements
painting the page ground while sitting on a card** — the bug class from §9,
now confirmed absent outside the screens originally inspected.

Dark mode was verified in the running app for the first time (previously only a
static preview). The two low-contrast hits are both artefacts: disabled controls
(WCAG-exempt) and the gradient FAB, whose `backgroundColor` is transparent so
the probe measured the page behind it.

The customer portal was run for the first time: Figtree, navy CTA, correct
field chrome, no console errors, and the dashboard correctly bounces an
unauthenticated visitor to login.

### Second-pass sweep

The first sweep found raised planes with "className pairs `bg-background` with a
shadow" — so a bordered, shadowless panel slipped through, which is most of
them. The structural rule (a BORDER plus padding or a radius makes it a box, and
a box is never the page ground) caught **194 more** across 108 files, including
10 primitives whose fills were declared as cva string constants rather than
`className` attributes.

Also fixed: `DataTable`'s active-filter count chip was near-white text on a 30%
grey fill — legible only in theory. It is a solid primary chip now.

### Bounded the ARIA observer

The `MutationObserver` added in §9 watched each field region's subtree for the
lifetime of the form, so a rich-text field re-ran the wiring on every keystroke.
It now disconnects at the first control it wires — its job is to catch a late
mount, not to police the subtree — and anything that changes the wiring
afterwards re-runs the effect anyway.

### Guardrails for what comes next

`AGENTS.md` now states the two rules whose absence caused the defects found in
this migration: never paint a raised element with `bg-background`, and what the
page skeleton is. Both were trimmed to fit the instruction budget, which this
work had broken (`yarn agents:check-budget` was failing) and which now passes
with a tighter ratchet than before.
