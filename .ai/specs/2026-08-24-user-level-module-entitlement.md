# Hierarchical Feature Gating: User-Level Module Entitlement

**Date:** 2026-08-24
**Status:** Implemented
**Modules:** `auth`, `directory`

## Problem

`2026-08-24-mvp-foundation-and-tenant-module-entitlement.md` delivered the first
of the two entitlement layers the product needs:

```
Platform module registry  →  Tenant entitlement  →  RBAC grants  →  Access
                              (tenant_modules)       (RoleAcl/UserAcl)
```

A Super Admin can decide that Acme has WMS and Globex does not. What is missing
is the second layer: **a Tenant Admin cannot narrow that further per user.** Once
a tenant has WMS, every user whose role grants `wms.*` reaches it, and the only
way to withhold it from one person is to fork their role — which conflates
"what this person is allowed to do" with "which product surfaces this person
sees".

The target hierarchy is:

```
Platform-available feature
  AND Tenant-enabled module          (tenant_modules   — Super Admin)
  AND User-enabled module            (user_modules     — Tenant Admin)   ← new
  AND RBAC grant                     (RoleAcl/UserAcl)
  = Effective access
```

## Decisions

### The user layer subtracts; it cannot add

`user_modules` stores **restrictions**, not entitlements. A row with
`is_enabled = false` withholds one module from one user. Absence of a row means
"not restricted", and the effective set is computed as

```
effective = tenantEnabledModules  MINUS  userRestrictedModules
```

This makes Rule 3 ("user settings may reduce access, never elevate it") a
*structural* property rather than a policy that a future caller could get wrong:
the resolver only ever removes ids from a set it did not build. Enabling a
module for a user that the tenant does not have is a no-op by construction, so
Rule 1 (Super Admin is authoritative) cannot be subverted by any write to this
table, including a hand-crafted SQL insert.

**Why not mirror `tenant_modules`' fail-closed "a row must exist to be
allowed"?** Fail-closed is right for the tenant layer because there is exactly
one tenant-creation seam to provision (`onTenantCreated`), and forgetting it
denies a whole tenant loudly. Users are created through many seams —
invitations, onboarding, CLI seeds, the admin UI, tenant setup, integration
imports — and a missed seam would silently lock a legitimate employee out of
every business module. A restriction table has no provisioning requirement at
all, so there is no seam to miss and no backfill migration to get wrong.

Fail-safe is preserved because the user layer is never the thing that *grants*:
access still requires (a) an enabled `tenant_modules` row — fail-closed — and
(b) an RBAC grant — fail-closed. An unreadable, empty or corrupt `user_modules`
table degrades to "tenant-level gating only", never to "open".

### Enforcement stays in `RbacService` — one seam, no new checks

`RbacService` is already the single point every guard funnels through: API
routes (`apps/mercato/src/app/api/[...slug]/route.ts`), backend pages
(`apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`), the navigation
payload (`resolveBackendChromePayload`), injection widgets, mutation guards,
command interceptors, AI tool search and search-entity access. The user layer is
added to the three methods that already consult tenant entitlement:

| Method | Change |
|---|---|
| `userHasAllFeatures` | denies when the required feature's module is user-restricted |
| `getGrantedFeatures` | drops grants owned by user-restricted modules |
| `getEffectiveFeatures` | drops concrete features owned by user-restricted modules |

`tenantHasFeature` is deliberately untouched: it answers "does *any* role in
this tenant grant X" for user-less runtimes (scheduler workers), where there is
no user whose restrictions could apply.

Because every gate already routes here, no module needed a per-module check, no
`if (feature === 'crm')` exists anywhere, and cross-module UI (an Invoicing page
rendering a CRM customer picker through an injection widget, a DataTable column
contributed by another module, a command-palette entry, a dashboard widget)
disappears automatically — those surfaces are already filtered by
`grantedFeatures`, which is now user-restricted.

### Entitlement no longer rides on `requireFeatures`

Before this change, module entitlement was only ever consulted through
`userHasAllFeatures(required, …)`. That works when a route declares features,
but `required.length === 0` short-circuits to `true`, so **any route that
deliberately declares no feature escaped entitlement entirely**. Those routes are
legitimate and not rare: a message recipient reading their own thread holds no
`messages.*` grant, and `messages/__tests__/detail-access.test.ts` pins that
design on purpose. Under the old shape, a tenant that never bought `messages`
could still open `/backend/messages` and call `GET /api/messages`.

`RbacService.isModuleAllowedForUser(userId, moduleId, scope)` closes the class
of hole rather than the instances. Both catch-all guards already know the
matched route's owning module, so they now check module reachability
independently of, and ahead of, the feature guard:

- `apps/mercato/src/app/api/[...slug]/route.ts` → 403 `FEATURE_NOT_AVAILABLE`
- `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` → access-denied page

RBAC and entitlement stay separate concerns: `requireFeatures` answers "may this
person do X", `isModuleAllowedForUser` answers "is this capability part of the
plan at all". Neither substitutes for the other, and a new module inherits the
route-level gate without declaring anything.

### Writes go through the command bus

Both entitlement mutations are `CommandHandler`s rather than raw service calls,
so they inherit the existing audit infrastructure (`ActionLog` via
`CommandBus`), command interceptors and cache invalidation instead of growing a
parallel audit path:

- `directory.tenant_modules.set` — Super Admin changes a tenant's entitlement
- `auth.user_modules.set` — Tenant Admin changes a user's restriction

Each `buildLog` records actor, tenant, module, old value and new value.

### Tenant scoping of the management API

`PUT /api/auth/user-modules` resolves the target user's tenant from the database
and requires it to equal the caller's effective tenant. A Tenant Admin therefore
cannot address a user in another tenant even with a valid user id, and the
`GET` lists only modules the *caller's tenant* is entitled to — so a module the
tenant does not have never appears as an assignable option (Rule 2).

## Changes

| File | Change |
|---|---|
| `auth/data/entities.ts` | New `UserModule` entity (`user_modules`) |
| `auth/migrations/Migration20260824120000_auth_user_modules.ts` | Table, unique `(user_id, module_id)`, tenant index, FK |
| `auth/lib/userModules.ts` | `UserModuleService` — restriction resolution, tenant-scoped cache, writes |
| `auth/di.ts` | Registers `userModuleService` |
| `auth/services/rbacService.ts` | User restrictions applied alongside tenant entitlement |
| `auth/commands/userModules.ts` | `auth.user_modules.set` command with audit log |
| `auth/api/user-modules/route.ts` | GET/PUT, tenant-scoped, gated by new ACL features |
| `auth/acl.ts` | `auth.users.modules.view` / `auth.users.modules.manage` |
| `auth/backend/users/[id]/modules/` | Tenant-admin page to withhold modules per user |
| `auth/backend/users/page.tsx` | "Modules" row action linking to the page |
| `auth/i18n/*.json` | Strings for the page and its errors |
| `directory/commands/tenantModules.ts` | `directory.tenant_modules.set` command with audit log |
| `directory/api/tenant-modules/route.ts` | PUT routed through the command bus |
| `auth/services/rbacService.ts` | `isModuleAllowedForUser` — module reachability without a feature |
| `apps/mercato/src/app/api/[...slug]/route.ts` | Module entitlement enforced per route, ahead of the feature guard |
| `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` | Same, for backend pages |
| `shared/security/entitlementErrors.ts` | `FEATURE_NOT_AVAILABLE` code + `featureNotAvailable()` |
| `notifications/lib/notificationRecipients.ts` | Feature-derived recipients narrowed by both entitlement layers |
| `search/api/search/route.ts`, `search/global/route.ts` | Read entitlement-filtered grants instead of raw ACL |
| `ai_assistant/lib/mcp-server.ts` | Same, so MCP tools of a withheld module stay uncallable |

## Rules enforced

| Scenario | Result |
|---|---|
| tenant enabled, user unrestricted, grant present | **allowed** |
| tenant enabled, user restricted, grant present | denied |
| tenant disabled, user unrestricted, grant present | denied |
| tenant disabled, user "enabled" row written directly | denied (subtract-only) |
| tenant enabled, user unrestricted, no grant | denied (RBAC still applies) |
| platform module (`auth`, `directory`, …) | never gated by either layer |

## Testing

- `auth/lib/__tests__/userModules.test.ts` — restriction resolution, subtract-only
  semantics, tenant-entitlement validation on write, platform-module rejection,
  cache invalidation.
- `auth/services/__tests__/rbacService.userEntitlement.test.ts` — the full truth
  table above through `userHasAllFeatures`, `getGrantedFeatures` and
  `getEffectiveFeatures`, including the super-admin path and cross-tenant
  isolation.
- `auth/api/user-modules/__tests__/route.test.ts` — cross-tenant rejection,
  withheld-module rejection, unauthenticated rejection.
- `auth/commands/__tests__/userModules.test.ts` and
  `directory/commands/__tests__/tenantModules.test.ts` — Rule 2 rejection,
  platform-module rejection, cross-tenant rejection, super-admin-only tenant
  entitlement, and the audit payload's old/new values.
- `notifications/lib/__tests__/recipient-entitlement.test.ts` — a withheld user
  is dropped from a feature-derived fan-out, an unprovisioned tenant notifies
  nobody, platform-module notifications are never gated.

## Audit performed

Every backend page and API route belonging to a gated (non-platform) module was
checked for a guard. All 163 gated-module backend pages now resolve through the
entitlement gate. The API sweep surfaced twelve methods with `requireAuth` but no
`requireFeatures`; eight of those already enforce features in-handler through
`rbacService.userHasAllFeatures` (planner's self-service availability, sales
document history, customer label assignment — all feature-dependent on request
shape, which is why they cannot be declarative), and the rest are covered by the
new route-level module gate. The `communication_channels` OAuth callback keeps
its documented no-feature-gate exemption: it is a redirect target whose identity
comes from the state cookie.

Three surfaces were reading raw ACL grants and so were entitlement-blind; all
now read `rbacService.getGrantedFeatures`, which applies both layers: global and
playground search (results of a withheld module were still returned), and the
MCP server (tools of a withheld module were still callable). The notification
fan-out selected recipients straight from `role_acls`/`user_acls` SQL and now
applies the same tenant + user narrowing.

## Known gaps

- Enforcement remains centralised in `RbacService`. A code path reading
  `RoleAcl.featuresJson` directly would bypass both entitlement layers. The
  repository already forbids that (`AGENTS.md` § Access Control); it is not
  mechanically enforced. The notification fan-out was the one such path found,
  and it is fixed.
- `apps/mercato/src/app/(backend)/backend/layout.tsx` reads `auth.features` from
  the JWT to decide whether to render the upgrade-actions banner. That is a raw
  grant read, but it gates only a `configs.manage` affordance, and `configs` is
  a platform module entitlement never governs.
- Withholding a module hides its surfaces and denies its APIs; it does not delete
  data the user already created. That is deliberate (see the task's data-handling
  rule) — re-enabling restores the previous state.
- The browser's navigation payload is cached in `BackendChromeProvider` and
  refreshes on window focus, scope change or `om:refresh-sidebar`. A revocation
  therefore reaches an idle open tab on its next focus; every server request in
  between is already enforced against the new state.

## Second pass — re-verification (2026-08-24)

A full re-audit against a live database and running server found five further
defects, all fixed here:

1. **Module dependencies were not enforced.** `info.requires` declares hard
   dependencies (`wms` → `catalog`, `sales`; `staff` → `planner`, `resources`),
   and entitlement ignored them, so an operator could store `wms = on` above a
   withheld `sales`. `resolveReachableModuleIds` now resolves stored entitlement
   into reachable entitlement by fixed point, the command refuses to enable a
   module whose prerequisites are withheld, and the screen shows both the
   blocking prerequisite and the dependents a switch-off would take.
2. **Entitlement rode on `requireFeatures`.** A route declaring no features
   passed the gate unconditionally, because an empty requirement matches
   everything. `isModuleAllowedForUser` is now checked per route from the
   manifest's `moduleId`, in the API dispatcher, the backend catch-all and both
   branches of the frontend catch-all (staff and customer portal).
3. **Navigation kept dead links.** `buildAdminNav` filtered by features only, so
   a menu entry for a feature-less page survived into a withheld module. It now
   takes an `isModuleAllowed` predicate fed by `getReachableModuleIds`.
4. **The nav payload cache outlived revocation by 30 minutes.** Entitlement
   writes dropped only their own cache entry, leaving the sidebar advertising
   modules the guards had begun denying. Both services now also sweep the
   `rbac:*` / `nav:sidebar:*` / `nav:entities:*` tags the nav route publishes.
5. **Entity metadata leaked module references.** `entities` is a platform module,
   so the route gate never fires for it, yet its three metadata endpoints
   enumerate every module's entity types and feed pickers, link targets and the
   sidebar. They now narrow through `isEntityModuleReachable`.

### User restrictions deliberately do not cascade dependencies

Withholding `customers` from one user does **not** withhold `sales` from them,
even though `sales` requires `customers`. The dependency is about whether the
module can function for the tenant — its data and services — not about one
person's visibility. Sales keeps working for that user while every CRM element
inside it (pickers, columns, injected widgets, links) disappears, because those
are feature-gated and the user's effective feature set no longer carries
`customers.*`. Cascading here would break Sales outright, which is the opposite
of the requirement.

## Superseded detail (2026-08-25)

Two statements above changed. Provisioning is no longer "grant the current
module set": each module declares its own default via
`ModuleInfo.defaultEntitlement` and absence means off. And the browser is no
longer limited to feature-derived gating — `BackendChromePayload.enabledModuleIds`
carries the viewer's reachable module set, read through `useModuleEnabled` /
`useEnabledModules` / `<ModuleGate>`, which is what finally covers hardcoded
cross-module links that carry no feature of their own. The public-portal hole
noted in that audit (entitlement checked only on `requireCustomerAuth` routes) is
also closed. See `.ai/specs/2026-08-25-mvp-module-scope-and-ui-gating.md`.

### Verified live

Against the seeded topology (`admin@operis.local`, `admin@acme.local`,
`user@acme.local`, `admin@globex.local`) on a production build: tenant-level
withholding produced `403 FEATURE_NOT_AVAILABLE` and dropped the navigation from
72 to 45 entries with zero dead links; the dependency cascade removed `sales` and
`wms` when `customers` was withheld; user-level withholding denied one user while
their colleague and the unrelated `messages` module were untouched; a tenant
admin could neither see nor assign a module the tenant lacked, nor read or write
another tenant's entitlement; re-enabling restored access with data intact; and
every change landed in `action_logs` with actor, module and old/new value.
