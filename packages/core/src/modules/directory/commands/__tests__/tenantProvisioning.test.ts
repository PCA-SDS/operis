/** @jest-environment node */

// A tenant created from Directory → Tenants used to get no roles and no module
// defaults, so its owner could not be assigned `admin` and every dictionary was
// empty. Creating the tenant now seeds its default roles, and creating the
// tenant's first organization runs the module setup hooks for it.

jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({
  ensureTenantDefaultRoles: jest.fn(async () => {}),
  seedOrganizationDefaults: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('@open-mercato/core/modules/directory/lib/hierarchy', () => ({
  ...jest.requireActual('@open-mercato/core/modules/directory/lib/hierarchy'),
  rebuildHierarchyForTenant: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(async () => {}),
}))

import '@open-mercato/core/modules/directory/commands/tenants'
import '@open-mercato/core/modules/directory/commands/organizations'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import {
  ensureTenantDefaultRoles,
  seedOrganizationDefaults,
} from '@open-mercato/core/modules/auth/lib/setup-app'

const ACTOR_TENANT_ID = '11111111-1111-4111-8111-111111111111'
const NEW_TENANT_ID = '33333333-3333-4333-8333-333333333333'
const NEW_ORG_ID = 'aaaa1111-0000-4000-8000-000000000001'
const EXISTING_ORG_ID = 'bbbb2222-0000-4000-8000-000000000002'

const ensureTenantDefaultRolesMock = ensureTenantDefaultRoles as jest.MockedFunction<typeof ensureTenantDefaultRoles>
const seedOrganizationDefaultsMock = seedOrganizationDefaults as jest.MockedFunction<typeof seedOrganizationDefaults>

function makeEm(existingOrganizationId: string | null = null) {
  return {
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    findOne: jest.fn(async (entity: unknown) =>
      entity === Organization && existingOrganizationId ? { id: existingOrganizationId } : null,
    ),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => {}),
    persist: jest.fn(() => ({ flush: jest.fn(async () => {}) })),
  }
}

function makeDataEngine(id: string) {
  return {
    createOrmEntity: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id, ...data })),
    setCustomFields: jest.fn(async () => {}),
  }
}

function makeCtx(em: ReturnType<typeof makeEm>, de: ReturnType<typeof makeDataEngine>) {
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return de
      if (token === 'kmsService') return { isHealthy: () => false }
      if (token === 'tenantModuleService') return { provisionTenant: async () => {} }
      if (token === 'rbacService') return { loadAcl: async () => ({ isSuperAdmin: true }) }
      throw new Error(`[internal] Unexpected DI token: ${token}`)
    },
  }
  return {
    container,
    auth: { sub: 'user-1', tenantId: ACTOR_TENANT_ID, orgId: null, isSuperAdmin: true },
  } as unknown as Parameters<CommandHandler['execute']>[1]
}

describe('directory provisioning of UI-created tenants', () => {
  afterEach(() => jest.clearAllMocks())

  it('seeds the default roles of a newly created tenant', async () => {
    const em = makeEm()
    const handler = commandRegistry.get('directory.tenants.create') as CommandHandler

    await handler.execute({ name: 'Bloom Bakery' }, makeCtx(em, makeDataEngine(NEW_TENANT_ID)))

    expect(ensureTenantDefaultRolesMock).toHaveBeenCalledTimes(1)
    expect(ensureTenantDefaultRolesMock).toHaveBeenCalledWith(em, NEW_TENANT_ID)
  })

  it('still creates the tenant when seeding its roles fails', async () => {
    ensureTenantDefaultRolesMock.mockRejectedValueOnce(new Error('[internal] db unavailable'))
    const handler = commandRegistry.get('directory.tenants.create') as CommandHandler

    const tenant = await handler.execute({ name: 'Bloom Bakery' }, makeCtx(makeEm(), makeDataEngine(NEW_TENANT_ID)))

    expect(tenant).toMatchObject({ id: NEW_TENANT_ID, name: 'Bloom Bakery' })
  })

  it('runs the module setup hooks for the first organization of a tenant', async () => {
    const em = makeEm(null)
    const ctx = makeCtx(em, makeDataEngine(NEW_ORG_ID))
    const handler = commandRegistry.get('directory.organizations.create') as CommandHandler

    await handler.execute({ name: 'Bloom Bakery HQ', tenantId: NEW_TENANT_ID }, ctx)

    expect(seedOrganizationDefaultsMock).toHaveBeenCalledTimes(1)
    expect(seedOrganizationDefaultsMock).toHaveBeenCalledWith({
      em,
      container: ctx.container,
      tenantId: NEW_TENANT_ID,
      organizationId: NEW_ORG_ID,
    })
  })

  it('does not reseed a tenant that already has an organization', async () => {
    const handler = commandRegistry.get('directory.organizations.create') as CommandHandler

    await handler.execute(
      { name: 'Bloom Bakery Kitchen', tenantId: NEW_TENANT_ID },
      makeCtx(makeEm(EXISTING_ORG_ID), makeDataEngine(NEW_ORG_ID)),
    )

    expect(seedOrganizationDefaultsMock).not.toHaveBeenCalled()
  })
})
