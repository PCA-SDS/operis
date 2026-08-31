import { type Kysely, sql } from 'kysely'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'

type AnyDb = Kysely<any>

type TableColumnsEntry = { columns: Map<string, string>; expiresAt: number }
type ConnectionCache = {
  tables: Map<string, TableColumnsEntry>
  pending: Map<string, Promise<Map<string, string>>>
}

const SCHEMA_PRESENCE_CACHE_DEFAULT_TTL_MS = 30_000
const SCHEMA_PRESENCE_CACHE_MAX_TABLES = 2_000

/**
 * "What does the schema hold?" — every column of a table, with its type — cached per Kysely
 * connection and keyed by table. Table existence is derived from the same entry.
 *
 * The cache has to outlive a request for this to be worth anything: `createRequestContainer`
 * builds a fresh `BasicQueryEngine` per request, so an instance-scoped memo is cold on every
 * request and re-pays every probe — the same reasoning that put the search token-presence
 * cache in `../search/availability.ts` at module level. `em.getKysely()` returns the
 * connection's client, which is shared across EntityManager forks, so keying on it spans
 * requests while still isolating one database (or one test's fake db) from another. A
 * transaction gets its own client and therefore its own cache, which is no worse than the
 * per-request memo it replaces; the hot list path is not transactional.
 *
 * The engine asks about `organization_id`, `tenant_id` and `deleted_at` on the base table and
 * on each join target, then once or twice more per sort and filter field via
 * `resolveBaseColumn` — measured at 13 catalog round trips for a single list request on a
 * 311-table / 3985-column schema, ~9.3 ms of `information_schema` time even against a
 * loopback Postgres.
 *
 * Entries hold the whole column set for a table, so a MISS is answered from the same cached
 * set as a HIT. That is what the per-(table, column) probe this replaces could not do: it
 * stored only positives, so every negative answer — every custom-field filter field, every
 * table without `deleted_at` — re-queried `information_schema.columns` on every call.
 *
 * Staleness contract: a column added or dropped by a migration is observed within the TTL.
 * Schema is the only input to this answer and migrations normally require a deploy, so the
 * TTL is a dev-ergonomics guard rather than a correctness one — `yarn db:migrate` against a
 * running dev server is picked up on the next TTL boundary instead of needing a restart. Set
 * `OM_QUERY_SCHEMA_PRESENCE_CACHE_MS=0` to disable caching and introspect per call.
 */
const connectionCaches = new WeakMap<AnyDb, ConnectionCache>()

function getConnectionCache(db: AnyDb): ConnectionCache {
  let cache = connectionCaches.get(db)
  if (!cache) {
    cache = { tables: new Map(), pending: new Map() }
    connectionCaches.set(db, cache)
  }
  return cache
}

function resolveSchemaPresenceCacheTtlMs(): number {
  return parseNumberWithDefault(
    process.env.OM_QUERY_SCHEMA_PRESENCE_CACHE_MS,
    SCHEMA_PRESENCE_CACHE_DEFAULT_TTL_MS,
    { integer: true, min: 0 },
  )
}

function storeColumns(cache: ConnectionCache, table: string, columns: Map<string, string>, ttlMs: number): void {
  if (cache.tables.size >= SCHEMA_PRESENCE_CACHE_MAX_TABLES) {
    const now = Date.now()
    for (const [key, entry] of cache.tables) {
      if (entry.expiresAt <= now) cache.tables.delete(key)
    }
    if (cache.tables.size >= SCHEMA_PRESENCE_CACHE_MAX_TABLES) cache.tables.clear()
  }
  cache.tables.set(table, { columns, expiresAt: Date.now() + ttlMs })
}

/** Drops the cached column sets for one connection, or for all of them when `db` is omitted. */
export function clearQuerySchemaPresenceCache(db?: AnyDb): void {
  if (!db) return
  connectionCaches.delete(db)
}

/**
 * Every column of one table, mapped to its SQL type, in a single
 * `information_schema.columns` query. One query serves both questions callers ask — "does
 * this column exist?" and "what are this table's columns and types?" — so the two are not
 * separate round trips against the same catalog view.
 *
 * Restricted to `current_schema()`, matching the coverage-snapshot probe this helper absorbed.
 * The engines' own per-column probes were unqualified, which meant a same-named table in
 * another visible schema could report a column the engine's actual target table does not have —
 * the engine would then add a WHERE on a non-existent column and the query would fail. The
 * connection's `current_schema()` is the schema those queries run against, so qualifying it can
 * only turn a wrong answer right; on a single-schema database the two are identical. A table
 * that does not exist yields an empty map, the same answer the old probes gave for it.
 */
async function loadTableColumns(db: AnyDb, table: string): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom('information_schema.columns' as any)
    .select(['column_name' as any, 'data_type' as any])
    .where(sql<boolean>`table_schema = current_schema()`)
    .where('table_name' as any, '=', table)
    .execute() as Array<{ column_name: string; data_type: string }>
  return new Map(rows.map((row) => [String(row.column_name), String(row.data_type)]))
}

function getTableColumns(db: AnyDb, table: string): Promise<Map<string, string>> {
  const cache = getConnectionCache(db)
  const ttlMs = resolveSchemaPresenceCacheTtlMs()
  if (ttlMs > 0) {
    const entry = cache.tables.get(table)
    if (entry && entry.expiresAt > Date.now()) return Promise.resolve(entry.columns)
  }
  const pending = cache.pending.get(table)
  if (pending) return pending

  const load = (async () => {
    try {
      const columns = await loadTableColumns(db, table)
      // Only a genuine introspection result is cached. A rejected load must never be stored:
      // `columnExists(table, 'tenant_id')` returning a spurious `false` would make the engine
      // drop tenant scoping from the WHERE clause, so an error-driven negative is a
      // tenant-isolation hazard, not just a stale answer. Errors propagate to the caller
      // exactly as the per-column probe's did.
      if (ttlMs > 0) storeColumns(cache, table, columns, ttlMs)
      return columns
    } finally {
      cache.pending.delete(table)
    }
  })()
  cache.pending.set(table, load)
  // The map entry is removed in the `finally` above; attach a no-op catch so a rejected load
  // that no late arrival adopted does not surface as an unhandled rejection.
  load.catch(() => {})
  return load
}

/**
 * Does `table` have `column`? Same boolean contract as the per-column
 * `information_schema.columns` probe it replaces, answered from a cached per-table column set
 * instead of a round trip per question.
 */
export async function tableHasColumn(db: AnyDb, table: string, column: string): Promise<boolean> {
  const columns = await getTableColumns(db, table)
  return columns.has(column)
}

/**
 * Every column of `table` mapped to its SQL data type.
 *
 * Returns a fresh Map on each call so a caller that mutates the result cannot corrupt the
 * cached entry every other caller reads.
 */
export async function tableColumnTypes(db: AnyDb, table: string): Promise<Map<string, string>> {
  return new Map(await getTableColumns(db, table))
}

/**
 * Does `table` exist (in `current_schema()`)?
 *
 * Derived from the same cached column map rather than a separate `information_schema.tables`
 * probe, so it shares a query with every column question about that table instead of adding
 * one. The single behavioural difference from a `tables` probe is a table declared with no
 * columns at all (`CREATE TABLE t()`), which Postgres permits and which this reports as
 * absent; no such table exists in this schema, and one would be unusable by the callers that
 * ask.
 */
export async function tableExists(db: AnyDb, table: string): Promise<boolean> {
  const columns = await getTableColumns(db, table)
  return columns.size > 0
}

/**
 * Warms the cache for several tables in ONE introspection query.
 *
 * Callers that already know the whole set of tables they are about to ask about should prime
 * first: `tableHasColumn` alone would issue one query per cold table, and a fan-out of
 * concurrent consumers (the `coverage.refresh` subscribers are the motivating case) would each
 * pay that. Tables already cached or already in flight are skipped, so priming twice costs one
 * query, not two.
 *
 * Rejects if the introspection query fails, and caches nothing in that case — a partially
 * primed cache would hand out an error-driven `false` for every column of every table in the
 * batch.
 */
export async function primeTableColumns(db: AnyDb, tables: readonly string[]): Promise<void> {
  const cache = getConnectionCache(db)
  const ttlMs = resolveSchemaPresenceCacheTtlMs()
  const now = Date.now()
  const missing: string[] = []
  const seen = new Set<string>()
  for (const raw of tables) {
    const table = String(raw || '')
    if (!table || seen.has(table)) continue
    seen.add(table)
    const entry = ttlMs > 0 ? cache.tables.get(table) : undefined
    if (entry && entry.expiresAt > now) continue
    if (cache.pending.has(table)) continue
    missing.push(table)
  }
  if (!missing.length) return

  const batch = (async (): Promise<Map<string, Map<string, string>>> => {
    const rows = await db
      .selectFrom('information_schema.columns' as any)
      .select(['table_name' as any, 'column_name' as any, 'data_type' as any])
      .where(sql<boolean>`table_schema = current_schema()`)
      .where('table_name' as any, 'in', missing)
      .execute() as Array<{ table_name: string; column_name: string; data_type: string }>
    // Seed every requested table, so one that returned no rows is cached as "no columns"
    // rather than left cold and re-queried one at a time by the next caller.
    const byTable = new Map<string, Map<string, string>>(missing.map((table) => [table, new Map()]))
    for (const row of rows) {
      byTable.get(String(row.table_name))?.set(String(row.column_name), String(row.data_type))
    }
    return byTable
  })()

  for (const table of missing) {
    const entry = batch.then((byTable) => {
      const columns = byTable.get(table) ?? new Map<string, string>()
      if (ttlMs > 0) storeColumns(cache, table, columns, ttlMs)
      return columns
    })
    // A rejected batch with no adopter yet — the common case, since the warmup awaits priming
    // before dispatching any consumer — would otherwise surface as an unhandledRejection and
    // take down a plain-Node event worker. Awaiting callers still see it through the stored
    // reference.
    entry.catch(() => undefined)
    cache.pending.set(table, entry)
  }

  try {
    await batch
  } finally {
    for (const table of missing) cache.pending.delete(table)
  }
}
