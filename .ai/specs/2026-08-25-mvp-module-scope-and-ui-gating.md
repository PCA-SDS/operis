# MVP Module Scope and Client-Side Module Gating

**Date:** 2026-08-25
**Status:** Implemented
**Modules:** `directory`, `auth`, `attachments`, `customers`, `entities`, `ui`, `shared`, `cli`

## Problem

Operis registers 60+ modules inherited from Open Mercato. A user logging in saw
warehouse management, product catalogs, shipping carriers, EUDR compliance and a
demo "Example" module in the sidebar — surfaces whose behaviour the product has
not decided on yet.

Two prior specs built the enforcement machinery
(`2026-08-24-mvp-foundation-and-tenant-module-entitlement.md`,
`2026-08-24-user-level-module-entitlement.md`). What was missing was:

1. **No default plan.** `provisionTenant(tenantId, { enabledByDefault: true })`
   switched *every* module on for *every* new tenant, so entitlement existed but
   started wide open. Fail-closed was the documented intent everywhere except at
   the one place that creates the rows.
2. **No client-side answer to "may I reach this module".**
   Server surfaces are shaped by `grantedFeatures`, which `RbacService` filters
   through both entitlement layers. A hardcoded `'/backend/sales/orders'` in a
   React component has no feature to test, and the only module set the browser
   could see (`enabled-module-ids.generated.ts`) is deploy-level and
   tenant-blind.

Auditing for (2) surfaced five further defects, fixed here.

## Decisions

### The plan is declared per module, in `ModuleInfo`

`ModuleInfo.defaultEntitlement?: 'enabled' | 'disabled'` travels the same path as
`info.requires`: the generator copies each module's `metadata` verbatim into
`info:` in all three registry variants — app, runtime and **cli** — so one
declaration reaches the Next.js app, every `mercato` command and every test with
no generator change.

**Absent means `'disabled'`.** Entitlement is fail-closed everywhere else (a
missing `tenant_modules` row denies), and the default has to agree: otherwise
adding a module to the build hands it to every tenant the next time anything
provisions them. Opting in is an explicit, reviewable line in the module's
`index.ts`.

> **Rejected: a per-entry field in `apps/mercato/src/modules.ts`.** That is where
> a deployment-scope decision belongs, but `bootstrapFromAppRoot` — the CLI path —
> loads only `.mercato/generated/*` and never imports `modules.ts` or calls
> `applyModuleOverridesFromEnabledModules`. `mercato init`, `seed:dev` and
> `sync-tenant-modules` are exactly where provisioning happens, so the plan would
> have been invisible to all of them without threading a new field through
> `packages/cli/src/lib/generators/module-registry.ts` and its snapshot tests.
> `packages/core/src/__tests__/mvp-module-scope.test.ts` recovers the "one
> reviewable place" property instead, by pinning the whole set.

### Scope

**Switched on** (17): `customers`, `tasks`, `staff`, `planner`, `resources`,
`ai_assistant`, `mcp`, `currencies`, `messages`, `communication_channels`,
`channel_gmail`, `channel_imap`, `integrations`, `data_sync`, `sync_excel`,
`workflows`, `business_rules`.

`planner` and `resources` are not optional: `staff` hard-requires them and
`resolveReachableModuleIds` drops a module whose prerequisites are withheld.
`mvp-module-scope.test.ts` enforces that closure.

**Switched off**: the commerce and logistics stack (`catalog`, `sales`, `wms`,
`warranty_claims`, `shipping_carriers`, `payment_gateways`, `checkout`,
`gateway_stripe`, `eudr`, `sync_akeneo`), the customer-facing surfaces
(`customer_accounts`, `portal`, `onboarding`), and `inbox_ops`,
`push_notifications`, `devices`, `channel_apns`, `channel_expo`, `channel_fcm`,
`webhooks`, `storage_s3`.

**Removed from the build entirely**: `example`, `example_customers_sync`,
`ratelimit_probe` (development fixtures) and `content` (public legal pages —
entitlement is evaluated from a signed-in user's tenant and structurally cannot
gate an unauthenticated page).

**Reclassified platform → entitleable**: `design_system`, `api_docs`,
`api_keys`. None is needed for a tenant to log in or be administered, which is
the documented bar for `PLATFORM_MODULE_IDS`.

### Reconciliation is an explicit operator action

`provisionTenant` still only fills in modules a tenant has no decision recorded
for — re-running it never clobbers an operator's choice.
`TenantModuleService.applyDefaultPlan` reconciles in **both** directions and is
reachable only through `mercato directory sync-tenant-modules --apply-defaults`.

It writes through the service rather than the `directory.tenant_modules.set`
command, because that command calls `requireSuperAdmin(ctx)` and a CLI
reconciliation has no authenticated actor. Faking one to satisfy an audit path
would make `action_logs` claim a person did something a script did. UI-driven
changes still route through the command and are still audited.

`--enable-all` overrides the plan and switches everything on. It exists for the
integration-test environment, which runs the whole spec suite against one tenant.

### The chrome payload carries the viewer's reachable module set

`BackendChromePayload.enabledModuleIds` = the deploy registry narrowed by tenant
entitlement and per-user restrictions, platform ids included. It is populated
from the reachable set `resolveBackendChromePayload` already computes for
`buildAdminNav`, so it costs no extra query and rides the existing cache tags
that entitlement writes already sweep.

Consumed through `useModuleEnabled(moduleId)`, `useEnabledModules()` and
`<ModuleGate module="…">` in `@open-mercato/ui/backend/BackendChromeProvider`:

| State | Result | Why |
|---|---|---|
| Outside a `BackendChromeProvider` | allow | Component galleries and tests have no entitlement context; gating there would break unrelated surfaces. |
| Inside one, payload not yet loaded | deny | A link into a withheld module must never flash on screen before being removed. |
| Payload has no `enabledModuleIds` | allow | "Unknown", not "nothing is reachable" — an older server, a cached pre-upgrade payload, or a runtime where the module registry is not bootstrapped. |

The field is **omitted rather than emptied** when `hasEnabledModulesRegistry()`
is false. `getEnabledModuleIds()` returns `[]` both for "no modules" and for "no
registry", and shipping that empty array would read to the client as a total
denial and blank every gated affordance on the page. Standing down there matches
what `isEntitlementEnforceable` and `filterGrantsByEnabledModules` already do.

The provider also publishes the set to the injection loader via
`registerEntitledModuleIds`, so the existing `requiredModules` widget gate
becomes entitlement-aware. That is a **second layer** over
`registerEnabledModuleIds`, not a replacement: the two answer different questions
("is this module built in" vs "may this person reach it"), are registered from
different places at different times, and collapsing them would make the result
depend on which bootstrap won the race. Browser-only — a server process serves
every tenant, so there is no single viewer to narrow to.

## Defects found and fixed

1. **Public portal pages were ungated.** The `(frontend)` catch-all checked
   `isModuleEnabled` only inside the `requireCustomerAuth` branch, so
   `/{org}/portal/login` rendered for a tenant with no `portal` entitlement —
   inviting credentials for a portal that is switched off. Public routes now
   resolve the organization slug → tenant and apply the same check. Failure to
   resolve returns "allow": a public route outside any organization namespace has
   no tenant to evaluate, and denying those would take down genuinely global
   pages.
2. **Integration-test discovery ignored `enabledModules`.** In the monorepo,
   `resolveEnabledModuleIds` treated every module directory *on disk* as enabled
   and read `modules.ts` only under `OM_TEST_APP_ROOT`. Specs for a module the
   app does not register would have run against a server that does not serve it.
   It now reads the declared list from each app, falling back to the filesystem
   scan only where no app config is readable.
3. **`api_keys.create` guarded MCP key minting.** Reclassifying `api_keys` would
   have broken the AI Assistant's MCP setup. `POST /api/ai_assistant/mcp-key`
   now requires `ai_assistant.mcp.serve`, which is the correct domain model
   regardless: the key is scoped to the caller's own roles, and demanding
   general API-key administration was over-broad. The persisted
   `api_keys.create` feature id is unchanged.
4. **The entitlement CLI never invalidated any cache.** All three commands built
   `new TenantModuleService(em)` by hand. The DI registration injects the
   configured `CacheStrategy` alongside the EntityManager, and the service
   no-ops `invalidate()` without one — so `set-tenant-module`,
   `sync-tenant-modules` and the new `--apply-defaults` wrote entitlement to the
   database and left a running server's cached navigation payload and RBAC
   decisions untouched. The observable symptom: an operator switches a module
   off, the API guards start returning 403, and the sidebar keeps advertising it
   for up to the 30-minute nav TTL. All three now resolve `tenantModuleService`
   from the container, which also picks up any dependency the service grows
   later. Verified live: a CLI `set-tenant-module --enabled false` now
   disappears from `/api/auth/admin/nav` on the next request, taking its
   dependents with it.
5. **Only overlay specs were filtered by module.** The first pass at defect 2
   fixed which module set discovery reads, but the filter returned every
   non-overlay spec unconditionally — so a spec's *own* owning module was never
   checked. Non-overlay specs now honour the declared list too, and only when
   the list is declared: the filesystem fallback cannot tell an unregistered
   module from one that lives elsewhere, and over-including is the safer error
   there. Real effect: discovery drops from 1076 to 1008 specs, exactly the 68
   belonging to the four removed modules.

## Cross-module UI swept

| Surface | Fix |
|---|---|
| `buildRelationHref` (`packages/ui/.../customFieldRelationDisplay.ts`) | Optional reachable-module set; a relation into a withheld module renders as a label with no link. Threaded through `fetchRelationRecordDisplays`, `CustomDataSection` and `RecordListRelationCell`. |
| `resolveAssignmentEnrichments` (`attachments`) | Attachments outlive the entitlement of the module they are attached to; the library no longer resolves labels or links for those. Both library routes pass `rbacService.getReachableModuleIds`. |
| `resolveTodoHref` (`customers`) | Task rows store `<module>:<kind>`; the deep link is dropped when that module is unreachable. The `example` special case is gone with the module. |
| `ActivitiesSection`, `NotesSection` (`packages/ui`) | The built-in linked-deal affordance is gated on `customers`; an explicit `dealLinkHref` override stays the host's decision. |
| `customers/search.ts` | Removed the "open todo" secondary link — it pointed into the `example` module. `resolveUrl` already lands on the customer's Tasks tab. |
| `workflows` order-approval widget | Declares `requiredModules: ['sales']`. |
| `dashboards seed-analytics` CLI | Refuses with a named reason when `sales`/`catalog`/`customers` are not entitled, instead of writing rows nobody can see. |
| `sales/components/documents/customFieldHelpers.ts` | Generic custom-field helpers moved to `@open-mercato/shared/lib/crud/custom-fields-client`; `resources` no longer imports a page helper out of `sales`. |
| `data_sync`, `sync_excel` | Now declare their real `info.requires` (`integrations`, and `data_sync` respectively) rather than linking across an undeclared dependency. |

Dashboard widgets needed no change and were verified rather than assumed: every
widget declares `features` (`dashboards.analytics.*` declare `sales.orders.view`
/ `customers.*`), and `grantedFeatures` is entitlement-filtered, so they drop off
the main dashboard on their own.

## Guards

- `packages/core/src/__tests__/mvp-module-scope.test.ts` — pins the exact
  default-on set, enforces dependency closure, and rejects a `requires` naming a
  module the repo does not ship.
- `packages/core/src/__tests__/module-ui-gating.test.ts` — fails on a new
  hardcoded `'/backend/<module>'` link that neither consults the reachable set
  nor is a declared `info.requires` dependency. Scope is shared code plus modules
  in the shipped plan, so adding a module to the plan surfaces its links for
  review. Seven reviewed exceptions carry a reason each.

- `directory/__tests__/cli-tenant-modules.test.ts` — pins that every entitlement
  CLI command drives the container-built service, so defect 4 cannot return.
- `cli/src/lib/testing/__tests__/integration-discovery.test.ts` — a spec of an
  unregistered module is excluded; the filesystem fallback still includes it.

The first two are registered in `scripts/repo-wide-guards.mjs`
(`yarn test:repo-wide-guards`), because the turbo filter selects packages, not
paths, and would otherwise skip them on a PR that only touches `apps/`.

## Testing

- `directory/__tests__/tenantModules.test.ts` — the plan is honoured on
  provisioning, `--enable-all` overrides it, an operator-disabled module survives
  re-runs, and `applyDefaultPlan` reconciles both directions and reports no-op.
- `customers/components/detail/__tests__/utils.test.ts` — `resolveTodoHref` under
  reachable, withheld and no-context module sets.
- The three `backendChrome.*` suites now assert against a registry stub that
  includes `getEnabledModuleIds`.
- Full local run: `build:packages`, `generate`, `typecheck`, `lint`,
  `test:repo-wide-guards`, `build:app`, and every package's jest suite.

## Known gaps

- `content`'s public pages are gone from this build. Re-registering the module
  would bring them back unentitled — entitlement structurally cannot gate a page
  with no tenant context. Any future public surface needs the org-slug resolution
  the portal fix uses, or a deploy-level decision.
- Reconciliation via `--apply-defaults` is not audited in `action_logs` (see the
  decision above). Its output names every module it moved, per tenant.
- The nav payload is cached in `BackendChromeProvider` and refreshes on window
  focus, scope change or `om:refresh-sidebar`. A withheld module therefore
  disappears from an idle open tab on its next focus; every server request in
  between is already denied.

## Housekeeping done alongside

- `apps/mercato/src/lib/homeQuickLinks.ts` carried four links into the removed
  `example` module behind a registry check. The links and their 20 i18n keys are
  gone; the function keeps a `MODULE_LINKS` map keyed by module id so a future
  entry cannot be added to the unconditional list by accident.
- `packages/core/AGENTS.md` § Entity Update Safety moved its worked examples to
  `.ai/docs/entity-flush-safety.md`, leaving the hard rules and a pointer. That
  is the split the root `AGENTS.md` prescribes, and it reclaimed 2 895 bytes from
  a chain that was over the agent instruction budget — the tail of that file was
  past the truncation point and therefore never reaching an agent anyway. The
  ratchet was re-recorded downward, not loosened.

## Changelog

### 2026-08-25
- Initial implementation.
- Hardening pass: defects 4 and 5 above, the omitted-vs-empty payload
  distinction, the CLI and discovery regression tests, a test making the guard's
  copy of `PLATFORM_MODULE_IDS` verifiable against the runtime list, and a check
  that every module in the plan is actually registered in `modules.ts`.
