import { BasicQueryEngine } from '../engine'

/**
 * Guard for INV-TENANT-001 — the load-bearing tenant-isolation invariant.
 *
 * The query engine MUST refuse to execute a query that carries no tenant scope,
 * rather than degrading to an unscoped (cross-tenant) read. At the fork point this
 * behaviour existed in `engine.ts` but nothing tested it, so relaxing the throw to
 * a warning would have been a silent, repo-wide cross-tenant data leak that left
 * the suite green.
 *
 * See docs/architecture/multi-tenancy.md § 3.1 and § 7.
 */

/**
 * `query()` resolves the db handle before it validates the tenant scope, so the
 * accessor must return something inert rather than throw. `selectFrom` is the
 * first thing any real query path touches — if the guard ever stopped firing,
 * `builtQuery` flips to true and the assertions below catch it.
 */
function createEngine() {
  const state = { builtQuery: false }
  const db = {
    selectFrom() {
      state.builtQuery = true
      throw new Error('query was built despite a missing tenant scope')
    },
  }
  return { engine: new BasicQueryEngine({} as any, (() => db) as any), state }
}

describe('QueryEngine tenant scope guard (INV-TENANT-001)', () => {
  test('rejects a query with no tenantId', async () => {
    const { engine, state } = createEngine()
    await expect(engine.query('example:todo', { fields: ['id'] } as any)).rejects.toThrow(
      /tenantId is now required/i,
    )
    expect(state.builtQuery).toBe(false)
  })

  test('rejects a query whose tenantId is undefined', async () => {
    const { engine, state } = createEngine()
    await expect(engine.query('example:todo', { fields: ['id'], tenantId: undefined } as any)).rejects.toThrow(
      /tenantId is now required/i,
    )
    expect(state.builtQuery).toBe(false)
  })

  test('rejects a query whose tenantId is an empty string', async () => {
    // An empty string is falsy, so it must be rejected rather than compiled into
    // `tenant_id = ''`, which would match nothing on a good day and is a scope bug
    // on a bad one.
    const { engine, state } = createEngine()
    await expect(engine.query('example:todo', { fields: ['id'], tenantId: '' } as any)).rejects.toThrow(
      /tenantId is now required/i,
    )
    expect(state.builtQuery).toBe(false)
  })

  test('rejects a query whose tenantId is null', async () => {
    const { engine, state } = createEngine()
    await expect(engine.query('example:todo', { fields: ['id'], tenantId: null } as any)).rejects.toThrow(
      /tenantId is now required/i,
    )
    expect(state.builtQuery).toBe(false)
  })

  test('the guard fires even when automatic scoping is explicitly bypassed', async () => {
    // `omitAutomaticTenantOrgScope` opts out of the automatic WHERE guards, NOT out
    // of having a tenant. If this ever stopped throwing, the documented bypass would
    // become an unauthenticated full-table read.
    const { engine, state } = createEngine()
    await expect(
      engine.query('example:todo', {
        fields: ['id'],
        omitAutomaticTenantOrgScope: true,
      } as any),
    ).rejects.toThrow(/tenantId is now required/i)
    expect(state.builtQuery).toBe(false)
  })
})
