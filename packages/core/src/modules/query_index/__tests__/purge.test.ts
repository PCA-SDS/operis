import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { purgeIndexScope } from '../lib/purge'

jest.mock('../lib/jobs', () => ({
  prepareJob: jest.fn(async () => undefined),
  updateJobProgress: jest.fn(async () => undefined),
  finalizeJob: jest.fn(async () => undefined),
}))

type TokenRow = {
  entityType: string
  entityId: string
  organizationId: string | null
  tenantId: string | null
}

function makeDb(initialTokens: TokenRow[]) {
  const statements: CompiledQuery[] = []
  const tokens = [...initialTokens]

  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => undefined,
        acquireConnection: async () => ({
          executeQuery: async (compiled: CompiledQuery) => {
            statements.push(compiled)
            if (compiled.sql.includes('count(*)')) {
              return { rows: [{ count: 1 }], numAffectedRows: BigInt(0) }
            }
            if (compiled.sql.startsWith('delete from "search_tokens"')) {
              const hasOrganizationScope = compiled.sql.includes('organization_id is not distinct from')
              const hasTenantScope = compiled.sql.includes('tenant_id is not distinct from')
              const entityType = String(compiled.parameters[0])
              const organizationId = hasOrganizationScope ? String(compiled.parameters[1]) : null
              const tenantParameterIndex = hasOrganizationScope ? 2 : 1
              const tenantId = hasTenantScope ? String(compiled.parameters[tenantParameterIndex]) : null
              for (let index = tokens.length - 1; index >= 0; index -= 1) {
                const token = tokens[index]!
                if (
                  token.entityType === entityType &&
                  token.organizationId === organizationId &&
                  token.tenantId === tenantId
                ) {
                  tokens.splice(index, 1)
                }
              }
            }
            return { rows: [], numAffectedRows: BigInt(1) }
          },
          streamQuery: async function* () { /* not used */ },
        }),
        beginTransaction: async () => undefined,
        commitTransaction: async () => undefined,
        rollbackTransaction: async () => undefined,
        releaseConnection: async () => undefined,
        destroy: async () => undefined,
      }),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })

  return { db, statements, tokens }
}

describe('purgeIndexScope', () => {
  it('removes stale entity indexes and tokens without crossing tenant scope', async () => {
    const { db, statements, tokens } = makeDb([
      { entityType: 'customers:customer_entity', entityId: 'removed', organizationId: 'org-a', tenantId: 'tenant-a' },
      { entityType: 'customers:customer_entity', entityId: 'kept', organizationId: 'org-a', tenantId: 'tenant-a' },
      { entityType: 'customers:customer_entity', entityId: 'other-tenant', organizationId: 'org-a', tenantId: 'tenant-b' },
    ])

    await purgeIndexScope({ getKysely: () => db } as any, {
      entityType: 'customers:customer_entity',
      organizationId: 'org-a',
      tenantId: 'tenant-a',
    })

    expect(tokens).toEqual([
      { entityType: 'customers:customer_entity', entityId: 'other-tenant', organizationId: 'org-a', tenantId: 'tenant-b' },
    ])
    expect(statements.some((statement) => statement.sql.startsWith('delete from "entity_indexes"'))).toBe(true)
    expect(statements.some((statement) => statement.sql.startsWith('delete from "search_tokens"'))).toBe(true)
    const tokenPurge = statements.find((statement) => statement.sql.startsWith('delete from "search_tokens"'))
    expect(tokenPurge?.parameters).toEqual(['customers:customer_entity', 'org-a', 'tenant-a'])
  })
})
