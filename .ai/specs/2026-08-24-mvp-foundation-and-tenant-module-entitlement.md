# MVP Foundation: Reproducible Bootstrap and Tenant Module Entitlement

**Date:** 2026-08-24
**Status:** Implemented
**Modules:** `auth`, `directory`, `configs`, `cli`

## Problem

Operis inherited a complete authentication, RBAC and multi-tenancy stack from
Open Mercato, but three things stood between it and a reproducible MVP:

1. **No committed development topology.** The local database held four tenants
   created ad hoc by earlier sessions. `mercato init` produces a single tenant
   whose primary user is *both* platform superadmin and tenant member, so there
   was no seeded example of the platform-vs-tenant separation the product needs,
   and nothing in source recreated the working environment.
2. **No tenant↔module association.** Module visibility derived purely from a
   tenant's role ACL grants. There was no way to express "Acme has WMS, Globex
   does not" independently of what any individual user is allowed to do, and so
   no seam for a future licensing or subscription layer.
3. **No unauthenticated health probe.** `/api/configs/system-status` requires
   `configs.system_status.view`, so a load balancer or a developer verifying a
   fresh clone had nothing to call.

## Decisions

### Platform superadmin lives in its own company

The platform superadmin is seeded into a dedicated **Operis** tenant, separate
from every customer tenant. Business tenants are created with
`includeSuperadminRole: false`, so the `superadmin` role — the only role carrying
`RoleAcl.isSuperAdmin` — **does not exist** inside them. A tenant administrator
therefore cannot escalate into platform administration by construction, not by
policy: there is no role row to attach.

This reuses the existing mechanism (`RoleAcl.isSuperAdmin` plus the
`om_selected_tenant` / `om_selected_org` scope cookies handled by
`applySuperAdminScope`). No second authorization mechanism was introduced.

### Entitlement is a distinct layer, evaluated before grants

`tenant_modules (tenant_id, module_id, is_enabled)` records which business
modules a tenant has. `RbacService` consults it **before** matching grants and
**before** the super-admin bypass, mirroring the existing policy order in which
removed and disabled features already deny ahead of `unrestricted`.

```
Tenant ──< tenant_modules (module_id, is_enabled)
                │  checked FIRST, fail-closed
                ▼
        RoleAcl / UserAcl grants
                │
                ▼
   page + API + sidebar visibility
```

`RbacService` is the single seam: `userHasAllFeatures`, `getGrantedFeatures`,
`getEffectiveFeatures` and `tenantHasFeature` all pass through it, which is why
one change covers API guards, page guards, and the navigation payload without
touching any of them individually.

**Fail-closed:** a business module is reachable only when an enabled row exists.
A missing row denies, so shipping a new module never silently exposes it to
every existing tenant.

Two deliberate exemptions keep fail-closed from becoming a lockout:

- **Platform modules** (`PLATFORM_MODULE_IDS` — `auth`, `directory`, `configs`,
  `entities`, …) are never gated. Gating `auth` would revoke a tenant's ability
  to log in and be administered.
- **When the module registry is not bootstrapped**, entitlement stands down.
  Owning-module resolution needs the registry; without it `getOwningModuleId`
  degrades to a feature's dotted prefix, which is not reliably a module id
  (`users.view` is owned by `auth`). Deciding access on that guess would deny
  real grants in route unit tests, CLI subcommands and partial bootstraps. This
  mirrors what `filterGrantsByEnabledModules` already does for the deploy-level
  module filter.

Every tenant-creation path provisions rows: `setup.ts` `onTenantCreated` and
`seedDefaults` (covering `mercato init` and `mercato auth setup`), the
`directory.tenants.create` command (covering the admin UI), and `seed:dev`.
`mercato directory sync-tenant-modules` backfills tenants that predate a newly
added module.

### One seed, additive to `mercato init`

`mercato seed:dev` is new and idempotent; `mercato init` is untouched, so no
existing workflow or test changes behaviour.

| Company | Account | Role | Purpose |
|---|---|---|---|
| Operis (platform) | `admin@operis.local` | `superadmin` | Platform Superadmin |
| Acme | `admin@acme.local` | `admin` | Tenant Administrator |
| Acme | `user@acme.local` | `employee` | Tenant User |
| Globex | `admin@globex.local` | `admin` | Second tenant for isolation testing |
| Globex | `user@globex.local` | `employee` | Second-tenant user |

Globex withholds `wms` so entitlement has an observable effect.

## Changes

| File | Change |
|---|---|
| `directory/data/entities.ts` | New `TenantModule` entity |
| `directory/migrations/Migration20260823160620_directory.ts` | `tenant_modules` table, unique `(tenant_id, module_id)`, FK, index |
| `directory/lib/tenantModules.ts` | `TenantModuleService`, `PLATFORM_MODULE_IDS`, `isEntitleableModule`, `isEntitlementEnforceable` |
| `directory/di.ts` | Registers `tenantModuleService` |
| `directory/setup.ts` | Provisions entitlement in `onTenantCreated` / `seedDefaults` |
| `directory/commands/tenants.ts` | Provisions entitlement on UI tenant creation |
| `directory/cli.ts` | `sync-tenant-modules`, `list-tenant-modules`, `set-tenant-module` |
| `directory/api/tenant-modules/route.ts` | GET/PUT entitlement, gated by `directory.tenants.view` / `.manage` |
| `directory/backend/.../tenants/[id]/modules/` | Superadmin page to view and toggle entitlement |
| `auth/services/rbacService.ts` | Entitlement check ahead of grants and the super-admin bypass |
| `auth/lib/setup-app.ts` | Extracted idempotent `ensureTenantUser`; fixed `orgSlug` re-run abort; role-grant log moved to debug |
| `auth/lib/seed-dev.ts` | Development topology and `seedDevEnvironment` |
| `auth/di.ts` | Fixed latent `Could not resolve 'cradle'` crash under `OM_RBAC_DEFAULT_CACHE=on` |
| `configs/api/health/route.ts` | Unauthenticated liveness/readiness probe |
| `cli/src/mercato.ts` | `seed:dev` command |
| `scripts/verify-mvp.sh` | 33 end-to-end MVP assertions |

## Demo-readiness fixes (second pass)

- **The login form's submit button was unreachable.** The global notice bars
  (cookie consent + demo-instance warning) are `fixed` to the bottom of the
  viewport and overlay page content. The login card is vertically centred, so at
  1280×720, 1366×768 and 1440×900 the notices sat on top of the password field
  and covered "Sign in" entirely — an automated click could not reach it.
  Fixed by reserving bottom space on the login container (`pb-56`) and by
  defaulting `DEMO_MODE=false`.
- **`DEMO_MODE=true` shipped in `.env.example`.** That flag marks an instance as
  a throwaway public demo: it renders a banner saying data may be reset at any
  time and telling visitors to "Install Open Mercato locally". Upstream ships it
  on for its hosted demo; a self-hosted Operis install is not that.
- **`.husky/pre-commit` invoked `yarn template:sync:fix`**, a script this fork
  deleted along with `packages/create-app`. Every commit aborted. Removed.
- **Turbo stripped environment overrides.** `globalEnv` listed only `NODE_ENV`,
  and Turbo runs in strict env mode, so `DATABASE_URL=… yarn db:migrate`
  silently migrated whatever `.env` pointed at *and reported success*. Added
  `globalPassThroughEnv` for the runtime/secret variables.
- **`db greenfield` was mistaken for a data reset.** It also deletes every
  migration file and snapshot from the source tree. Its warning now says so, and
  a real `mercato db reset` was added for the common case.
- **A crashed jest worker aborted the whole test run**, silently skipping every
  package after it and masking two real failures behind a green-looking summary.
  The root `test` script now passes `--continue`.

## Bugs fixed along the way

- **`setupInitialTenant` was not re-runnable with `orgSlug`.** The slug
  uniqueness pre-check fired even when reusing the same tenant, so a second run
  with unchanged inputs aborted with `ORG_SLUG_EXISTS`. It now ignores a slug
  that belongs to the tenant being reused.
- **`auth/di.ts` crashed under `OM_RBAC_DEFAULT_CACHE=on`.** The container uses
  Awilix CLASSIC injection, which resolves a factory's *parameter names*; the
  `cradle` parameter was looked up as a registration and threw
  `Could not resolve 'cradle'`, taking down every RBAC check. Fixed with
  `.proxy()`. Reproduced and verified.

## Testing

- `directory/__tests__/tenantModules.test.ts` — 13 tests: platform-module
  exemption, enabled-row resolution, grant filtering, wildcard handling,
  `provisionTenant` idempotency, operator-disabled modules surviving re-runs.
- `auth/services/__tests__/rbacService.entitlement.test.ts` — 9 tests: denial
  ahead of the super-admin bypass, platform modules never gated, capability
  payload filtering, unprovisioned-tenant denial, tenant-less stand-down.
- `scripts/verify-mvp.sh` — 33 live assertions across all Definition-of-Done
  scenarios.
- `directory/__integration__/TC-MVP-001-demo-journey.spec.ts` — 7 Playwright
  cases driving the real browser journey: superadmin vs tenant-admin
  separation, entitlement shaping navigation, cross-tenant isolation, logout,
  and a shell load per role asserting no unhandled page exception. The spec
  skips itself when the `seed:dev` topology is absent, so it stays safe on a
  `mercato init` database (which the rest of the integration suite targets).

## Known gaps

- Entitlement is enforced through `RbacService`. A code path that reads
  `RoleAcl.featuresJson` directly, bypassing the service, would bypass
  entitlement too. The repository already forbids that (`AGENTS.md` § Access
  Control), but it is not mechanically enforced.
- `PLATFORM_MODULE_IDS` is a hand-maintained list. A new infrastructure module
  is entitleable by default until added to it — fail-closed, so the failure mode
  is "denied until provisioned", not "silently exposed".
- Withholding a module hides its navigation and denies its APIs; it does not
  delete data the tenant already created in that module.

## Superseded detail (2026-08-25)

`provisionTenant` no longer switches every module on. Each module declares
whether a newly provisioned tenant receives it
(`ModuleInfo.defaultEntitlement`, absent = off), so the "Every tenant-creation
path provisions rows" statement above still holds while the rows it writes now
follow the shipped plan. `mercato directory sync-tenant-modules --apply-defaults`
reconciles existing tenants; `--enable-all` is the test-environment override.
`design_system`, `api_docs` and `api_keys` left `PLATFORM_MODULE_IDS` and are now
entitleable. See `.ai/specs/2026-08-25-mvp-module-scope-and-ui-gating.md`.
