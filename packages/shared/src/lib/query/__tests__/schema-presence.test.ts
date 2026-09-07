import { tableHasColumn, tableColumnTypes, primeTableColumns, clearQuerySchemaPresenceCache } from '../schema-presence'

type Row = { table_name: string; column_name: string; data_type?: string }

function makeDb(rows: Row[]) {
  const queries: Array<{ table: string; wheres: Array<[string, string, unknown]> }> = []
  const db: any = {
    _queries: queries,
    selectFrom(table: string) {
      const wheres: Array<[string, string, unknown]> = []
      queries.push({ table, wheres })
      const builder: any = {
        select() { return builder },
        where(column: string, op: string, value: unknown) { wheres.push([column, op, value]); return builder },
        async execute() {
          const predicate = wheres.find(([column]) => column === 'table_name')
          const wanted = new Set(
            predicate?.[1] === 'in' ? (predicate[2] as string[]) : [predicate?.[2] as string],
          )
          return rows.filter((row) => wanted.has(row.table_name)).map((row) => ({
            table_name: row.table_name,
            column_name: row.column_name,
            data_type: row.data_type ?? 'text',
          }))
        },
      }
      return builder
    },
  }
  return db
}

const ROWS: Row[] = [
  { table_name: 'customer_entities', column_name: 'id', data_type: 'uuid' },
  { table_name: 'customer_entities', column_name: 'tenant_id', data_type: 'uuid' },
  { table_name: 'customer_entities', column_name: 'organization_id', data_type: 'uuid' },
  { table_name: 'roles', column_name: 'id', data_type: 'uuid' },
]

describe('tableHasColumn', () => {
  const previousTtl = process.env.OM_QUERY_SCHEMA_PRESENCE_CACHE_MS

  afterEach(() => {
    if (previousTtl === undefined) delete process.env.OM_QUERY_SCHEMA_PRESENCE_CACHE_MS
    else process.env.OM_QUERY_SCHEMA_PRESENCE_CACHE_MS = previousTtl
  })

  it('answers presence and absence from one introspection query per table', async () => {
    const db = makeDb(ROWS)
    await expect(tableHasColumn(db, 'customer_entities', 'tenant_id')).resolves.toBe(true)
    await expect(tableHasColumn(db, 'customer_entities', 'organization_id')).resolves.toBe(true)
    // The absent-column answers are the ones the previous per-column probe never cached.
    await expect(tableHasColumn(db, 'customer_entities', 'deleted_at')).resolves.toBe(false)
    await expect(tableHasColumn(db, 'customer_entities', 'cf_priority')).resolves.toBe(false)
    expect(db._queries).toHaveLength(1)
    expect(db._queries[0].table).toBe('information_schema.columns')
  })

  it('does not re-probe across engine instances sharing a connection', async () => {
    const db = makeDb(ROWS)
    for (let request = 0; request < 5; request++) {
      await tableHasColumn(db, 'customer_entities', 'tenant_id')
      await tableHasColumn(db, 'customer_entities', 'deleted_at')
    }
    expect(db._queries).toHaveLength(1)
  })

  it('keeps one table\'s columns out of another table\'s answers', async () => {
    const db = makeDb(ROWS)
    await expect(tableHasColumn(db, 'roles', 'id')).resolves.toBe(true)
    await expect(tableHasColumn(db, 'roles', 'tenant_id')).resolves.toBe(false)
    await expect(tableHasColumn(db, 'customer_entities', 'tenant_id')).resolves.toBe(true)
    expect(db._queries).toHaveLength(2)
  })

  it('does not share cached columns between connections', async () => {
    const first = makeDb(ROWS)
    const second = makeDb([{ table_name: 'customer_entities', column_name: 'id' }])
    await expect(tableHasColumn(first, 'customer_entities', 'tenant_id')).resolves.toBe(true)
    await expect(tableHasColumn(second, 'customer_entities', 'tenant_id')).resolves.toBe(false)
    expect(second._queries).toHaveLength(1)
  })

  it('collapses concurrent probes for the same table into one query', async () => {
    const db = makeDb(ROWS)
    const answers = await Promise.all([
      tableHasColumn(db, 'customer_entities', 'id'),
      tableHasColumn(db, 'customer_entities', 'tenant_id'),
      tableHasColumn(db, 'customer_entities', 'deleted_at'),
    ])
    expect(answers).toEqual([true, true, false])
    expect(db._queries).toHaveLength(1)
  })

  it('re-probes every call when the cache is disabled', async () => {
    process.env.OM_QUERY_SCHEMA_PRESENCE_CACHE_MS = '0'
    const db = makeDb(ROWS)
    await tableHasColumn(db, 'customer_entities', 'tenant_id')
    await tableHasColumn(db, 'customer_entities', 'tenant_id')
    expect(db._queries).toHaveLength(2)
  })

  it('never caches an error-driven answer, so a failed probe cannot drop tenant scoping', async () => {
    let attempt = 0
    const db: any = {
      selectFrom() {
        const builder: any = {
          select() { return builder },
          where() { return builder },
          async execute() {
            attempt += 1
            if (attempt === 1) throw new Error('connection reset')
            return [{ column_name: 'tenant_id' }]
          },
        }
        return builder
      },
    }
    await expect(tableHasColumn(db, 'customer_entities', 'tenant_id')).rejects.toThrow('connection reset')
    // A cached `false` here would silently remove `tenant_id` from the engine's WHERE clause.
    await expect(tableHasColumn(db, 'customer_entities', 'tenant_id')).resolves.toBe(true)
  })

  it('serves tableColumnTypes from the same cached query as tableHasColumn', async () => {
    const db = makeDb(ROWS)
    await expect(tableHasColumn(db, 'customer_entities', 'tenant_id')).resolves.toBe(true)
    const types = await tableColumnTypes(db, 'customer_entities')
    expect(types.get('tenant_id')).toBe('uuid')
    expect(Array.from(types.keys()).sort()).toEqual(['id', 'organization_id', 'tenant_id'])
    // The whole point: the type map costs no extra introspection round trip.
    expect(db._queries).toHaveLength(1)
  })

  it('hands tableColumnTypes callers a copy they cannot use to corrupt the cache', async () => {
    const db = makeDb(ROWS)
    const first = await tableColumnTypes(db, 'customer_entities')
    first.delete('tenant_id')
    first.set('injected', 'text')
    const second = await tableColumnTypes(db, 'customer_entities')
    expect(second.has('tenant_id')).toBe(true)
    expect(second.has('injected')).toBe(false)
    await expect(tableHasColumn(db, 'customer_entities', 'tenant_id')).resolves.toBe(true)
  })

  it('primes several tables in one query and answers them all from cache', async () => {
    const db = makeDb(ROWS)
    await primeTableColumns(db, ['customer_entities', 'roles'])
    expect(db._queries).toHaveLength(1)
    await expect(tableHasColumn(db, 'customer_entities', 'tenant_id')).resolves.toBe(true)
    await expect(tableHasColumn(db, 'roles', 'tenant_id')).resolves.toBe(false)
    await expect(tableHasColumn(db, 'roles', 'id')).resolves.toBe(true)
    expect(db._queries).toHaveLength(1)
  })

  it('skips tables already cached when priming again', async () => {
    const db = makeDb(ROWS)
    await primeTableColumns(db, ['customer_entities'])
    await primeTableColumns(db, ['customer_entities', 'roles'])
    expect(db._queries).toHaveLength(2)
    expect(db._queries[1].wheres.find(([column]) => column === 'table_name')?.[2]).toEqual(['roles'])
    await primeTableColumns(db, ['customer_entities', 'roles'])
    expect(db._queries).toHaveLength(2)
  })

  it('caches a primed table that has no columns, rather than leaving it cold', async () => {
    const db = makeDb(ROWS)
    await primeTableColumns(db, ['not_a_table'])
    await expect(tableHasColumn(db, 'not_a_table', 'id')).resolves.toBe(false)
    // Without seeding the empty result the next caller would re-introspect it one table at a time.
    expect(db._queries).toHaveLength(1)
  })

  it('collapses a concurrent prime and probe for the same table into one query', async () => {
    const db = makeDb(ROWS)
    const [, answer] = await Promise.all([
      primeTableColumns(db, ['customer_entities']),
      tableHasColumn(db, 'customer_entities', 'tenant_id'),
    ])
    expect(answer).toBe(true)
    expect(db._queries).toHaveLength(1)
  })

  it('caches nothing when the primed introspection fails', async () => {
    let attempt = 0
    const db: any = {
      selectFrom() {
        const builder: any = {
          select() { return builder },
          where() { return builder },
          async execute() {
            attempt += 1
            if (attempt === 1) throw new Error('db down')
            return [{ table_name: 'customer_entities', column_name: 'tenant_id', data_type: 'uuid' }]
          },
        }
        return builder
      },
    }
    await expect(primeTableColumns(db, ['customer_entities'])).rejects.toThrow('db down')
    // A half-primed cache would hand out an error-driven `false` for every column of the batch.
    await expect(tableHasColumn(db, 'customer_entities', 'tenant_id')).resolves.toBe(true)
  })

  it('clears a connection\'s cached columns on request', async () => {
    const db = makeDb(ROWS)
    await tableHasColumn(db, 'customer_entities', 'tenant_id')
    clearQuerySchemaPresenceCache(db)
    await tableHasColumn(db, 'customer_entities', 'tenant_id')
    expect(db._queries).toHaveLength(2)
  })
})
