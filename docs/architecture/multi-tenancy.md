# Multi-Tenancy — The Canonical Model

> **Status:** baseline as inherited from the Open Mercato fork point, verified
> against the code on 2026-08-23. This is the authoritative description of how
> tenancy works in Operis. Where a claim below cites a file, that file is the
> source of truth; if they diverge, the code wins and this document is the bug.

## 1. The hierarchy

```
Platform                     — the deployment itself; no DB row
  └── Tenant                 — tenants table; the hard isolation boundary
        └── Organization     — organizations table; a TREE within one tenant
              └── Resources  — rows carrying tenant_id (+ usually organization_id)

User ──< memberships/roles ──< role ACLs + user ACLs ──< features
```

### Tenant

`packages/core/src/modules/directory/data/entities.ts` → `Tenant`

| Column | Notes |
|---|---|
| `id` | uuid, `gen_random_uuid()` |
| `name` | text |
| `is_active` | boolean, default true |
| `created_at` / `updated_at` / `deleted_at` | soft delete via `deleted_at` |

A tenant is **the security boundary**. No user-facing request may read or write
a row belonging to another tenant. Everything else in this document is refinement
*inside* that boundary.

### Organization

`packages/core/src/modules/directory/data/entities.ts` → `Organization`

Organizations form a **tree scoped to exactly one tenant**. The tree is
materialized (denormalized) rather than walked per query:

| Column | Purpose |
|---|---|
| `tenant_id` | owning tenant (FK → `tenants`) |
| `parent_id` | direct parent, `null` at the root |
| `root_id` | root of this org's tree |
| `tree_path` | text path |
| `depth` | int, 0 at root |
| `ancestor_ids` | jsonb array |
| `child_ids` | jsonb array (direct children) |
| `descendant_ids` | jsonb array (transitive) |
| `slug` | unique **per tenant** — `organizations_tenant_slug_uniq` on `(tenant, slug)` |

That unique constraint is the pattern the rest of the schema should follow:
tenant-scoped uniqueness, not global uniqueness.

## 2. Tenant vs. organization — two different boundaries

These are routinely conflated and must not be:

| | Tenant boundary | Organization boundary |
|---|---|---|
| Nature | **Security**. Crossing it is a vulnerability. | **Visibility**. Crossing it is an authorization decision. |
| Enforced by | Query engine auto-scope + tenant-derived context | Org allow-list on the principal's ACL |
| Bypass | Only deliberate platform-level operations | Normal: a tenant-wide role sees the whole tree |

A user always belongs to one tenant *in a given session*, but may see only part
of that tenant's organization tree.

## 3. Where enforcement actually lives

### 3.1 The query engine (primary mechanism)

`packages/shared/src/lib/query/engine.ts`

This is the load-bearing control, and it is **fail-closed**:

- A query with no `tenantId` **throws** — it does not silently return everything:

  ```
  QueryEngine: tenantId is now required for all queries (breaking change).
  ```

- When the target table has a `tenant_id` column, the engine appends
  `tenant_id = :tenantId` automatically. Same for `organization_id` via the
  resolved organization scope.
- Joined tables are scoped too, not just the base table.

Measured at the fork point: **112** call sites go through the query engine in
`packages/core`, and **zero** direct `em.find` / `em.findOne` / `getRepository`
calls exist in core outside tests. Scoping is therefore centralized in practice,
not merely by convention.

### 3.2 The silent non-coverage — tables with no `tenant_id` column

The auto-scope is conditional on the column existing:

```ts
if (!skipAutoScope && opts.tenantId && await this.columnExists(table, 'tenant_id')) {
  q = q.where(qualify('tenant_id'), '=', opts.tenantId)
}
```

If the table has **no** `tenant_id` column, no predicate is added — and nothing warns.
The tenant guard (§3.1) still fires, so a query cannot run *unscoped*, but the scope
is not applied to that table.

Measured against the migrated schema (292 tables):

| | Count |
|---|---|
| Tables total | 292 |
| Carry `tenant_id` | 231 |
| Carry `organization_id` | 221 |
| **No `tenant_id`** | **61** |

Those 61 break down as:

- **43** `mikro_orm_migrations_*` — migration bookkeeping, correctly global
- **`tenants`** — is the boundary
- **Junction tables** — `user_roles`, `customer_user_roles`, `customer_deal_people`,
  `customer_deal_companies`, `message_recipients`, `message_objects`
- **Session / token tables** — `sessions`, `password_resets`, `customer_user_sessions`,
  `customer_user_password_resets`, `customer_user_email_verifications`,
  `message_access_tokens`
- **`feature_toggles`, `feature_toggle_audit_logs`** — instance-global by design
- **`example_items`** — demo module

None is an obvious leak: junctions and session rows inherit tenancy through their
foreign keys. But it means **their isolation is inherited, not enforced** — a query
that joins a junction table without scoping the parent gets no protection from the
engine. Treat these tables as requiring the parent to be scoped explicitly.

### 3.3 The documented bypass

`omitAutomaticTenantOrgScope` (declared in `packages/shared/src/lib/query/types.ts`)
disables the automatic guards. It exists for entities whose scoping is not a plain
`organization_id = X AND tenant_id = Y` (e.g. rows visible to both a tenant and
globally, expressed as an `$or`).

Its contract, quoted from the type:

> Callers MUST encode full visibility in `filters` … and MUST fail closed when the
> authenticated principal lacks a resolvable tenant/org, otherwise queries return
> cross-tenant rows.

**There are exactly 2 places that actually set the flag** (a wider grep also matches
the plumbing in `crud/factory.ts`, `query_index/lib/engine.ts` and `query/types.ts`,
which pass it through rather than enabling it). Both were audited on 2026-08-23 and
both fail closed:

| Site | Why it bypasses | Fail-closed? |
|---|---|---|
| `core/…/feature_toggles/api/global/route.ts` | `feature_toggles` is instance-global — it has **no `tenant_id` column** (§3.2), so an automatic tenant predicate would hide every row | Yes — nothing tenant-owned is reachable |
| `scheduler/…/api/jobs/route.ts` | Jobs are visible at organization, tenant, **or** system scope, which is an `$or`, not a flat equality | Yes — see below |

The scheduler's `buildFilters` is the reference implementation for this pattern:

```ts
const tenantId = ctx.auth?.tenantId
if (!tenantId) {
  filters.id = { $eq: '00000000-0000-0000-0000-000000000000' } // matches nothing
  return filters
}
```

Missing tenant context yields an impossible filter rather than an unscoped read, and
every visibility branch pins `tenant_id`. The only branch with `tenant_id: null` is the
`system` scope, and it is gated on `isSuperAdmin`.

Treat this list as a standing audit target: any *new* use of the flag is the
highest-value place to look for a leak.

### 3.4 Organization access

`packages/shared/src/lib/auth/organizationAccess.ts` — `isOrganizationAccessAllowed`
is the single fail-closed predicate for "may this principal act on this org":

| Condition | Result |
|---|---|
| `isSuperAdmin` | allow |
| `allowedOrganizationIds === null` | allow (genuinely unrestricted) |
| restricted, no target org | **deny** — an unknown scope is not a bypass |
| restricted, target org | allow iff the target is in the allowed set |

`packages/shared/src/lib/auth/organizationScope.ts` — `resolveActiveOrganizationId`
resolves "which org is this request acting in" when an operator has selected
"all organizations". It deliberately refuses to fall back to the actor's own org
when a super-admin has also switched tenants, because that would persist a
cross-tenant `{organizationId, tenantId}` pair. Unresolvable scope answers **400**,
never 401 — a 401 would be read as an expired session and cause a refresh loop.

### 3.5 Tenant-scoped uniqueness

Verified against the migrated schema — uniqueness is correctly scoped to the tenant
rather than global:

```sql
-- users
UNIQUE (tenant_id, email_hash) WHERE deleted_at IS NULL AND email_hash IS NOT NULL
-- organizations
UNIQUE (tenant_id, slug)
```

Two tenants may therefore both have `alice@example.com`, which is the correct SaaS
semantic. The partial predicate also means a soft-deleted user does not permanently
consume their email within the tenant.

Note `users.tenant_id` is **nullable** — the schema permits a user not bound to a
tenant. Any code reading `user.tenantId` must handle null rather than assume it.

## 4. Authorization (RBAC)

`packages/core/src/modules/auth/services/rbacService.ts`

- Two layers: **role ACLs** and **user ACLs**, both per tenant.
- `is_super_admin` is a column on **`role_acls` and `user_acls`** — *not* on `users`.
  Super-admin is therefore a grant on an ACL record, not an intrinsic user property,
  and is resolved per `{tenantId, organizationId}` scope like any other grant.
- Features are declared per module in `<module>/acl.ts`, named `<module>.<action>`.
  Every core module ships one (44 core modules at the fork point).
- Server-side check: `rbacService.userHasAllFeatures(userId, features, { tenantId, organizationId })`.
- Wildcards (`packages/shared/src/lib/auth/featureMatch.ts`): `*` grants everything;
  `prefix.*` grants `prefix` and everything under `prefix.`; otherwise exact match.
- Policy order: invalid scope and disabled features **deny before** super-admin or
  wildcard grants are considered.

### The known sharp edge

`loadAcl()` returns a feature snapshot. Authorizing by reading
`loadAcl().features` directly applies **neither** the enabled-module filter **nor**
the organization allow-list that `userHasAllFeatures` / `getGrantedFeatures` apply.

**Rule: ask the service a question; do not read its answer sheet.** Prefer
`userHasAllFeatures` / `getGrantedFeatures`. A surface that accepts a feature list
*as a value* is the shape to be suspicious of; grep does not reliably enumerate these.

## 5. Tenant-aware infrastructure

### Cache — structurally partitioned

`packages/cache/src/service.ts`, `packages/cache/src/tenantContext.ts`

Tenant partitioning is **not** the caller's responsibility. Every key is rewritten:

```
tenant:<tenantId>:key:k:<sha256(originalKey)>
tenant:<tenantId>:tag:t:<sha256(tag)>
```

The tenant comes from an AsyncLocalStorage context (`runWithCacheTenant`), so two
tenants caching the same logical key cannot collide.

**Residual risk:** with no tenant context set, `normalizeTenantKey` falls back to
the literal `global` bucket. A code path that forgets `runWithCacheTenant` writes
to `global`, where a different tenant computing the same logical key would read it.
The fallback is deliberate (genuinely global config exists) but it is the one place
the cache is not fail-closed.

RBAC caching keys on `rbac:<userId>:<tenantId>:<organizationId>` and invalidates by
`rbac:user:*` / `rbac:tenant:*` / `rbac:org:*` tags.

### Encryption

`TenantDataEncryptionService`; entities read via `findWithDecryption` /
`findOneWithDecryption`, which require `tenantId` **and** `organizationId`. Index
documents are encrypted at rest, and the indexer **refuses to return an
unencrypted document** if encryption fails rather than degrading open.

### Queues, events, jobs

Progress jobs and worker payloads are required to carry `tenantId` and
`organizationId` (`packages/core/src/modules/progress`). Domain writes go through
commands so audit, undo, cache invalidation, events, and indexing stay consistent.

## 6. Platform vs. tenant administration

- `isSuperAdmin` grants all active features and bypasses the org allow-list.
- A **platform domain** (`PLATFORM_DOMAINS`) resolves the tenant from the *request
  body*; a registered **custom domain** resolves it server-side from the domain.
  See `packages/core/src/modules/customer_accounts/lib/resolveTenantContext.ts` and
  [ADR-0003](adr/ADR-0003-platform-domains-default.md).

### Super-admin is GLOBAL, and `auth setup` always mints one

`role_acls.is_super_admin` / `user_acls.is_super_admin` are stored on **tenant-scoped
rows**, but the privilege they confer is **platform-wide**. A super-admin whose ACL row
belongs to tenant B can read and write tenant A's data. Verified empirically (2026-08-23):
a `superadmin` in tenant "Globex" listed tenant "Acme" users and successfully `PUT`
a change onto an Acme user.

That is the intended design (`rbacService.isGlobalSuperAdmin`, the `directory.tenants.*`
feature), **not** a leak — but it has an operational trap:

> `mercato auth setup` **always** creates its primary user as `superadmin`.
> `--roles` selects which roles are *created* in the tenant; it does **not** scope the
> primary user (`setupInitialTenant` reads `primaryUserRoles`, which the CLI leaves unset).

So provisioning a second tenant with `mercato auth setup --roles admin` yields a
**global** super-admin, not a tenant admin. The CLI now prints a loud warning when an
explicit `--roles` omits `superadmin`. To create a tenant-scoped administrator use:

```bash
mercato auth add-user --email <email> --password <password> \
  --organizationId <org> --roles admin
```

Changing the provisioning default is deliberately **not** done here: `packages/core/src/modules/auth/AGENTS.md`
marks super-admin behavior and tenant-provisioning outputs "ask first".

## 6a. Verified isolation behaviour

Attack matrix run 2026-08-23 from a genuinely tenant-scoped principal
(`admin` role, `is_super_admin = false`) in tenant B, targeting tenant A:

| Attempt | Result |
|---|---|
| `GET /api/auth/users` | own tenant only — no A rows |
| `GET /api/auth/users?id=<A user>` | empty result |
| `GET /api/directory/organizations` | own org only |
| `GET /api/directory/tenants` | **403** |
| `GET /api/customers/people` (+ `?id=<A customer>`) | empty |
| `GET /api/catalog/products`, `/api/sales/orders` | empty |
| `?tenantId=<A>` injection on users / people | **403** |
| `?organizationId=<A org>` injection on users / people / products | 200, own-tenant data only |
| `PUT /api/auth/users` with A's user id | **404** |
| `DELETE /api/auth/users?id=<A user>` | **404** |

Tenant A's rows were confirmed unchanged afterwards. Note the deliberate asymmetry:
a foreign **tenant** id is rejected outright (403), whereas a foreign **organization**
id is silently narrowed to the caller's own scope rather than echoed back — both
fail closed, by different mechanisms.

That distinction matters: listing a hostname in `PLATFORM_DOMAINS` is a **trust
decision**, because it moves tenant selection from server-derived to client-supplied.

## 7. Invariants

| ID | Invariant | Enforced by |
|---|---|---|
| `INV-TENANT-001` | No query executes without a tenant scope | `engine.ts` throws on missing `tenantId` |
| `INV-TENANT-002` | Tenant-scoped tables are auto-filtered on `tenant_id` | `engine.ts` column probe + `where` |
| `INV-TENANT-003` | Bypassing auto-scope requires explicit opt-in and caller-side fail-closed filters | `omitAutomaticTenantOrgScope` (12 uses) |
| `INV-TENANT-004` | Unknown organization scope denies, never allows | `isOrganizationAccessAllowed` |
| `INV-TENANT-005` | Org slugs are unique per tenant, not globally | `organizations_tenant_slug_uniq` |
| `INV-TENANT-006` | Cache keys are tenant-partitioned without caller effort | `resolveTenantPrefixes` |
| `INV-TENANT-007` | Tables without a `tenant_id` column inherit tenancy via FK; the parent MUST be scoped explicitly | convention — the engine adds **no** predicate and does not warn (§3.2) |
| `INV-AUTHZ-001` | Authorization asks the RBAC service; it does not read `loadAcl().features` | `feature-policy-authorization-coverage.test.ts` — scans 18 server roots for low-level matchers, `loadAcl()` + `hasFeature`, and locally-ordered super-admin/grant checks |
| `INV-AUTHZ-002` | Invalid scope / disabled features deny before super-admin or wildcards | `rbacService` policy order |

Every invariant here now has a mechanical guard. `INV-AUTHZ-001` is still the
subtlest: the guard is a static scan, so it reasons about files rather than call
graphs. It catches a file that both loads an ACL and matches features itself; it
cannot catch a decision split across two files. Its scan roots are also a hand-
maintained list — it covers the 18 roots that ship server modules today, and a
new package needs adding to that list or it is simply not scanned.

## 8. What this baseline does *not* yet have

Honest gaps at the fork point:

- **No MFA and no SSO.** Both were commercial-only upstream and are excluded — see
  [ADR-0002](adr/ADR-0002-exclude-enterprise-edition.md).
- **`INV-AUTHZ-001`'s guard is a static scan, not a call-graph analysis.** It cannot see an authorization decision split across two files, and its scan roots are hand-maintained.
- **No end-to-end cross-tenant security test suite.** `INV-TENANT-001` is now guarded
  by `packages/shared/src/lib/query/__tests__/engine.tenant-guard.test.ts` (added with
  the fork, and mutation-tested: relaxing the engine's `throw` to a `console.warn`
  fails all five cases). But the full "Tenant A reaches for Tenant B" matrix — across
  APIs, files, search, cache, jobs, and exports — does not exist yet. Isolation is
  enforced in code and covered indirectly; it is not adversarially tested.
- **The `global` cache bucket** is a fail-open fallback (§5).
