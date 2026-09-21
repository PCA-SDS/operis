# Tenant Lifecycle and Isolation Hardening

- **Date:** 2026-09-16
- **Status:** Implemented
- **Origin:** Access-control QA review of `main @ a99a32b2`. Four defects were
  confirmed by execution against a running instance with synthetic tenants, plus
  a set of high-severity findings confirmed by code inspection.

## Problem

The tenancy model documented in [`docs/architecture/multi-tenancy.md`](../../docs/architecture/multi-tenancy.md)
is sound and its primary control — the fail-closed query engine — works. The
defects below are gaps *around* that control, not in it.

| Id | Defect | Evidence |
|---|---|---|
| F1 | `turbopackMinify: true` renames constructor parameters; the Awilix container runs `InjectionMode.CLASSIC`, which resolves dependencies **by parameter name**. `container.resolve('authService')` throws `Could not resolve 'e'`, so **login returns 500 in any optimized build**. | Reproduced in a clean production build and in dev; toggling the flag flips the outcome both ways. |
| F2 | `exportScope=full` substitutes `{}` for `buildFilters`. On routes that set `omitAutomaticTenantOrgScope: true`, `buildFilters` is the *only* tenant predicate, so the export crosses tenants. | As a tenant-scoped admin holding only `scheduler.jobs.view`: 8 rows → 28 rows, 16 of them owned by two other tenants. |
| F3 | `directory.organizations.update` derives the tenant to authorize against from `parsed.tenantId` (request body) before falling back to the record, then writes by `id` alone. | `PUT` with a foreign org id + the caller's **own** `tenantId` returned 200 and renamed another tenant's organization. Without the body field: 403. |
| F4 | `resolveCanonicalStaffAuthContext` re-reads `User` and `Session` per request but never loads `Tenant` or `Organization`, so `is_active` / `deleted_at` on those rows are inert. | Tenant suspended, tenant soft-deleted, and organization deactivated all left existing sessions working **and allowed fresh logins**. Control: disabling a *user* correctly 401s. |
| F6 | API-key principals short-circuit canonical re-resolution, so `isConfirmed` is never checked and roles come from a creation-time snapshot. | `server.ts:290`, `sessionIntegrity.ts:33`. |
| F8 | `POST /api/auth/logout` identifies the session from the cookie only; a bearer-only call leaves the session live. | Cookie logout → 401 after. Bearer-only logout → token still 200. |

## Decisions

1. **Suspension is a tenant-user lockout, not a platform lockout.** A suspended
   or soft-deleted tenant denies its own members, but a platform super-admin
   keeps access — otherwise a suspended tenant can never be reactivated through
   the application, and support cannot investigate. This matches how commercial
   multi-tenant platforms treat suspension. The check therefore runs against the
   **actor's home tenant/organization**, not the tenant a super-admin has
   selected.
2. **The access boundary is never dropped by an export.** Rather than add an
   `$and` combinator to the query engine (a much larger change — the engine
   supports exactly one top-level `$or`), encode the invariant directly: user
   filters may only be dropped while the engine is still applying its automatic
   tenant predicate. A route that opted out of auto-scope keeps its own filters
   under every export scope.
3. **Tenant ownership is derived from the stored record, never from the
   request.** `directory.organizations.update` adopts the shape its own delete
   path already uses.
4. **F1 is fixed by disabling the minifier, not by refactoring DI.** With
   Turbopack, `turbopackMinify` governs server output too — `serverMinification:
   false` does not constrain it, which the existing comment assumes and the
   runtime contradicts. Making all 17 `asClass` registrations plus the
   named-parameter `asFunction` registrations minification-proof is the deeper
   fix and is recorded as follow-up; it is not required for correctness and
   carries broad regression risk across 15 modules.

## Changes

### F1 — restore sign-in under an optimized build
- `apps/mercato/next.config.ts` — `turbopackMinify: false`, with the comment
  corrected to record the measured behaviour instead of the assumption.
- New guard test resolving every DI registration, so a name-dependency
  regression fails in CI rather than in production.

### F4 — enforce tenant and organization lifecycle at request time
- `packages/core/src/modules/auth/lib/sessionIntegrity.ts` — load `Tenant` and
  `Organization` in the existing `Promise.all` (no extra round trip) and reject
  when either is soft-deleted or inactive, unless the resolved principal is a
  super-admin. Rejection returns `null`, which the dispatcher renders as 401.
- `packages/core/src/modules/auth/api/login.ts` — refuse to mint a session for a
  suspended or deleted tenant/organization, with the existing uniform
  invalid-credentials response so the check is not an oracle for tenant state.

### F2 — keep the access boundary on full exports
- `packages/shared/src/lib/crud/factory.ts` — on both the query-engine and ORM
  branches, apply `buildFilters` regardless of export scope whenever
  `omitAutomaticTenantOrgScope` is set.

### F3 — bind the organization update to the stored record
- `packages/core/src/modules/directory/commands/organizations.ts` — derive the
  tenant from the loaded entity, and add the tenant predicate to the update
  `where`.

### F8 — revoke on bearer-authenticated logout
- `packages/core/src/modules/auth/api/logout.ts` — fall back to the bearer
  token's `sid` when no session cookie is present.

### F6 — apply account state to API keys
- `packages/shared/src/lib/auth/server.ts` — reject a key whose owning user is
  unconfirmed, and invalidate the key auth cache on revocation.

### Also fixed — same root cause as F3, found while implementing

- `packages/core/src/modules/sales/commands/tags.ts` — `sales.tags.update` carried the
  identical `parsed.tenantId ?? record.tenantId` shape, and was the only one of thirteen
  files in `sales/commands/` missing `ensureOrganizationScope`. It additionally let the
  request body rewrite the row's `tenantId`/`organizationId`, moving a tag between
  tenants. Now authorizes against the stored scope, ignores a body `tenantId`, and
  re-checks scope before any organization re-homing.
- `packages/core/src/modules/auth/commands/users.ts` — `auth.users.create` validated the
  destination tenant but not the organization allow-list, so an admin restricted to one
  organization could create users in a sibling. `auth.users.update` already enforced this;
  create now applies the same fail-closed predicate with the same 400.

### The same false-green appeared in three places

F1 reached production green because the check meant to catch it could not fail. The identical
inference — reading `POST /api/auth/login -> 400` as proof that the DI container resolved —
was written into three separate guards. `/api/auth/login` accepts form-encoded bodies only, so
a JSON probe fails zod and returns 400 at `login.ts:104`, three lines **before**
`container.resolve('authService')` at `login.ts:107`. All three are corrected:

| Where | Was | Now |
|---|---|---|
| `apps/mercato/src/__tests__/client-bundle-minification.test.ts` | asserted `turbopackMinify: true` | pins the coupling: no minifier while the container uses `InjectionMode.CLASSIC` |
| `scripts/__tests__/minification-di-safety.test.mjs` | released the `turbopackMinify` interlock on a "CORRECTION" citing the 400 as proof | correction withdrawn with the re-measurement; both flags interlocked again |
| `.github/workflows/ci-deploy.yml` → deploy smoke test | posted **JSON** and treated any non-5xx as "auth path OK" | posts form-encoded so it reaches the container; **400 is now fatal** |

The deploy smoke test is the most consequential of the three: it is the only external
verification of a production deploy, its own comment states the intent correctly ("a 401 proves
the container resolved authService"), and its implementation could not produce a 401.

### Guard test corrected

`apps/mercato/src/__tests__/client-bundle-minification.test.ts` asserted
`turbopackMinify: true` — it pinned the setting that caused the outage, on the premise
that the flag was client-only. It now pins the actual invariant: while
`InjectionMode.CLASSIC` is in use, neither minifier may be enabled. It also records that
only a `200` from a credentialed, form-encoded sign-in proves the container resolved —
the previous probe accepted a `400`, which is returned before the container is touched.

## Out of scope

Recorded in the review, deliberately not addressed here: F5 (AI-assistant
identity binding — needs runtime verification first), F9 (business-rules
confused deputy), F10 (SSE re-authorization), F12 (attachment record-level
checks), F15 (field-level permissions — a product decision), and the
deployment-configuration items. Each needs its own change with its own tests.

## Verification

Every fix is re-tested with the exact probe that demonstrated the defect, plus
the negative control that isolated it. Unit suites for auth, RBAC, tenancy and
the CRUD factory must stay green.
