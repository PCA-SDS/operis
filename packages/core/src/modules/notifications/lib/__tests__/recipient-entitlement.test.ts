import { getRecipientUserIdsForFeature } from '../notificationRecipients'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

const TENANT = '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e'
const ALLOWED_USER = '11111111-1111-4111-8111-111111111111'
const RESTRICTED_USER = '22222222-2222-4222-8222-222222222222'

const TEST_MODULES: Module[] = [
  { id: 'auth', features: [{ id: 'auth.users.list', title: 'List users', module: 'auth' }] },
  { id: 'directory' },
  { id: 'wms', features: [{ id: 'wms.stock.view', title: 'View stock', module: 'wms' }] },
] as unknown as Module[]

type Rows = {
  user_acls?: Array<Record<string, unknown>>
  role_acls?: Array<Record<string, unknown>>
  tenant_modules?: Array<Record<string, unknown>>
  user_modules?: Array<Record<string, unknown>>
}

/**
 * Kysely stub that records the table and the `where` clauses so each query can
 * be answered from a fixture table, mirroring the filters the real queries use.
 */
function buildDb(rows: Rows) {
  return {
    selectFrom(table: string) {
      const filters: Array<[string, string, unknown]> = []
      const chain: Record<string, unknown> = {}
      chain.innerJoin = () => chain
      chain.select = () => chain
      chain.where = (column: string, op: string, value: unknown) => {
        filters.push([column.split('.').pop() as string, op, value])
        return chain
      }
      const resolve = () => {
        const source = (rows as Record<string, Array<Record<string, unknown>>>)[table] ?? []
        return source.filter((row) => filters.every(([column, op, value]) => {
          if (op === 'is') return row[column] == null
          if (op === 'in') return Array.isArray(value) && value.includes(row[column])
          return row[column] === value
        }))
      }
      chain.execute = async () => resolve()
      chain.executeTakeFirst = async () => resolve()[0]
      return chain
    },
  } as never
}

const ROLE_ACL_ROWS = [
  { user_id: ALLOWED_USER, features_json: ['wms.*'], is_super_admin: false, tenant_id: TENANT, deleted_at: null },
  { user_id: RESTRICTED_USER, features_json: ['wms.*'], is_super_admin: false, tenant_id: TENANT, deleted_at: null },
]

beforeEach(() => {
  registerModules(TEST_MODULES)
})

describe('notification recipients — entitlement narrowing', () => {
  it('drops a user the tenant admin withheld the module from', async () => {
    const db = buildDb({
      role_acls: ROLE_ACL_ROWS,
      tenant_modules: [{ tenant_id: TENANT, module_id: 'wms', is_enabled: true, deleted_at: null }],
      user_modules: [{ user_id: RESTRICTED_USER, module_id: 'wms', is_enabled: false, deleted_at: null }],
    })
    await expect(getRecipientUserIdsForFeature(db, TENANT, 'wms.stock.view')).resolves.toEqual([ALLOWED_USER])
  })

  it('notifies nobody when the tenant lost the module', async () => {
    const db = buildDb({
      role_acls: ROLE_ACL_ROWS,
      tenant_modules: [{ tenant_id: TENANT, module_id: 'wms', is_enabled: false, deleted_at: null }],
    })
    await expect(getRecipientUserIdsForFeature(db, TENANT, 'wms.stock.view')).resolves.toEqual([])
  })

  it('notifies nobody when the tenant was never provisioned (fail-closed)', async () => {
    const db = buildDb({ role_acls: ROLE_ACL_ROWS, tenant_modules: [] })
    await expect(getRecipientUserIdsForFeature(db, TENANT, 'wms.stock.view')).resolves.toEqual([])
  })

  it('keeps every grant holder when nothing is withheld', async () => {
    const db = buildDb({
      role_acls: ROLE_ACL_ROWS,
      tenant_modules: [{ tenant_id: TENANT, module_id: 'wms', is_enabled: true, deleted_at: null }],
      user_modules: [],
    })
    const recipients = await getRecipientUserIdsForFeature(db, TENANT, 'wms.stock.view')
    expect(recipients.sort()).toEqual([ALLOWED_USER, RESTRICTED_USER].sort())
  })

  it('never gates a platform-module notification on entitlement', async () => {
    const db = buildDb({
      role_acls: [{ user_id: ALLOWED_USER, features_json: ['auth.*'], is_super_admin: false, tenant_id: TENANT, deleted_at: null }],
      tenant_modules: [],
    })
    await expect(getRecipientUserIdsForFeature(db, TENANT, 'auth.users.list')).resolves.toEqual([ALLOWED_USER])
  })
})
