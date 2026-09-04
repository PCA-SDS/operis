/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_AREA_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEST_PARENT_AREA_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function buildFakeEm() {
  return {
    flush: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  }
}

function buildEnvelope(em: ReturnType<typeof buildFakeEm>) {
  const container = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      return {}
    }),
  }
  const ctx = {
    container,
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  }
  return { ctx }
}

describe('resource area reorder command', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../areas')
  })

  it('reorders areas within the same parent area', async () => {
    const em = buildFakeEm()
    const areaA = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      parentAreaId: TEST_PARENT_AREA_ID,
      name: 'Floor A',
      sortOrder: 0,
      updatedAt: new Date('2026-06-19T10:00:00.000Z'),
    }
    const areaB = {
      id: TEST_AREA_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      parentAreaId: TEST_PARENT_AREA_ID,
      name: 'Floor B',
      sortOrder: 1,
      updatedAt: new Date('2026-06-19T10:00:00.000Z'),
    }
    em.findOne.mockResolvedValue(areaB)
    em.find.mockResolvedValue([areaA, areaB])
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resourceAreas.reorder')

    await handler!.execute(
      { id: TEST_AREA_ID, tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, direction: 'up' },
      ctx as any,
    )

    expect(areaB.sortOrder).toBe(0)
    expect(areaA.sortOrder).toBe(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
