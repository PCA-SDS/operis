/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Module } from '@open-mercato/shared/modules/registry'
import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import {
  ensureTenantDefaultRoles,
  seedOrganizationDefaults,
} from '@open-mercato/core/modules/auth/lib/setup-app'

const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'

type Row = Record<string, unknown>

function makeStore() {
  const roles: Row[] = []
  const roleAcls: Row[] = []
  const tableFor = (entity: unknown) => (entity === Role ? roles : entity === RoleAcl ? roleAcls : null)
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value)
  const em: Record<string, unknown> = {
    findOne: jest.fn(async (entity: unknown, where: Row) => tableFor(entity)?.find((row) => matches(row, where)) ?? null),
    find: jest.fn(async (entity: unknown, where: Row) => tableFor(entity)?.filter((row) => matches(row, where)) ?? []),
    create: jest.fn((_entity: unknown, data: Row) => ({ ...data })),
    persist: jest.fn((row: Row) => {
      if ('featuresJson' in row) {
        if (!roleAcls.includes(row)) roleAcls.push(row)
      } else if ('name' in row && !roles.includes(row)) {
        roles.push({ id: `role-${String(row.name)}`, ...row })
      }
      return em
    }),
    flush: jest.fn(async () => {}),
    fork: jest.fn(() => em),
    transactional: jest.fn(async (run: (tem: unknown) => Promise<unknown>) => run(em)),
  }
  return { em: em as unknown as EntityManager, roles, roleAcls }
}

const modules: Module[] = [
  {
    id: 'customers',
    setup: {
      defaultRoleFeatures: {
        superadmin: ['customers.platform_only'],
        admin: ['customers.*'],
        employee: ['customers.people.view'],
      },
    },
  },
]

describe('ensureTenantDefaultRoles', () => {
  it('creates the admin and employee roles with their default grants and no superadmin role', async () => {
    const { em, roles, roleAcls } = makeStore()

    await ensureTenantDefaultRoles(em, TENANT_ID, modules)

    expect(roles.map((role) => role.name).sort()).toEqual(['admin', 'employee'])
    expect(roles.every((role) => role.tenantId === TENANT_ID)).toBe(true)
    const featuresByRole = new Map(roleAcls.map((acl) => [(acl.role as Row).name, acl.featuresJson]))
    expect(featuresByRole.get('admin')).toEqual(['customers.*'])
    expect(featuresByRole.get('employee')).toEqual(['customers.people.view'])
    expect(roleAcls.some((acl) => acl.isSuperAdmin)).toBe(false)
    expect(roleAcls.flatMap((acl) => acl.featuresJson as string[])).not.toContain('customers.platform_only')
  })

  it('is idempotent when run again for the same tenant', async () => {
    const { em, roles, roleAcls } = makeStore()

    await ensureTenantDefaultRoles(em, TENANT_ID, modules)
    await ensureTenantDefaultRoles(em, TENANT_ID, modules)

    expect(roles).toHaveLength(2)
    expect(roleAcls).toHaveLength(2)
  })
})

describe('seedOrganizationDefaults', () => {
  it('runs every onTenantCreated hook before any seedDefaults hook, scoped to the organization', async () => {
    const { em } = makeStore()
    const container = { resolve: jest.fn() } as never
    const calls: string[] = []
    const scopes: Row[] = []
    const record = (label: string) => async (ctx: Row) => {
      calls.push(label)
      scopes.push({ tenantId: ctx.tenantId, organizationId: ctx.organizationId, container: ctx.container })
    }
    const hookModules: Module[] = [
      { id: 'first', setup: { onTenantCreated: record('first:onTenantCreated'), seedDefaults: record('first:seedDefaults') } },
      { id: 'second', setup: { onTenantCreated: record('second:onTenantCreated'), seedDefaults: record('second:seedDefaults') } },
    ]

    await seedOrganizationDefaults({ em, container, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, modules: hookModules })

    expect(calls).toEqual([
      'first:onTenantCreated',
      'second:onTenantCreated',
      'first:seedDefaults',
      'second:seedDefaults',
    ])
    expect(scopes.every((scope) => scope.tenantId === TENANT_ID && scope.organizationId === ORGANIZATION_ID)).toBe(true)
    expect(scopes.filter((scope) => scope.container === container)).toHaveLength(2)
  })

  it('keeps seeding the remaining modules when one hook fails', async () => {
    const { em } = makeStore()
    const seeded: string[] = []
    const hookModules: Module[] = [
      { id: 'broken', setup: { seedDefaults: async () => { throw new Error('[internal] seed failed') } } },
      { id: 'healthy', setup: { seedDefaults: async () => { seeded.push('healthy') } } },
    ]

    await expect(
      seedOrganizationDefaults({ em, container: {} as never, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, modules: hookModules }),
    ).resolves.toBeUndefined()

    expect(seeded).toEqual(['healthy'])
  })
})
