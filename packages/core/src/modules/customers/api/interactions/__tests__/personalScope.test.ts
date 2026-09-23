import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
  type CompiledQuery,
} from 'kysely'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const viewerId = '33333333-3333-4333-8333-333333333333'

const recordedQueries: CompiledQuery[] = []
let grantedFeatures: string[] = []
let authSub: string | null = viewerId

function createRecordingKysely(): Kysely<any> {
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
  ;(db.getExecutor() as any).executeQuery = async (compiledQuery: CompiledQuery) => {
    recordedQueries.push(compiledQuery)
    return { rows: [] }
  }
  return db
}

const fakeEm = { fork: () => ({ getKysely: () => createRecordingKysely() }) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => {
      if (token === 'em') return fakeEm
      if (token === 'rbacService') return { getGrantedFeatures: async () => grantedFeatures }
      return undefined
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ tenantId, orgId, sub: authSub, isApiKey: authSub === null }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ filterIds: [orgId], selectedId: orgId }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/shared/lib/crud/enricher-runner', () => ({
  applyResponseEnrichers: async (items: unknown[]) => ({ items }),
}))

import { GET } from '../route'

const listSql = () =>
  recordedQueries.find((entry) => entry.sql.includes('customer_interactions'))?.sql.toLowerCase() ?? ''

beforeEach(() => {
  recordedQueries.length = 0
  grantedFeatures = ['customers.interactions.view']
  authSub = viewerId
})

/**
 * The calendar is organization-wide storage, so "whose entry is this" has to be
 * answered in SQL. A per-screen filter is not a boundary: the same rows stay
 * reachable through any other caller of this endpoint.
 */
describe('interactions list — personal scope', () => {
  test('a personal window is limited to what the viewer authors, owns or attends', async () => {
    await GET(new Request('https://example.test/api/customers/interactions?from=2026-01-01&to=2026-02-01'))
    const sql = listSql()
    // `participants @>` is the marker: the email visibility filter also emits
    // an `author_user_id =` clause, so that alone cannot tell the two apart.
    expect(sql).toContain('participants @>')
    expect(sql).toContain('"owner_user_id" = ')
  })

  test('view_all plus the explicit opt-in lifts the scope', async () => {
    grantedFeatures = ['customers.interactions.view', 'customers.interactions.view_all']
    await GET(new Request('https://example.test/api/customers/interactions?from=2026-01-01&to=2026-02-01&scope=all'))
    expect(listSql()).not.toContain('participants @>')
  })

  test('a customers.* wildcard satisfies view_all', async () => {
    grantedFeatures = ['customers.*']
    await GET(new Request('https://example.test/api/customers/interactions?from=2026-01-01&to=2026-02-01&scope=all'))
    expect(listSql()).not.toContain('participants @>')
  })

  /* A superadmin's grants resolve to a bare `*`, never to the concrete id, so
     the star has to satisfy the feature on its own. */
  test('a bare * wildcard satisfies view_all', async () => {
    grantedFeatures = ['*']
    await GET(new Request('https://example.test/api/customers/interactions?from=2026-01-01&to=2026-02-01&scope=all'))
    expect(listSql()).not.toContain('participants @>')
  })

  test('view_all without the opt-in still gets the personal view', async () => {
    grantedFeatures = ['customers.interactions.view', 'customers.interactions.view_all']
    await GET(new Request('https://example.test/api/customers/interactions?from=2026-01-01&to=2026-02-01'))
    expect(listSql()).toContain('participants @>')
  })

  /* The parameter is a preference, not a permission: asking for everyone's rows
     without the grant has to return the caller's own, not everyone's. */
  test('the opt-in alone cannot widen an unprivileged read', async () => {
    grantedFeatures = ['customers.interactions.view']
    await GET(new Request('https://example.test/api/customers/interactions?from=2026-01-01&to=2026-02-01&scope=all'))
    expect(listSql()).toContain('participants @>')
  })

  test('a customer-scoped request is shared history and stays unscoped', async () => {
    await GET(
      new Request(
        `https://example.test/api/customers/interactions?entityId=${orgId}`,
      ),
    )
    expect(listSql()).not.toContain('participants @>')
  })

  test('a service credential with no user identity is not scoped to rows it authored', async () => {
    authSub = null
    await GET(new Request('https://example.test/api/customers/interactions?from=2026-01-01&to=2026-02-01'))
    expect(listSql()).not.toContain('participants @>')
  })
})
