# Query Engine Column-Presence Cache

**Status:** implemented
**Owner:** shared / core (query_index)
**Date:** 2026-08-31

## TLDR

Both query engines answered "does this table have this column?" with one
`information_schema.columns` query **per question**, and cached only the positive answers on
a per-request engine instance. Because `createRequestContainer()` constructs a fresh
`BasicQueryEngine` (and a fresh `HybridQueryEngine`) for every request, that cache was cold on
every request, and negative answers were never cached at all — not even within a single
request.

Measured on the local `open-mercato` database (311 tables / 3985 columns), a single CRUD list
request spent **13 catalog round trips and ~9.3 ms** on these probes, against a loopback
Postgres with no network latency. On the hybrid path a 14th query,
`getBaseColumnsForEntity`, introspected the same table again for its column types.

All of them are now answered from one per-table column map, loaded in a single query and cached
per Kysely connection with a TTL. Measured after the change: **14 catalog queries per request →
2 on the first request and 0 on every subsequent one; 9.30 ms → 0.02 ms.** Verified against
live Postgres: all 13 presence answers identical (8 present, 5 absent), and all 12 column
types identical.

## Problem statement

`BasicQueryEngine.columnExists` (`packages/shared/src/lib/query/engine.ts`) and its verbatim
duplicate in `HybridQueryEngine` (`packages/core/src/modules/query_index/lib/engine.ts`) both
did this:

```ts
if (this.columnCache.has(key)) {
  const cached = this.columnCache.get(key)
  if (cached === true) return true
  this.columnCache.delete(key)          // negatives evicted, never cached
}
const exists = await db.selectFrom('information_schema.columns')
  .select(sql`1`.as('one'))
  .where('table_name', '=', table)
  .where('column_name', '=', column)
  .limit(1)
  .executeTakeFirst()
if (present) this.columnCache.set(key, true)
else this.columnCache.delete(key)       // negatives never cached
```

Two compounding costs:

1. **Negatives were never cached.** Every absent column re-queried the catalog on every call.
   Absent columns are the common case on this hot path: a table without `deleted_at`, a join
   target without `organization_id`, and — via `resolveBaseColumn` — *every custom-field
   filter field*, since custom fields are stored EAV in `custom_field_values` and are never
   real columns.
2. **The instance cache was always cold.** `createRequestContainer()` builds a new engine per
   request (`packages/shared/src/lib/di/container.ts:213`, and `query_index/di.ts:128` for the
   hybrid override), so even positives were re-queried every request.

Per list request the engines probe: `organization_id` / `tenant_id` / `deleted_at` on the base
table, `organization_id` / `tenant_id` per join target, and one or two more per sort and filter
field through `resolveBaseColumn` — 13 in the measured shape.

A comment at `engine.ts:549` asserted the second `buildQuery` pass (taken when
`requiresPlaintextSort`) "hits no extra DB calls" because every check "is memoized on
`this.columnCache`". That was true only for positives; negatives were re-paid on both passes.

`information_schema.columns` is not a cheap view. `EXPLAIN (ANALYZE, BUFFERS)` on this schema
reports 0.145 ms execution against **1.653 ms planning with 911 shared buffer hits** — the
planner walks `pg_class`/`pg_attribute`/`pg_depend` every time.

There is also a documented correctness hazard in probing the catalog on a hot path: when such a
probe runs inside an active MikroORM transaction it shares that transaction's connection, and a
failure poisons the host transaction (`current transaction is aborted`). That is exactly why
`packages/core/src/modules/customers/lib/personCompanyLinkTable.ts` removed its own
`information_schema.columns` probe. Cutting 13 probes per request to ~0 shrinks that exposure.

## Prior art in this repo

This is not a new pattern — it is the pattern this file was missing:

- `packages/shared/src/lib/search/availability.ts` already caches the search token-presence
  probe at module level with an env-tunable TTL, for the stated reason that
  "`createRequestContainer` builds fresh engines — and with them fresh resolver instances — per
  request, so an instance-scoped memo alone re-pays the probe on every request."
- `packages/core/src/modules/query_index/lib/coverage.ts` already keeps a process-level
  `COLUMN_CACHE` that stores **both** true and false, a `COLUMN_CACHE_PENDING` in-flight
  de-dup map, and a `primeColumnCache` that batches the introspection for many pairs into one
  query.

## Solution

`packages/shared/src/lib/query/column-presence.ts` exposes `tableHasColumn(db, table, column)`
and `tableColumnTypes(db, table)`. Both engines' private `columnExists` delegates to the first,
and `HybridQueryEngine.getBaseColumnsForEntity` to the second. The engines' duplicated probe
bodies and `columnCache` fields are gone.

- **Per-table maps, not per-column probes.** One
  `select column_name, data_type from information_schema.columns where table_name = ?` yields
  the whole table, so a MISS is answered from the same cached entry as a HIT — and the
  base-column type map the hybrid engine needs comes from that same entry rather than a second
  query against the same view. `tableColumnTypes` returns a fresh Map per call so a caller
  cannot mutate the shared cached entry.
- **Cached per Kysely connection, keyed in a `WeakMap`.** `em.getKysely()` returns the
  connection's client, shared across EntityManager forks, so the cache spans requests — the
  point of the change — while still isolating one database (or one test's fake db) from
  another. A transaction gets its own client and so its own cache; that is no worse than the
  per-request memo it replaces, and the hot list path is not transactional.
- **TTL, default 30 s, `OM_QUERY_COLUMN_PRESENCE_CACHE_MS=0` disables.** Matches the default
  the sibling token-presence cache uses. Schema is the only input to this answer and migrations
  normally require a deploy, so the TTL is a dev-ergonomics guard: `yarn db:migrate` against a
  running dev server is picked up on the next TTL boundary rather than needing a restart.
- **In-flight de-dup** so concurrent probes for a cold table share one query.
- **Errors are never cached, and always propagate.** `columnExists(table, 'tenant_id')`
  returning a spurious `false` would make the engine drop tenant scoping from its WHERE clause,
  so an error-driven negative is a tenant-isolation hazard, not merely a stale answer. A failed
  load rejects to the caller exactly as the old probe did, and the next call retries.

### Behavior preserved

- Same boolean contract. The query is deliberately **not** filtered by `table_schema`, because
  the per-column probe it replaces was not either — an unqualified table name resolves exactly
  as before. A non-existent table yields an empty set, the same answer the old probe gave.
- No change to SQL generation, scoping, ACL, tenant isolation, response shape, or any public
  type. `columnExists` stays private on both engines.

## Verification

- `packages/shared/src/lib/query/__tests__/column-presence.test.ts` — 10 tests covering the
  query-count contract (13 probes → 1 query per table), negative caching, cross-table and
  cross-connection isolation, concurrent de-dup, the disable flag, the never-cache-an-error
  rule, that `tableColumnTypes` costs no extra round trip, and that the Map it returns cannot
  corrupt the cache.
- `packages/shared/src/lib/query/__tests__/engine.test.ts` — the fake db's `execute()` now
  honours the `table_name` predicate for `information_schema.columns`, as its
  `executeTakeFirst()` already did. Without it the stub returns every fixture column for every
  table, which is a stub limitation rather than a production one: real Postgres filters.
- Full suite green: 51/51 workspace tasks, including `@open-mercato/core` 11,743 tests and
  `@open-mercato/shared` 1,950 tests. `yarn build:packages`, `yarn typecheck`, `yarn lint` all
  pass.
- End-to-end against the live `open-mercato` database: all 13 presence answers and all 12
  column types identical to Postgres; 2 catalog queries on request 1, 0 on requests 2 and 3;
  9.30 ms → 0.02 ms warm.

## Out of scope

- `DefaultDataEngine.ensureStorageTableExists` (`packages/shared/src/lib/data/engine.ts`)
  probes `information_schema.tables` per custom-entity write. Same anti-pattern, write path
  rather than the hot read path, and it needs a table-presence helper rather than a
  column-presence one.
- Consolidating `query_index/lib/coverage.ts`'s own `COLUMN_CACHE` onto this helper. It has a
  different lifetime contract (no TTL) and a batching entry point of its own.

## Changelog

- **2026-08-31** — implemented. Added `column-presence.ts` + tests; both engines' `columnExists`
  and the hybrid engine's `getBaseColumnsForEntity` delegate to it; corrected the stale
  `this.columnCache` comment at `engine.ts:549`.
