# Modular Monolith Audit — Operis

**Date:** 2026-09-17  **Branch:** `feat/invoice-module`  **Scope:** 9,557 TypeScript source files, 74 modules, 28 packages.
> **Implementation status (2026-09-17, same day):** the enforcement design in §L was
> revised and Phase 1 is landed. The count-based ratchet originally proposed as Gate 1 was
> **rejected** — a baseline of 1,301 freezes debt and reports it as progress. It is replaced by
> per-module sealing through the package `exports` map, which makes a cross-module deep import a
> compile error, and by a forcing rule that seals each module automatically once its last deep
> importer is migrated. 20 modules are sealed. See
> [ADR-0007](adr/ADR-0007-module-sealing-via-package-exports.md). §A–§K below are the original
> measurements and remain accurate.

**Method:** full static import graph (21,480 edges) + table-ownership extraction from ORM entities + migration SQL parsing + targeted code reads to verify every claim. No code was modified.

---

## A. Executive Summary

Operis is **a module system with genuine infrastructure, but without a module contract layer.** The framework side is unusually good: modules are discovered, entitled, overridable and individually disableable; tenant isolation is centralised rather than left to per-query discipline; events are properly named and flow in the right direction; table ownership is clean. What is missing is the one thing that would make the boundaries real — **a public surface a module can expose and other modules are obliged to use.**

The concrete finding: of **1,306 production import edges from one business module into another, 1,301 (99.6%) reach directly into the target's internals** — `lib/`, `data/entities`, `services/`, `utils/`, `components/`. **Zero** go through the target module's `index.ts`. That is not developer sloppiness. Every module's `index.ts` is a 6–37 line *descriptor* exporting `metadata` and `features` and nothing else, so a module that wants to integrate correctly has nothing to import. The contract mechanisms that *do* exist — the command bus (335 uses), events, the query engine, widget injection — are real and well-used, but they are optional alternatives sitting beside an unrestricted direct-import path, and nothing in lint, TypeScript, package exports or CI prefers one over the other.

The consequences are measurable and specific, not theoretical:

- **83 places where one module writes another module's database tables directly**, including `staff` creating `planner`'s availability rules inside a shared transaction while `planner` exposes 12 commands for exactly that purpose.
- **A confirmed behavioural bug** where the customer portal's "mark all notifications read" re-implements the notifications module's logic and silently drops three things the real implementation does — including a filter whose absence the canonical code has a comment explicitly warning about.
- **16 mutual module dependencies and 296 cycles of length ≤5.** The module graph is not a DAG.
- **The foundational `shared` package imports upward into `core` business modules** in 18 places, including the CRUD factory and the query engine — and does so through *undeclared* package dependencies that only resolve because everything is in one repo.
- **174 cross-module dependencies that no module declares.** `requires` exists as a first-class mechanism; only 16 of 74 modules use it.

**What is genuinely strong and should not be touched:** multi-tenancy (centralised, fail-closed, mutation-tested), authorization coverage (I found no unguarded write route — all 10 candidates were false positives on verification), event design (no cycles, correct direction), database table ownership (297 tables, zero double-owned), migration ownership (only 8 cross-module touches out of ~300 migrations), and integration test depth (only 5 modules lack coverage).

**There are no Critical findings.** I specifically hunted for cross-tenant leaks, authorization bypasses and data corruption paths and did not find one. The risk here is not a live security hole — it is that the cost of changing any module is rising, because 45 of 47 core modules have undeclared dependents reaching into their internals, and nothing will tell you when you break one.

**The cheapest high-value fix is not a refactor.** This repo already runs a mature repo-wide guard harness (`scripts/repo-wide-guards.mjs`, 12 enumerated architecture tests) and already contains exactly one module contract test (`chat_tasks/__tests__/moduleContract.test.ts`). Boundary enforcement can be added as guards in that existing harness, ratcheted against today's violation count, without moving a single file.

---

## B. Current Architecture Map

### Layers as actually implemented

```
apps/mercato            Next.js host. modules.ts registry + overrides. Owns no business logic.
    |
packages/core           47 business + platform modules  (auth, sales, customers, chat, tasks, ...)
packages/<feature>      module-shaped packages (checkout, scheduler, webhooks, onboarding, matrix,
                        gateway-stripe, channel-*, sync-akeneo, migrate-tps, ...)
    |
packages/ui             design system + backend component families
packages/shared         DI, query engine, CRUD factory, commands, events contracts, i18n, crypto
packages/{events,queue,cache,search,storage-s3,telemetry}     infrastructure
```

The intended direction is downward. **It is violated**: `shared` imports from `core` and `ui` (§E-4), and `packages/search` declares `@open-mercato/core` as a dependency.

### Module inventory (core, by data ownership)

| Module | Tables | Command files | Events | Subscribers | Deps out | Dependants |
|---|---|---|---|---|---|---|
| sales | 27 | 11 | 44 | 4 | 13 | 5 |
| customers | 25 | 18 | 49 | 4 | 14 | 11 |
| catalog | 15 | 11 | 21 | 1 | 11 | 6 |
| staff | 13 | 13 | 38 | 0 | 10 | 2 |
| auth | 12 | 3 | 12 | 0 | 5 | **26** |
| customer_accounts | 10 | 0 | 25 | 13 | 4 | 1 |
| resources | 10 | 9 | 21 | 0 | 5 | 3 |
| tasks | 10 | 7 | 23 | 2 | 5 | 1 |
| chat | 9 | 7 | 9 | 1 | 4 | 2 |
| invoice | 9 | 4 | 12 | 0 | 2 | 0 |
| warranty_claims | 9 | 4 | 14 | 9 | 8 | 0 |
| wms | 9 | 4 | 27 | 4 | 5 | 0 |
| communication_channels | 8 | 15 | 16 | 3 | 5 | 7 |
| workflows | 7 | 0 | 26 | 2 | 7 | 1 |
| entities | 6 | 0 | 0 | 0 | 6 | 16 |
| eudr | 6 | 7 | 23 | 7 | 5 | 0 |
| notifications | 4 | 0 | 0 | 2 | 4 | **22** |
| attachments | 3 | 0 | 3 | 0 | 2 | 13 |
| directory | 3 | 3 | 6 | 1 | 2 | **41** |
| dictionaries | 2 | 3 | 3 | 0 | 2 | 10 |
| planner | 2 | 5 | 6 | 0 | 2 | 4 |
| progress | 1 | 0 | 6 | 0 | 0 | 9 |
| chat_tasks | 2 | 1 | 2 | 0 | 3 | 0 |

*(Full 49-row table produced by the audit script; truncated to the architecturally significant rows.)*

### Business modules vs platform

**True business modules:** sales, customers, catalog, staff, tasks, chat, invoice, warranty_claims, wms, appointments, resources, planner, eudr, messages, inbox_ops, communication_channels, shipping_carriers, payment_gateways, checkout.

**Platform wearing a module costume** — these live in `src/modules/` and are addressed like business modules, but every module depends on them and they own cross-cutting concerns: `auth` (26 dependants), `directory` (41), `notifications` (22), `entities` (16), `attachments` (13), `dictionaries` (10), `progress` (9), `configs`, `query_index`, `audit_logs`, `feature_toggles`, `translations`, `widgets`.

This dual nature is the root of most cycles in §G. `directory` with 41 dependants is not a business module — it is the tenancy substrate — yet it sits in the same namespace and is imported the same way.

**Genuine integration modules** (own the seam, not either side): `chat_tasks`, `data_sync`, `sync_excel`, `sync_akeneo`, `migrate_tps`, `chat_matrix`.

### Public interface — the core finding

Every module's `index.ts` exports `metadata` (a `ModuleInfo` descriptor read by the generator) and `features` (ACL ids). Nothing else, in 46 of 47 core modules. `invoice` is the sole exception, exporting five GDT-sync symbols.

```
$ cat packages/core/src/modules/tasks/index.ts
export const metadata: ModuleInfo = { name: 'tasks', ... }
export { features } from './acl'
```

**`index.ts` is a registry descriptor, not a public API.** Confirmed by the graph: 0 of 1,306 cross-module production imports target another business module's `index.ts`.

---

## C. Dependency Map

The contract mechanisms that exist and work:

```
Commands (module.entity.action, 335 call sites)   — the sanctioned cross-module WRITE path
Events (module.entity.action, clean, acyclic)     — the sanctioned async notification path
Query engine (131 call sites)                     — the sanctioned tenant-safe cross-module READ path
Widget injection (string spot IDs, runtime)       — the sanctioned UI extension path
DI container (string tokens)                      — the sanctioned service-resolution path
```

Actual production edge distribution (module → different module, tests excluded):

```
2,097 total cross-module edges
  791  -> packages/shared/modules/*        platform contracts            ACCEPTABLE
1,306  -> another business/feature module
         5  via commands/                  real contract                 ACCEPTABLE
         0  via index.ts                   —
         0  via extension-points.ts        (self-declaration only)
     1,301  DIRECTLY INTO INTERNALS        (99.6%)                       BOUNDARY VIOLATION
```

Breakdown of those 1,301 by what they reach into:

```
lib/         553      utils/       241      services/    107      widgets/      49
data/        271      types        165      components/  100      api/           8
```

Example of the pattern that should exist, and does, in the one integration module that was designed deliberately:

```
chat_tasks
 ├── requires: ['chat', 'tasks']          <- declared, enforced at provisioning
 ├── chat/commands/cards                  <- ACCEPTABLE (command contract)
 ├── chat/lib/scope                       <- violation (internal)
 ├── tasks/lib/assignment                 <- violation (internal)
 ├── tasks/services/projectService        <- violation (internal service)
 ├── tasks/data/entities                  <- violation (data layer)
 └── tasks/api/openapi                    <- violation (transport internals)
```

Even the best-designed module in the repo breaches internals six ways, because there is no surface to use instead. **This is a platform gap, not a code-review failure.**

### Improper dependencies (highlighted separately)

```
packages/shared/lib/crud/factory.ts      -> core/directory/utils/organizationScope   LAYER INVERSION
packages/shared/lib/data/engine.ts       -> core/entities/lib/{helpers,validation,…}  LAYER INVERSION
packages/shared/lib/crud/custom-fields.ts-> core/entities/data/entities (ORM classes) LAYER INVERSION
packages/shared/lib/commands/command-bus -> core/audit_logs/*  (type-only)            LAYER INVERSION (compile)
packages/search (package.json)           -> @open-mercato/core                        LAYER INVERSION
core/staff/commands/leave-requests.ts    -> core/planner PlannerAvailabilityRule      DATA OWNERSHIP
core/customer_accounts/api/portal/…      -> core/notifications Notification           DATA OWNERSHIP + BUG
core/sales/api/price-kinds/route.ts      -> core/catalog/api/helpers                  TRANSPORT INTERNALS
core/translations/di.ts                  -> catalog/dictionaries/entities/resources   INVERTED OWNERSHIP
```

---

## D. Module Boundary Matrix

| Module | Boundary clarity | Data ownership | Public contract | Cross-module coupling | Circular dependency | Main issue |
|---|---|---|---|---|---|---|
| **auth** | Low | Clean (12 tables) | None (descriptor only) | 26 dependants import `data/entities` + `services/rbacService` | Yes — api_keys, directory, entities, notifications, dashboards | Platform concern addressed as a module; every module imports its ORM classes |
| **directory** | Low | Clean (3 tables) | None | 41 dependants; `organizationScope` consumed by `shared` | Yes — auth, entities | Tenancy substrate living in the module namespace |
| **notifications** | Low | Clean (4 tables) | Service exists, not exported | 22 dependants; `customer_accounts` writes its table directly | Yes — auth, configs | Has a proper service layer that callers bypass |
| **sales** | Low | Clean (27 tables) | None | 13 out / 5 in | Yes — catalog, dashboards, workflows | Largest module; mutual cycle with catalog |
| **customers** | Low | Clean (25 tables) | `commands/` exported in package.json | 14 out / 11 in | Yes — dashboards | `sales` imports its React detail-view hooks |
| **catalog** | Low | Clean (15 tables) | `commands/` exported | 11 out / 6 in | Yes — sales | Imports `sales/services/taxCalculationService` directly |
| **planner** | Medium | **Violated by staff** | 12 commands, well-formed | 2 out / 4 in | No | Owns a complete command contract that `staff` bypasses |
| **staff** | Low | Writes planner's tables | None | 10 out / 2 in | No | Creates + persists + indexes another module's entity |
| **tasks** | Medium | Clean (10 tables) | None; has `extension-points.ts` | 5 out / 1 in | No | Only consumer (`chat_tasks`) must use internals |
| **chat** | Medium | Clean (9 tables) | `commands/cards` used correctly | 4 out / 2 in | No | Cleanest business module; still no export surface |
| **chat_tasks** | **High** | Owns only the link (2 tables) | Declares `requires`, has a contract test | 3 out / 0 in | No | Model module — limited only by what it can import |
| **invoice** | Medium | Clean (9 tables) | **Exports 5 real symbols** | 2 out / 0 in | No | Ships a migration altering `directory.organizations` |
| **entities** | Low | Clean (6 tables) | None | 6 out / 16 in | Yes — auth, configs, directory, translations | EAV platform; `shared` imports its ORM classes |
| **translations** | Low | Clean (1 table) | None | 6 out / 5 in | Yes — dictionaries, entities | `di.ts` hard-codes 4 modules (inverted ownership) |
| **customer_accounts** | Low | Clean (10 tables) | None | 4 out / 1 in | No | Re-implements notifications logic incorrectly |
| **chat_matrix** | Medium | Clean (5 tables) | None | 2 out / 0 in | No | No integration tests; external-ID tenancy derivation |
| **appointments** | Medium | Clean (5 tables) | None; declares `requires` | 6 out / 1 in | No | No integration tests |

---

## E. Boundary Violations

### E-1 — `staff` creates, persists and indexes `planner`'s entities

```
Severity:            High
Modules:             core/staff  ->  core/planner
File(s):             packages/core/src/modules/staff/commands/leave-requests.ts:14, :51-53, :237, :254
Current dependency:  import { PlannerAvailabilityRule } from '@open-mercato/core/modules/planner/data/entities'
                     const availabilityRuleCrudIndexer: CrudIndexerConfig<PlannerAvailabilityRule> = {
                       entityType: E.planner.planner_availability_rule,
                       cacheAliases: ['planner.availability'],   // planner's cache namespace, redeclared in staff
                     }
                     const rule = params.em.create(PlannerAvailabilityRule, { ... })
                     params.em.persist(rule)
                     // and inside the same em.transactional() block as StaffLeaveRequest writes
Expected boundary:   commandBus.execute('planner.availability.create', ...)
                     planner exposes 12 commands, incl. planner.availability.create /
                     planner.availability.weekly.replace / planner.availability.delete
```

**Why this matters.** `staff` has copied `planner`'s persistence contract into its own source: the entity shape, the query-index entity type, and the cache invalidation aliases. Three independent things now have to be changed in lockstep whenever planner changes its availability model, and only one of them is in planner. Planner's own commands carry audit logging, undo, event emission and optimistic-lock enforcement via the command bus; the `staff` path carries none of that, so a leave request that creates an availability rule produces no `planner.*` event and no audit trail. The transaction spans both modules' tables, so a planner-side constraint failure rolls back the staff leave request and vice versa.

**Recommended fix.** Replace the inline `em.create`/`persist` with `commandBus.execute('planner.availability.create', ...)`. Keep the `em.transactional` wrapper if the atomicity is genuinely required — the command bus runs inside an ambient transaction.

**Risk of changing it.** Low-moderate. Leave-request approval has 31 integration specs under `staff/__integration__`. The behavioural difference to watch is that routing through the command will now *emit* planner events and write audit rows where previously it did not — that is the intended correction, but any subscriber on `planner.availability.*` will start firing on leave approvals.

---

### E-2 — Customer portal re-implements `notifications.markAllAsRead` and gets it wrong

```
Severity:            High  (confirmed behavioural defect, not a latent risk)
Modules:             core/customer_accounts  ->  core/notifications
File(s):             packages/core/src/modules/customer_accounts/api/portal/notifications/mark-all-read.ts:6,:21-29
                     (sibling [id]/read.ts:19 and [id]/dismiss.ts:19 do the same at row level)
Current dependency:  import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
                     await em.nativeUpdate(Notification,
                       { recipientUserId: auth.sub, tenantId: auth.tenantId, status: 'unread' },
                       { status: 'read', readAt: now })
Expected boundary:   the notifications module's own route does:
                       resolveNotificationContext(req)
                       -> runGuardedNotificationWrite(...)      (mutation guards)
                       -> service.markAllAsRead(scope)
                     (packages/core/src/modules/notifications/api/mark-all-read/route.ts)
```

**Why this matters.** `NotificationService.markAllAsRead` (`lib/notificationService.ts:551-618`) does four things the portal copy does not:

1. Applies `inAppVisibleSql()`. The canonical implementation carries an explicit comment explaining why: *"'mark all as read' must scope to the SAME set [as the badge] — otherwise it flips push/email-only rows the user never saw."* The portal copy omits it, so it marks notifications read that were never shown to the customer and returns a count larger than the badge displayed.
2. Filters on `organization_id` when present. The portal copy scopes to tenant + recipient only. This is **not** a cross-tenant leak — `recipientUserId` is the binding predicate and a user belongs to one tenant — but it does cross organisation boundaries within a tenant for multi-org users.
3. Calls `invalidateNotificationCache(...)`. The portal copy does not, so the unread badge serves a stale count until the cache expires.
4. Re-loads the affected rows and broadcasts them over SSE. The portal copy does not, so other open sessions do not update.

**Recommended fix.** Delete the three portal handlers' inline ORM work and delegate to the notifications service through DI, passing a scope built from the customer auth context. The portal route keeps its own `getCustomerAuthFromRequest` authentication — only the mutation moves.

**Risk of changing it.** Low. The correction makes the portal behave like the backend, which is the documented intent. `customer_accounts/__integration__` has 27 specs; add one asserting that a push-only notification is not flipped by mark-all-read.

---

### E-3 — No module exposes a public surface (structural root cause)

```
Severity:            High  (enabling condition for E-1, E-2, E-5, E-7 and 1,297 other edges)
Modules:             all 74
File(s):             every packages/*/src/modules/*/index.ts
Current dependency:  index.ts exports { metadata, features } only. 46 of 47 core modules.
                     1,301 of 1,306 cross-module production edges therefore target internals.
Expected boundary:   a declared, importable server-side contract per module
```

Two mechanisms actively defeat any attempt to enforce this today:

**(a) `packages/core/package.json` curates public exports, then nullifies them.** It declares a deliberate list — `./modules/customers`, `./modules/customers/commands`, `./modules/sales`, `./modules/catalog`, `./modules/auth`, ~25 entries — and then adds a wildcard ladder:

```json
"./*/*": { "types": ["./src/*/*.ts", "./src/*/*.tsx"], "default": "./dist/*/*.js" },
"./*/*/*": { ... },        // ... continuing to ten levels deep
```

Every file under `src/` is importable. The curated list documents an intent that the export map itself overrides.

**(b) ESLint carries no cross-module import rule.** `eslint.config.mjs` has exactly one `no-restricted-imports` group — the MikroORM decorator shim — and the comment notes `turbo run lint` only runs in `apps/mercato`, so `packages/**` is editor-only.

**Recommended fix.** Do not create a `public/` folder. The repo already has the right convention half-built: `extension-points.ts` exists in 25 of 47 core modules and is explicitly documented as *"Surfaces this module opens to other modules"* — it is simply limited to UI injection hosts today. Extend that file to declare server-side contracts (commands, read models, service tokens), then narrow the wildcard exports in a later phase. See §N.

**Risk of changing it.** Nil for the additive declaration step. The export-map narrowing is the risky part and belongs last, after callers have migrated.

---

### E-4 — `shared` imports upward into `core` and `ui`, through undeclared dependencies

```
Severity:            High
Modules:             packages/shared  ->  packages/core, packages/ui
File(s):             packages/shared/src/lib/crud/factory.ts:9
                       import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
                     packages/shared/src/lib/crud/custom-fields.ts:3
                       import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
                     packages/shared/src/lib/data/engine.ts:5-7
                       import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
                       import { validateCustomFieldValuesServer } from '@open-mercato/core/modules/entities/lib/validation'
                       import { sanitizeCustomFieldHtmlRichTextValuesServer } from '.../htmlRichTextSanitizer'
                     packages/shared/src/lib/commands/command-bus.ts:1,2,14   (type-only)
                     packages/shared/src/lib/bootstrap/factory.ts, lib/auth/server.ts, lib/di/container.ts (dynamic)
Current dependency:  18 imports total: 5 static value, 3 type-only, 10 dynamic
Expected boundary:   shared is the bottom layer; core depends on shared, never the reverse
```

**Why this matters.** Three compounding problems.

*The dependency is not declared.* `packages/shared/package.json` lists exactly one workspace dependency: `@open-mercato/cache`. It imports `@open-mercato/core` and `@open-mercato/ui` anyway. This resolves only because Yarn workspaces hoist everything into one `node_modules`. Turbo's task graph is therefore wrong for `shared` — it will not rebuild shared when core changes, and `yarn build:packages` ordering is correct by luck rather than by declaration. This is the clearest instance in the repo of "everything is in one repository" being used, implicitly, to bypass a boundary.

*The inversions sit in the most-used code paths.* `crud/factory.ts` is the CRUD route factory that 67 route files build on; `data/engine.ts` is the data engine. The tenant-scope resolver they depend on, `resolveOrganizationScopeForRequest`, lives in a *business module* (`directory`) — so the foundational request-scoping primitive is owned by a module that sits above it.

*It is a real cycle at the package level.* `core` declares `@open-mercato/shared`; `shared` imports `@open-mercato/core`. `packages/search` additionally declares `@open-mercato/core` in its `dependencies`.

The `command-bus.ts` → `audit_logs` imports are **type-only** and resolve at runtime through `ctx.container.resolve('actionLogService')` — that is the correct decoupled pattern, and the coupling there is compile-time only. I am not classifying it with the value imports.

**Recommended fix, in order of cost:**
1. Add `@open-mercato/core` and `@open-mercato/ui` to `packages/shared/package.json` `dependencies` — this changes nothing functionally but makes the real graph visible to Turbo and to the existing `production-install-workspace-closure.test.ts` guard.
2. Move `organizationScope` from `core/modules/directory/utils/` into `packages/shared/src/lib/auth/` and re-export from directory for compatibility. It is platform code, not directory business logic.
3. Leave the `entities`/EAV imports for later — the query engine genuinely needs the custom-field layer, and inverting it properly means defining a custom-field provider interface in shared that `entities` implements.

**Risk of changing it.** Step 1 is zero-risk. Step 2 is a move + re-export, covered by the CRUD factory's existing tests. Step 3 is a real refactor — defer it.

---

### E-5 — `translations/di.ts` hard-codes the modules it serves (inverted ownership)

```
Severity:            Medium
Modules:             core/translations -> core/catalog, core/dictionaries, core/entities, core/resources
File(s):             packages/core/src/modules/translations/di.ts:3-6, :11-14
Current dependency:  import { translatableFields as catalogFields }    from '../catalog/translations'
                     import { translatableFields as dictionaryFields } from '../dictionaries/translations'
                     import { translatableFields as entitiesFields }   from '../entities/translations'
                     import { translatableFields as resourcesFields }  from '../resources/translations'
                     export function register() { registerTranslatableFields(catalogFields); ... }
Expected boundary:   each module registers its own translatable fields from its own di.ts
Why this matters:    Translations owns a closed registry of its consumers. Adding a translatable
                     field to a new module requires editing translations. If catalog is disabled
                     via modules.ts overrides, translations still imports it at DI-registration time.
                     It is also the direct cause of two of the 16 mutual cycles
                     (dictionaries<->translations, entities<->translations), because those modules
                     import translations' TranslationManager component back.
Recommended fix:     invert to self-registration — each module's own di.ts calls
                     registerTranslatableFields(ownFields). The helper already lives in
                     shared/lib/localization/translatable-fields, so no new mechanism is needed.
Risk of changing it: Low. Mechanical, four call sites, and registration order is irrelevant for a
                     field registry. Verify translations still resolves overlays after the move.
```

---

### E-6 — `invoice` ships a migration that alters `directory`'s table

```
Severity:            Medium
Modules:             core/invoice -> core/directory
File(s):             packages/core/src/modules/invoice/migrations/Migration20260911120000_invoice_sync.ts:5,:10
Current dependency:  up():   alter table "organizations" add column if not exists "tax_code" text null;
                     down(): alter table "organizations" drop column if exists "tax_code";
Expected boundary:   directory owns organizations; invoice extends it via data/extensions.ts,
                     which AGENTS.md explicitly mandates for exactly this case
Why this matters:    The column IS correctly declared on directory's entity
                     (directory/data/entities.ts:105-106), so there is no schema drift and
                     `yarn db:generate` will not fight it — this is narrower than it first looks.
                     The problem is the down-migration: rolling back invoice drops a column that
                     directory's ORM entity still maps, which breaks directory, not invoice.
                     Migration ordering also now couples the two modules.
Recommended fix:     do not move the applied migration (that would be a data risk for no gain).
                     Move the DOWN half: make invoice's down() a no-op and let directory own the
                     column's lifecycle, with a comment pointing at the invoice migration that
                     introduced it. New cross-module columns should use data/extensions.ts.
Risk of changing it: Very low — down-migrations are not run in production here.
```

---

### E-7 — `sales` imports `catalog`'s transport-layer helpers

```
Severity:            Low
Modules:             core/sales -> core/catalog
File(s):             packages/core/src/modules/sales/api/price-kinds/route.ts:4
Current dependency:  import { sanitizeSearchTerm, parseBooleanFlag } from '@open-mercato/core/modules/catalog/api/helpers'
Expected boundary:   these are generic request-parsing utilities with no catalog semantics;
                     parseBooleanFlag duplicates shared/lib/boolean's parseBooleanToken
Why this matters:    it makes catalog's HTTP layer a dependency of sales' HTTP layer for no
                     domain reason, and it is one of the six edges sustaining the catalog<->sales cycle
Recommended fix:     move both to packages/shared/src/lib/http/ (or use the existing
                     parseBooleanToken, which AGENTS.md already mandates)
Risk of changing it: Nil. Pure utility move; both are stateless string functions.
```

---

### E-8 — Frontend features import each other's view internals

```
Severity:            Medium
Modules:             core/sales -> core/customers ; core/staff -> core/planner ; core/chat_tasks -> core/tasks
File(s):             sales/**  -> customers/components/detail/hooks/useCurrencyDictionary   (4 levels deep)
                     sales/**  -> customers/backend/hooks/useEmailDuplicateCheck            (into a PAGE tree)
                     sales/**  -> customers/components/detail/types
                     sales/**  -> customers/components/AddressEditor
                     staff/**  -> planner/components/AvailabilityRulesEditor
                     chat_tasks/** -> tasks/components/{api,format,queryKeys,shellParams}
                     appointments/** -> customers/components/formConfig
Current dependency:  153 cross-module imports originate in .tsx files; 93 land in another
                     module's components/ and 3 in another module's backend/ page tree
Expected boundary:   a feature may use the design system freely; reaching into another feature's
                     detail-view hooks couples two render trees and two data-fetch strategies
Why this matters:    `customers/components/detail/hooks/` is by every convention private to the
                     customers detail view. `backend/` is the routed page tree — importing a hook
                     out of it means a sales page's behaviour changes when a customers *page* is
                     restructured. The staff->planner UI import mirrors the staff->planner data
                     write in E-1: staff owns planner's editor and writes planner's rows.
Recommended fix:     promote genuinely shared pieces (AddressEditor, useCurrencyDictionary) to
                     packages/ui/src/backend/; leave detail-view internals private. Handle
                     AvailabilityRulesEditor with E-1 as one ownership decision.
Risk of changing it: Low per component, but do them one at a time — these are rendered widgets
                     with existing visual QA.
```

---

### E-9 — `dictionaries` UI components are a de-facto shared library

```
Severity:            Low
Modules:             customers, sales, resources, staff, catalog -> core/dictionaries
File(s):             dictionaries/components/dictionaryAppearance   (25 imports across 5 modules)
                     dictionaries/components/DictionaryEntrySelect  (14 imports across 5 modules)
                     dictionaries/components/AppearanceSelector     ( 8 imports across 3 modules)
Current dependency:  five modules import three components directly from dictionaries/components/
Expected boundary:   a component used by five unrelated modules is design-system surface
Why this matters:    low practical risk — these are stable presentational components — but they are
                     the single largest cross-module UI coupling, and dictionaries cannot refactor
                     its component folder without a five-module sweep
Recommended fix:     re-export the three from a declared surface (or move to packages/ui) and
                     migrate imports. No behaviour change.
Risk of changing it: Nil if done as a re-export first, then a codemod of import paths.
```

---

## F. Database Ownership Findings

### Table ownership — clean

Extracted `tableName` from every module's `data/entities.ts`:

- **297 tables with a declared owner.**
- **0 tables declared by more than one module.**

This is the strongest result in the audit. Ownership at the schema level is unambiguous.

### Cross-module reads — 211, mostly acceptable

211 places where a module reads another module's entity. The large majority target platform-ish modules and are read-only lookups:

```
customers -> auth.User                    7   (resolving actor names on activity rows)
sales     -> dictionaries.DictionaryEntry 6   (lookup values)
staff     -> auth.User                    6
auth      -> directory.Organization       5
messages  -> auth.User                    5
```

**Classification: Needs review, not violation.** These are reference-data reads against modules that exist to be read. The concern is not the read but that it goes through the ORM entity rather than the query engine — see §I.

### Cross-module writes — 83, the real problem

83 places where a module writes another module's tables. Splitting by intent:

**Acceptable (seed/CLI/dev-fixture paths, ~35):** `catalog/seed/examples.ts`, `dashboards/seed/analytics.ts`, `*/lib/seeds.ts`, `*/cli.ts`, and the entire `migrate-tps` package (a one-shot importer, whose whole job is to write other modules' tables).

**Needs review (~30):** writes to platform modules — `core/entities.CustomFieldValue` (EAV), `core/dictionaries.Dictionary*`, `core/feature_toggles.FeatureToggle`, `core/attachments.Attachment`. These modules exist to store other modules' data; the issue is they offer no write API, so callers use the ORM.

**Boundary violations (confirmed, business data):**

| From | To | File | Note |
|---|---|---|---|
| staff | planner.PlannerAvailabilityRule | `staff/commands/leave-requests.ts:237,254` | §E-1 — planner has 12 commands |
| customer_accounts | notifications.Notification | `.../portal/notifications/mark-all-read.ts:21` | §E-2 — confirmed defect |
| customer_accounts | notifications.Notification | `.../portal/notifications/[id]/{read,dismiss}.ts:19` | same pattern, row-level |
| sync_excel | data_sync.SyncMapping | `sync_excel/api/import/route.ts` | write from an API route |
| data_sync | integrations.SyncExternalIdMapping | `data_sync/lib/id-mapping.ts` | |
| sync_akeneo | data_sync.SyncCursor, integrations.SyncExternalIdMapping | `lib/delete-imported-products.ts` | |
| catalog | sales.SalesChannel | `catalog/seed/examples.ts` | seed path |
| workflows | business_rules.BusinessRule | `workflows/lib/seeds.ts`, `cli.ts` | seed path |

### Cross-module transactions — 13

Thirteen `em.transactional` blocks span two modules' tables. Most are a business module plus a platform module (`chat`+`attachments`, `messages`+`attachments`, `attachments`+`entities`) and are defensible: the attachment and the message must commit together.

One is not: **`staff/commands/leave-requests.ts` wraps staff and planner writes in one transaction** (§E-1). A planner constraint violation aborts the leave request.

`auth/lib/setup-app.ts` spans `directory` + `entities` — acceptable, it is tenant provisioning.

### Questionable joins

None found. The query engine appends tenant/org predicates to joined tables automatically, and no raw cross-module SQL join was found outside migrations.

---

## G. Circular Dependency Findings

**16 mutual (2-node) cycles. 296 distinct cycles of length ≤5.** The module graph is not a DAG.

### Mutual cycles, with cause

```
auth <-> directory
   auth/api/login.ts             -> directory/data/entities  (Organization, Tenant)
   directory/api/organizations/  -> auth/lib/tenantAccess
   CAUSE: inappropriate ownership. Both are platform. Tenancy primitives (tenantAccess,
          organizationScope) and identity primitives are split across two modules that each
          need the other's half. Legitimate as a domain relationship, wrong as a module split.

auth <-> entities
   auth/lib/backendChrome.tsx    -> entities/data/entities
   entities/api/records.ts       -> auth/services/rbacService
   CAUSE: accidental coupling. auth needs custom fields on users; entities needs RBAC.
          Both should reach a shared RBAC/EAV port, not each other.

auth <-> notifications
   auth/api/reset.ts             -> notifications/lib/notificationBuilder + notificationService
   notifications/api/admin/…     -> auth/{data/entities,lib/grantChecks,services/rbacService}
   CAUSE: legitimate orchestration in one direction (password reset must notify), accidental
          in the other. auth->notifications should be an EVENT (auth.password.reset_requested)
          that notifications subscribes to — exactly the pattern used elsewhere in this repo.

auth <-> dashboards
   auth/backend/roles/[id]/edit/page.tsx -> dashboards/components/WidgetVisibilityEditor
   dashboards/api/*/route.ts             -> auth/data/entities
   CAUSE: UI composition. A role-edit page renders a dashboards widget picker. Architecturally
          this is what widget injection exists for — dashboards should inject into an auth spot.

catalog <-> sales
   catalog/commands/prices.ts       -> sales/services/taxCalculationService
   catalog/api/products/route.ts    -> sales/data/entities
   sales/api/channels/route.ts      -> catalog/data/entities
   sales/api/price-kinds/route.ts   -> catalog/api/helpers            (E-7)
   CAUSE: genuine domain entanglement — pricing needs tax, sales channels need products.
          The taxCalculationService dependency is legitimate; the entity and api/helpers
          imports are not.

configs <-> notifications | configs <-> query_index | configs <-> entities
   configs/lib/*        -> {notifications,query_index,entities} internals
   those modules' api/  -> configs/lib/module-config-service
   CAUSE: architectural violation. configs is a settings store; every module legitimately
          reads it. configs should NEVER import a consumer. The configs->X direction
          (upgrade-actions, reindex-helpers, cli) is configs reaching into its consumers.

dictionaries <-> translations | entities <-> translations
   translations/di.ts -> {dictionaries,entities}/translations
   those modules      -> translations/components/TranslationManager
   CAUSE: inverted ownership — see E-5. Fixing E-5 removes both cycles.

customers <-> dashboards | dashboards <-> sales
   */api/dashboard/widgets/utils.ts -> dashboards/lib/widgetScope
   dashboards/seed/analytics.ts     -> {customers,sales,catalog}/data/entities
   CAUSE: accidental — the dashboards SEED file imports every business module's entities to
          fabricate demo data. The widgetScope direction is correct. Moving the seed out of
          dashboards (or behind the query engine) breaks 3 cycles at once.

data_sync <-> integrations
   data_sync/api/{options,run}.ts               -> integrations/lib/{credentials,state}-service
   integrations/backend/integrations/[id]/page  -> data_sync/components/IntegrationScheduleTab
   CAUSE: UI composition again — integrations' page renders data_sync's tab. Widget injection.

sales <-> workflows
   sales/workflows.ts                -> workflows/lib/workflow-safe-commands
   workflows/widgets/injection/…     -> sales/lib/frontend/documentDataEvents
   CAUSE: mostly legitimate — sales declares workflow activities, workflows injects a widget
          into sales. The widget reaching into sales' frontend lib is the improper half.

api_keys <-> auth
   api_keys/api/keys/route.ts   -> auth/{services/rbacService,data/entities,lib/tenantAccess}
   auth/services/rbacService.ts -> api_keys/data/entities
   CAUSE: architectural violation. rbacService — the authorization core — imports api_keys'
          entity to resolve key-based principals. Authorization should not know about one
          specific credential type; api_keys should register a principal resolver.
```

### Longer cycles

296 cycles of length 3–5. They are almost entirely composed of the mutual cycles above plus the platform hubs. The dominant repeating shape:

```
ai_assistant -> core/auth -> core/dashboards -> core/sales -> core/catalog -> ai_assistant
ai_assistant -> core/configs -> core/customers -> ai_assistant
```

`ai_assistant` participates in a large share of them because it imports entities from many modules to build tool schemas, and those modules import its agent/tool definition helpers back.

**Practical impact today: low.** These are ESM cycles across files that Next.js code-splits per route, and none of them is a DI-registration cycle except `translations/di.ts` (E-5). They do not currently break the build. **The real cost is comprehension and change safety** — no module in the affected set can be reasoned about, tested, or extracted in isolation.

---

## H. Shared-Code Findings

`packages/shared` is, on the whole, **appropriately generic** — DI, query engine, CRUD factory, commands, i18n, encryption, boolean/string/date utilities, openapi, telemetry. I did not find business logic dumped into it. Only four files reference concrete business module ids (`lib/auth/jwt.ts`, `modules/search.ts`, `modules/events/{types,factory}.ts`), and those are type-registry declarations, not logic.

What is misplaced runs in the **opposite** direction from the usual anti-pattern: **platform code is sitting inside business modules.**

| Currently in | Actually is | Evidence | Recommendation |
|---|---|---|---|
| `core/directory/utils/organizationScope` | tenant-scope resolution — the request-scoping primitive | imported by `shared/lib/crud/factory.ts`, `shared/lib/commands/types.ts`, and 6 more shared/core sites | move to `shared/lib/auth/`, re-export from directory |
| `core/auth/lib/tenantAccess` | tenancy authorization | imported by directory, api_keys, and others | move to `shared/lib/auth/` |
| `core/entities/lib/{helpers,validation,htmlRichTextSanitizer}` | the EAV engine backing the query engine | imported by `shared/lib/data/engine.ts` | define a custom-field provider port in shared; `entities` implements it (larger job — defer) |
| `core/dictionaries/components/{dictionaryAppearance,DictionaryEntrySelect,AppearanceSelector}` | design-system surface | 47 imports across 5 modules | move to `packages/ui/src/backend/` |
| `core/notifications`, `core/attachments`, `core/progress`, `core/audit_logs`, `core/feature_toggles` | platform services with 9–22 dependants each | see §B | keep where they are, but give them public contracts first (§N) |

One genuine shared-code smell: `packages/shared/src/lib/` has 50+ top-level folders including both `json.ts` and `json/`, both `string.ts` and `string/`, both `search.ts` and `search/`. Low severity, but it makes "where does this belong" ambiguous, which is how utility folders start growing.

---

## I. Security and Multitenancy Findings

**No Critical findings. No confirmed cross-tenant leak.** Tenant isolation here is better engineered than in most codebases of this size, and I want to be precise about both what holds and what the guarantee actually covers.

### What is genuinely strong

- **`packages/shared/src/lib/query/engine.ts` throws if a query has no `tenantId`**, and auto-appends `tenant_id`/`organization_id` predicates when those columns exist — including on joined tables. Isolation is a property of the engine, not of per-call discipline. Guarded by `query/__tests__/engine.tenant-guard.test.ts`, which is mutation-tested.
- **`packages/cache/src/service.ts` rewrites every key** to `tenant:<id>:key:k:<sha256>` from an AsyncLocalStorage context. Callers cannot forget to namespace a cache key.
- **`isOrganizationAccessAllowed` is fail-closed** — restricted principal + unknown target org denies.
- **The `omitAutomaticTenantOrgScope` escape hatch has exactly 2 real uses** (`feature_toggles/api/global/route.ts:121`, `scheduler/api/jobs/route.ts:72`); everything else matching that string is plumbing. Both are legitimately global.
- **Authorization coverage is effectively complete.** Of 480 write-capable API route files, my scan flagged 10 with no visible authorization. On inspection **all 10 were false positives** — they use CRUD route factories that re-export `route.POST`/`route.PUT` with declared `features: { view, manage }`. I found no unguarded write route.
- **SSE broadcast is audience-scoped** (`events/api/stream/route.ts:130-162` matches connections against tenant/org audience before sending).
- **Events carry tenant identity**; subscribers re-derive scope rather than trusting caller input.

### Where the guarantee is narrower than it looks

```
Severity: Medium  (architectural weakness, no confirmed exploit)
```

The engine-level guarantee protects code **that goes through the query engine**. Measured across production code:

```
queryEngine call sites in core modules:                    131
direct em.find/findOne/nativeUpdate/... entity ops:      1,859
   with an explicit tenant/org predicate:                   812
   keyed by primary key ({ id: ... } first):                297
   neither — keyed by some other column:                    488
```

The 488 are **not** 488 vulnerabilities. I sampled them by hand. The overwhelming majority are structurally safe:

- junction-table operations keyed by an already-scoped parent — `nativeDelete(UserRole, { user: userId })`, `nativeDelete(RoleAcl, { role: roleId })`;
- credential lookups where the key *is* the secret — `findOne(ApiKey, { sessionToken })`, `findOne(Session, { token: hashedToken })`;
- mapping-table lookups by a globally unique external id.

I verified the case that looked worst on paper — `chat_matrix/lib/projection.ts:96,131` doing `findOne(ChatMatrixEvent, { eventId })` and `findOne(ChatMatrixRoom, { roomId })` with no tenant predicate. **It is correct.** The `ChatMatrixRoom` mapping row is what *establishes* the tenant; line 145 reads `const scope = { tenantId: room.tenantId, organizationId: room.organizationId }` and every downstream write uses it. An unmapped room is skipped, not guessed at. Matrix room/event IDs are globally unique, so the lookup is sound. **Not a finding.**

The architectural point stands regardless: **tenant safety for 90% of data access rests on per-call-site discipline, while the documentation and the mutation-tested guard describe the 10% that flows through the engine.** No module boundary currently forces a cross-module read onto the safe path. A module reading another module's data via `em.find(OtherEntity, ...)` gets no automatic scoping; the same read via `queryEngine.query('other:entity', ...)` does.

### The known authorization soft spot

`docs/architecture/multi-tenancy.md` records `INV-AUTHZ-001`: authorizing from a raw `loadAcl().features` snapshot instead of `userHasAllFeatures`/`getGrantedFeatures` skips both the enabled-module filter and the org allow-list. It is guarded by `core/src/__tests__/feature-policy-authorization-coverage.test.ts` — but that guard is a **static scan over a hand-maintained list of 18 server roots**. A new package is not scanned until someone adds it to the list, and a decision split across two files is missed. This is a real coverage gap in an otherwise solid control.

### Module boundaries as a tenancy risk

The portal notification bypass (§E-2) is the archetype: a module reached past another module's service into its table, and in doing so dropped an organisation predicate the service applies. It did not produce a cross-tenant leak because `recipientUserId` happened to bind the row. **The next such bypass may not be so lucky.** This is the concrete reason to close the boundary, independent of any purity argument.

---

## J. Frontend Modularity Findings

Frontend boundaries are **better than backend boundaries** — 153 cross-module imports from `.tsx` files versus 1,301 overall — but the same structural gap applies.

**What works:**
- `packages/ui` is a real design system with an enforced token discipline (`eslint.ds.config.mjs`, `packages/eslint-plugin-ds` with 7 custom rules, `check:tokens` parity script, an `om-ds-guardian` review skill). This is stronger DS governance than most codebases have.
- Widget injection decouples UI extension properly — spots are string IDs resolved at runtime, so a module contributing UI to another module does not import it.
- `extension-points.ts` in 25 modules declares each module's open UI surfaces, with a documented rationale. All 66 imports of these files are **self-imports** — consumers find spots through the registry, which is the correct decoupling.
- Route ownership is clean: pages auto-discover from `backend/`/`frontend/` inside the owning module, and portal pages follow the `[orgSlug]/portal/...` convention with `page.meta.ts` RBAC declarations enforced server-side.

**What does not:**
- 93 imports reach into another module's `components/`, 3 into another module's `backend/` page tree (§E-8). `sales` importing `customers/components/detail/hooks/useCurrencyDictionary` and `customers/backend/hooks/useEmailDuplicateCheck` are the deepest.
- No global cross-domain store was found — state is per-feature with React Query-style key modules. Good. But `chat_tasks` importing `tasks/components/queryKeys` means cache invalidation keys are shared across a module boundary with no contract.
- No frontend logic was found bypassing backend module contracts — all data access goes through `apiCall` to module-owned routes.

**Not a finding:** shared design-system usage. `packages/ui` primitives are imported freely and should be.

---

## K. Architecture Enforcement

### What is enforced automatically today

| Control | Mechanism | Covers |
|---|---|---|
| Repo-wide architecture guards | `scripts/repo-wide-guards.mjs` → 12 enumerated tests in `core/src/__tests__/` | sort comparators, module UI gating, workspace closure, MVP module scope, AI declarations, DS tokens, feature-policy authorization, license headers, `@types` classification |
| Optional-module decoupling | `core/src/__tests__/module-decoupling.test.ts` | app boots with catalog, sales, api_keys disabled — **3 modules, hand-maintained fixture** |
| One module contract test | `chat_tasks/__tests__/moduleContract.test.ts` | chat_tasks binds only to chat's and tasks' *declared* extension points |
| Tenant isolation | `query/__tests__/engine.tenant-guard.test.ts` (mutation-tested) | query engine throws without tenantId |
| Entity decorator boundary | ESLint `no-restricted-imports` + `shared/lib/db/__tests__/entity-decorator-boundary.test.ts` | MikroORM decorator shim |
| Design system | `eslint.ds.config.mjs` + `eslint-plugin-ds` (7 rules) + `check:tokens` | colors, arbitrary values, status badges, loading/empty states |
| Client boundaries | `scripts/check-client-boundaries.mjs` | server/client component split |
| CI gates | `.github/workflows/ci-deploy.yml` | lint, typecheck (serial), repo-wide guards, script tests, time bombs, dependency audit, unit tests |

This is a **mature, thoughtful enforcement culture.** The harness, the ratchet pattern, and the "every repo-wide test must be enumerated" discipline in `repo-wide-guards.mjs` are all in place.

### What relies entirely on developer discipline

| Not enforced | Consequence |
|---|---|
| Cross-module imports into internals | 1,301 edges |
| Module dependency cycles | 16 mutual, 296 total |
| Layer direction (`shared` must not import `core`/`ui`) | 18 inversions |
| Declared vs actual dependencies (`requires`) | 174 undeclared, only 16/74 modules declare any |
| Cross-module ORM writes | 83 |
| Package export surface | 10-level wildcard makes every file public |
| Workspace dependency declaration | `shared` imports `core` without declaring it |
| Frontend cross-feature imports | 153 |

**Note the asymmetry.** This repo will fail your PR for using `text-red-500` instead of a status token, but will merge a change where the customer portal rewrites the notifications table by hand. The design system is governed; the module system is not.

---

## L. Recommended Architecture Gates

The smallest set that would prevent regression, fitted to what this repo already runs. All four are additions to `scripts/repo-wide-guards.mjs` in the existing style — **no new tooling, no new CI job, no file moves.**

### Gate 1 — Per-module sealing via the package `exports` map — **IMPLEMENTED**

> An earlier draft of this section proposed a count-based ratchet (`baseline: 1301`, may only
> decrease). That was rejected on review and is recorded here only so the reasoning is not lost:
> a ratchet lets 1,301 violations live forever provided nobody adds the 1,302nd. It formalises
> debt rather than removing it.

What shipped instead. A sealed module maps `./modules/<id>/*` to `null` in its package `exports`
and publishes only `./modules/<id>` and `./modules/<id>/contract`. Node, TypeScript, webpack and
Turbopack all honour `exports`, so the boundary is a **compile error**, verified by probe:

```
src/modules/staff/probe.ts(1,25): error TS2307:
  Cannot find module '@open-mercato/core/modules/invoice/data/entities'
```

Two guards in `scripts/repo-wide-guards.mjs` back it, neither with a baseline:

- `module-seal-integrity.test.ts` — nothing imports a sealed module's internals; no relative path
  escapes into one (the exports map cannot see those); the generated-code-only `internal` subpath
  stays out of hand-written files; **and any module with no remaining deep importers must be
  sealed**. That last rule is the forcing function: the seal follows the code with no number to
  maintain, and cannot drift back.
- `module-contract-purity.test.ts` — a contract may not re-export entities, import another module,
  import an implementation folder, or declare ids outside its namespace.

20 modules are sealed. `scripts/seal-module.mjs` performs the next one. Full rationale and the
rejected alternatives: [ADR-0007](adr/ADR-0007-module-sealing-via-package-exports.md).

### Gate 2 — Layer direction (hard fail, no baseline)

`packages/shared/**` and `packages/{cache,queue,events,telemetry}/**` must not import `@open-mercato/core` or `@open-mercato/ui`. Start with an allowlist of today's 18 violations; remove entries as §M-2 lands.

Pair it with a declared-dependency check: every `@open-mercato/*` import must appear in that package's `package.json` dependencies. The existing `production-install-workspace-closure.test.ts` is the natural home.

### Gate 3 — No new module cycles

Run the 2-node cycle detector over the module graph with a frozen allowlist of today's 16 pairs. New mutual dependencies fail. Cheap to compute (the audit script does it in under a second) and directly prevents the graph degrading further.

### Gate 4 — Cross-module ORM write ban (hard fail on new occurrences)

Static check: a file under `modules/<A>/` that imports an entity class from `modules/<B>/data/entities` must not pass it to `em.create`/`persist`/`nativeUpdate`/`nativeDelete`. Allowlist today's 83, excluding `seed/`, `cli.ts` and `migrate-tps` outright.

This is the gate that would have caught §E-1 and §E-2 at review time.

### Explicitly not recommended

- **madge / dependency-cruiser** — would duplicate what a 60-line guard in the existing harness does, and adds a dependency for a check this repo already has the pattern for.
- **Nx module boundaries** — the repo is Turbo + Yarn workspaces; migrating build tooling for a lint rule is disproportionate.
- **Hard-banning cross-module imports now** — would fail 1,301 edges on day one and be reverted.

---

## M. Prioritised Remediation Plan

Sequenced so every step is independently shippable and reversible. Nothing here requires a rewrite.

### Immediate — correctness and irreversible-decision risk

**M-1. Fix the portal notification bypass (§E-2).**
Delegate the three `customer_accounts` portal handlers to `NotificationService`. This is a live defect — customers see a read-count that does not match their badge, and the badge stays stale. Add one integration spec asserting a push-only notification is not flipped. *~half a day. Confined to 3 files.*

**M-2. Declare `shared`'s real dependencies (§E-4, step 1).**
Add `@open-mercato/core` and `@open-mercato/ui` to `packages/shared/package.json`. **Zero functional change** — it makes an existing dependency visible to Turbo's task graph, which is currently wrong. Do this before anything else touches build ordering. *~1 hour.*

**M-3. Land per-module sealing and its two guards (§L). — DONE.**
20 modules sealed at zero migration cost (nothing imported their internals), the composition root
split onto a reserved `internal` subpath, and the forcing rule in place so every future module
seals itself the moment its last deep importer is migrated. Full gate green: generate,
build:packages, typecheck 26/26, lint 0 errors, test, build:app, repo-wide guards 42 files.

### Next — module boundary correctness

**M-4. Route `staff` → `planner` through the command bus (§E-1).**
Replace `em.create(PlannerAvailabilityRule)` + `persist` with `commandBus.execute('planner.availability.create', ...)`; delete the duplicated indexer config from staff. Expect new `planner.*` events and audit rows — verify no subscriber misbehaves. *~2 days including test updates.*

**M-5. Invert `translations/di.ts` to self-registration (§E-5).**
Each of catalog, dictionaries, entities, resources registers its own translatable fields. Removes 2 of the 16 mutual cycles and the only DI-registration-time cycle. *~1 day.*

**M-6. Move `organizationScope` and `tenantAccess` into `shared/lib/auth/` (§H).**
Re-export from `directory`/`auth` so nothing breaks. Removes the most significant layer inversion and moves the tenant-scoping primitive below the CRUD factory that uses it. *~1 day.*

**M-7. Move the `dashboards` analytics seed out of `dashboards` (§G).**
It imports customers', sales' and catalog's entities purely to fabricate demo data, and single-handedly sustains 3 mutual cycles. Either move it to a dev-only fixtures package or have it write through commands. *~1 day.*

**M-8. Land Gate 2 and Gate 4 with allowlists (§L).** *~1 day.*

**M-9. Give the top-5 platform modules a public contract (§N).**
`auth`, `directory`, `notifications`, `attachments`, `entities` — 118 dependants between them. Declaring their surface unblocks the largest share of the 1,301 edges. Additive only; nothing moves. *~1 week.*

### Later — structural cleanup

**M-10.** Convert `auth` → `notifications` (password reset) to an event, per the pattern already used 33 times elsewhere. Removes a mutual cycle.
**M-11.** Register an api_keys principal resolver so `rbacService` stops importing `api_keys/data/entities`.
**M-12.** Promote `dictionaries` components and `AddressEditor`/`useCurrencyDictionary` to `packages/ui` (§E-8, §E-9).
**M-13.** Move `sanitizeSearchTerm`/`parseBooleanFlag` to `shared/lib/http` (§E-7).
**M-14.** Backfill `requires` on the 45 modules with undeclared dependencies; make it a gate once the graph is accurate.
**M-15.** Narrow `packages/core/package.json` wildcard exports — **last**, only after callers have migrated. Doing it early breaks the build in a hundred places.
**M-16.** Add integration tests for `appointments` and `chat_matrix` (the two substantial modules with none).
**M-17.** Define a custom-field provider port in `shared` so `data/engine.ts` stops importing `core/entities` (§E-4, step 3).

---

## N. Target Module Pattern

**Do not adopt `public/ application/ domain/ infrastructure/`.** It does not fit this repo. Module layout here is fixed by auto-discovery — the generator finds `api/`, `backend/`, `frontend/`, `subscribers/`, `workers/`, `widgets/`, `migrations/` by path, and moving them breaks routing, event dispatch and page resolution. Restructuring would be a rewrite in violation of §28 of the brief.

The repo already has the right idea half-built. `extension-points.ts` exists in 25 of 47 core modules and is documented as *"Surfaces this module opens to other modules"* — it is simply limited to UI injection hosts. **Extend that, and keep everything else where it is.**

### Proposed structure (additive; existing layout unchanged)

```
packages/core/src/modules/<module>/
  index.ts              EXISTING — ModuleInfo descriptor. Add accurate `requires`.
  contract.ts           NEW — the module's public surface. The ONLY file other modules import.
  extension-points.ts   EXISTING — UI injection hosts. Unchanged.
  acl.ts                EXISTING — feature ids (already public by convention).
  events.ts             EXISTING — event definitions (already a contract).
  commands/             EXISTING — command handlers (already a contract; keep exporting ids).
  api/  backend/  frontend/  subscribers/  workers/  widgets/  migrations/   EXISTING, INTERNAL
  data/  lib/  services/  utils/  components/                                EXISTING, INTERNAL
```

`contract.ts` declares, and re-exports, only what the module intends others to use:

```typescript
// packages/core/src/modules/planner/contract.ts
import { defineModuleContract } from '@open-mercato/shared/modules/contract'

export const contract = defineModuleContract({
  moduleId: 'planner',

  // Writes — addressed through the command bus, never by importing a handler.
  commands: [
    'planner.availability.create',
    'planner.availability.delete',
    'planner.availability.weekly.replace',
    'planner.availability.date-specific.replace',
  ],

  // Reads — entity ids for queryEngine.query(), which enforces tenancy.
  // Other modules read planner data through these, not through data/entities.
  readModels: ['planner:planner_availability_rule', 'planner:planner_availability_rule_set'],

  // Events other modules may subscribe to.
  events: ['planner.availability.created', 'planner.availability.deleted'],
})

// Types other modules legitimately need — NOT the ORM entity class.
export type { AvailabilityRuleView } from './lib/views'
```

### Allowed-import rules per layer

| Layer | May import |
|---|---|
| `contract.ts` | `shared/*`, own `lib/`, own `acl.ts`, own `events.ts`. **Never** another module. |
| `api/`, `backend/`, `frontend/` | own module freely; other modules **only** via their `contract.ts`; `ui`; `shared` |
| `commands/`, `services/`, `lib/` | own module freely; other modules **only** via `contract.ts` or the command bus; `shared` |
| `data/` | own module + `shared` only. **Never** another module's `data/`. |
| `components/` | own module; `packages/ui`; other modules **only** via `contract.ts` |
| `subscribers/`, `workers/` | own module; other modules via `contract.ts`; subscribe by **event id string**, never by importing the producer |
| `migrations/` | own tables only. Extending another module's table → `data/extensions.ts`. |
| `packages/shared`, `cache`, `queue`, `events`, `telemetry` | **never** `@open-mercato/core` or `@open-mercato/ui` |

### Adoption path

Start with the five platform modules in M-9 (`auth`, `directory`, `notifications`, `attachments`, `entities`) — 118 dependants between them, so declaring their surface addresses the largest share of violations first. `chat_tasks/__tests__/moduleContract.test.ts` already demonstrates the contract-test pattern; generalise it as each contract lands.

---

## O. Allowed Dependency Rules

Adapted to what this codebase actually is.

> **RULE 1 — Internals are private.**
> A module may not import another module's `data/`, `services/`, `lib/`, `utils/`, `components/` or `api/`. Cross-module imports go through the target's `contract.ts`, `acl.ts`, `events.ts`, or its exported `commands/`.
> *Enforced by: Gate 1 (ratchet), tightening to a hard ban per module as contracts land.*

> **RULE 2 — A module writes only its own tables.**
> Never import another module's entity class to `create`, `persist`, `nativeUpdate` or `nativeDelete`. Cross-module writes go through the owning module's command. Cross-module reads go through `queryEngine.query(entityId, ...)`, which enforces tenancy; importing the ORM class does not.
> *Exception, documented: `seed/`, `cli.ts`, and dedicated importer packages (`migrate-tps`, `sync-akeneo`).*
> *Enforced by: Gate 4.*

> **RULE 3 — Dependencies point down, and are declared.**
> `shared`, `cache`, `queue`, `events`, `telemetry` must never import `core` or `ui`. Every `@open-mercato/*` import must appear in that package's `package.json` dependencies, and every cross-module dependency must appear in the module's `requires`.
> *Enforced by: Gate 2.*

> **RULE 4 — Shared holds infrastructure, not domain — and domain does not hold infrastructure.**
> Business logic must not move into `shared`. Equally, platform primitives (tenant scoping, authorization, encryption) must not stay inside a business module once `shared` depends on them.

> **RULE 5 — No new module cycles.**
> The existing 16 mutual pairs are allowlisted and shrinking. New ones fail CI.
> *Enforced by: Gate 3.*

> **RULE 6 — Tenant and authorization context crosses every boundary.**
> A cross-module call carries tenant and organisation scope explicitly and re-derives authorization at the callee. A module API never trusts a caller-supplied `organizationId`. Reaching past a module's service into its table is prohibited specifically because it drops the scoping that service applies — this is not hypothetical (§E-2).

> **RULE 7 — Frontend features are private too.**
> A feature may not import another feature's `components/detail/**`, hooks, or anything under `backend/`. `packages/ui` is shared and free to use. A component needed by three or more modules belongs in `packages/ui`.

> **RULE 8 — UI extension is injection, not import.**
> To render inside another module, contribute a widget to a declared spot. Never import that module's page or component tree.

> **RULE 9 — Async integration is by event id.**
> Subscribe to `module.entity.action` strings. Never import the producing module to subscribe to it.

> **RULE 10 — Boundaries are ratcheted, not declared.**
> Every rule above is backed by a check in `scripts/repo-wide-guards.mjs` with a committed baseline that may only decrease. A rule with no gate is a comment.

---

## Appendix — Verification Notes

Claims corrected during the audit, recorded so the report is not read as more alarming than the code warrants:

- **`chat_matrix` external-ID lookups are correct**, not a tenancy hole. The `ChatMatrixRoom` mapping row establishes tenant scope (`projection.ts:145`); unmapped rooms are skipped.
- **All 10 "unguarded write route" candidates were false positives.** They use CRUD factories re-exporting `route.POST`/`route.PUT` with declared `features`. Authorization coverage is effectively complete.
- **`command-bus.ts` → `audit_logs` imports are type-only**; runtime resolution is through DI. Compile-time coupling only — classified Low, not grouped with the value-import inversions.
- **`invoice`'s `organizations.tax_code` migration causes no schema drift** — `directory/data/entities.ts:105-106` declares the column. Only the down-migration is misplaced.
- **488 "unscoped" direct ORM calls are not 488 vulnerabilities.** Hand-sampled: junction tables keyed by a scoped parent, credential lookups where the key is the secret, and mapping lookups by globally unique external id.
- **`docs/architecture/multi-tenancy.md`'s claim that core contains zero direct `em.find` calls outside tests is now stale** — there are 1,859 direct entity operations in production code, concentrated in modules added after that note was written. The centralised guarantee still holds for code that uses the query engine; it simply covers less of the codebase than it did.
