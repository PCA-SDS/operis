# Users List — Bounding the Id Materialisation

**Status:** implemented (steps 1–3); step 4 deliberately not done
**Owner:** core / auth
**Date:** 2026-09-15

## TLDR

`GET /api/auth/users` answers role filters and search by loading **every** matching
link row into JavaScript and re-injecting the ids as `id: { $in: [...] }`. On a tenant
where 50k users share a role, that pulls 50k rows over the wire and sends a 50k-element
bind array back to Postgres.

Two of the three unbounded legs are expressible in SQL and should be. The third is
**forced** by encryption and must stay as it is.

## Query inventory (unbounded legs only)

| # | Location | Query | Runs when |
|---|---|---|---|
| Q2/Q3 | `auth/lib/grantChecks.ts:350,363` | `RoleAcl` super-admin scan + its `UserRole` links | every non-super-admin request |
| Q5 | `auth/api/users/route.ts:299` | `em.find(UserRole, buildRoleLinkFilter(...))` | `?roleId=` |
| Q7 | `route.ts:340` | `em.find(Organization, …)` | `?search=` |
| Q8/Q9 | `route.ts:358,366` | `Role` name match + its `UserRole` links | `?search=` |
| Q4/Q6 | `route.ts:290,327` | `search_tokens` lookups | `?name=` / `?search=` |

## Landed 2026-09-15

- **Q2 scoped to the tenant.** `RoleAcl.tenantId` is mandatory, yet the super-admin role
  scan had no tenant predicate, so every Users-list request by a non-super-admin walked
  *every tenant's* super-admin grants. Q3 inherits the narrowing through `roleIds`.
  Behaviour-preserving: the ids produced for other tenants fed an `id: { $nin: … }` on a
  query that is already tenant-scoped, and ids are UUIDs so they can never collide.
- **Q5/Q9 select only the user FK** (`{ fields: ['user'] }`). Both loops read nothing but
  `link.user.id`. This bounds the cost *per row*, not the row count.

## Not done — and why encryption decides it

`packages/core/src/modules/auth/encryption.ts` encrypts `User.email` and `User.name`
(on by default — `isTenantDataEncryptionEnabled()` returns true when unset). There is no
`directory/encryption.ts`, so `Organization.name` and `Role.name` are plaintext.

| Leg | Column | SQL `ILIKE` viable? |
|---|---|---|
| Email search (Q6) | `users.email` | **No** — ciphertext, per-row IV |
| `?name=` (Q4) | `users.name` | **No** — the `$ilike` there is a silent no-op under encryption; it is the plaintext-mode path |
| Role-name search (Q8) | `roles.name` | Yes |
| Org-name search (Q7) | `organizations.name` | Yes |

So the email leg **must** stay a materialised id set via `search_tokens`. Pushing it into
a correlated `EXISTS` would also invert index access from the token-hash-leading indexes
to `search_tokens_entity_idx`, evaluated once per candidate row — a regression.

## Implemented steps 2–3

Express the two role legs as `EXISTS` predicates AND-ed onto `filters`, leaving
`em.findAndCount(User, …)` untouched so MikroORM's `onLoad` decryption still runs:

```
exists (select 1 from "user_roles" ur
        where ur."user_id" = <alias>."id" and ur."deleted_at" is null
          and ur."role_id" in (…))
```

and, for the search leg, the same joined to `roles` on `r."name" ilike ?`, emitting the
`tenant_id` disjunct only when `tenantScope` is truthy so unscoped super-admin behaviour
is unchanged.

Mechanism: MikroORM v7 `raw()` accepts an alias callback and emits a bare fragment for an
empty array value (`@mikro-orm/sql/query/QueryBuilderHelper.js:466-479`); the fragment
registry is a `WeakMap`, so the same fragment survives both compilations inside
`findAndCount` (SELECT + COUNT).

**Do NOT move the page query to `QueryBuilder`.** `QueryBuilder.getResultList()` never
dispatches `onLoad` (`EntityManager.js` dispatches it only from `find`/`findOne`/cursor),
so it would return **ciphertext emails and names**. That is why `api_keys`/`attachments`
can use QB and this route cannot.

### Behaviour deltas — none observable (corrected)

The draft predicted that losing the `roleUserIds.size === 0` / `!searchFilters.length`
short-circuits would start writing audit rows. **It does not.** `logCrudAccess`
(`packages/shared/src/lib/crud/factory.ts`) returns `{ mode: 'skipped', count: 0 }` on its
second line when `items.length === 0`, so a zero-result page writes nothing — exactly as
the short-circuit did. And the normal path's body for `count = 0` is
`{ items: [], total: 0, totalPages: Math.max(1, ceil(0 / pageSize)) = 1, isSuperAdmin }`,
byte-identical to the short-circuit's literal.

The only difference is internal: one bounded `findAndCount` runs instead of returning
early. This change is therefore fully behaviour-preserving.

### Verification

Equivalence was proven against the live database, not just reasoned about. A probe ran the
old id-materialisation and the new EXISTS side by side over the same fixtures and compared
sorted id lists and counts:

| Scenario | Result |
|---|---|
| `roleId=employee` (3 members) | identical |
| `roleId=admin` (1 member) | identical |
| `roleId=<role with no members>` — the old short-circuit case | identical (0) |
| `roleId=employee&roleId=admin` — union | identical (4) |
| `?id=` + `?roleId=` — intersection | identical (1) |
| `search` matching role name `%employ%` | identical (3) |
| `search` matching role name `%admin%` | identical (1) |
| `search` matching no role `%nomatchatall%` | identical (0) |
| `search=%admin%` unscoped super admin | identical (3) |

9/9 passed. Separately, both SQL fragments extracted verbatim from the shipped route were
`PREPARE`d and `EXECUTE`d against the real schema, and the `raw()` mechanism was confirmed
to survive both compilations inside `findAndCount` (the COUNT and the SELECT each carry the
EXISTS).

### Tests

17 tests in `auth/api/__tests__/users.route.test.ts` asserted the intermediate
materialisation and were rewritten rather than deleted — each tenant-scoping invariant they
protected is now re-asserted against the SQL fragment's `params` and the page query's
clauses, via new `readRawFragments` / `findRoleMembershipFragment` /
`findRoleNameSearchFragment` helpers that recover a fragment from MikroORM's registry by its
symbol key. Two new cases were added: one pinning that an unscoped super admin gets no
tenant disjunct, one pinning that role membership and the role-name leg coexist with zero
`user_roles` lookups. Four helpers that only inspected the old intermediate query were
removed.

### Step 4 — organization leg: ask first

Mechanically identical, but it hard-codes the `directory`-owned `"organizations"` table
name into an `auth` route. Precedent exists (`warranty_claims/lib/orderOwnership.ts` reads
`sales_orders` via Kysely with missing-table tolerance) but is looser than this route's
current entity-level coupling. In the common non-super-admin case Q7 is already
tenant-bounded; the genuinely unbounded case is super-admin-with-no-selected-tenant, which
is rare and deliberate. **Recommend leaving Q7 alone.**

## Separately noticed

`listSuperAdminUserIds`' `UserRole` lookup does not filter `deletedAt: null`, so a user
whose super-admin role link was soft-deleted is still excluded from the Users list. That
is a correctness bug, not a performance one, and fixing it changes visible results — it
needs its own change.

## Changelog

- 2026-09-15 — Spec created. Step 1 (tenant-scoped super-admin scan, FK-only projections)
  implemented; steps 2–3 specified; step 4 recommended against.
- 2026-09-15 — Steps 2–3 implemented. Both role legs are now correlated EXISTS predicates;
  `buildRoleLinkFilter` and the `Role` import are gone from the route. Equivalence verified
  against the live database across 9 scenarios. The predicted audit-log delta turned out not
  to exist — corrected above.
