/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { GET } from '../areas'
import { ResourcesResourceArea } from '../../data/entities'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const auth = { sub: 'user-1', tenantId, orgId: organizationId }

const dispose = jest.fn()
const mockFind = jest.fn()
const mockCount = jest.fn()
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return { find: mockFind, count: mockCount } as unknown as EntityManager
    return {}
  }),
  dispose,
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => auth),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ tenantId, organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveOrganizationScopeFilter: jest.fn(() => ({
    where: { organizationId },
    rbacOrganizationId: organizationId,
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

function area(input: {
  id: string
  name: string
  parentAreaId?: string | null
  childCount?: number
}) {
  return {
    id: input.id,
    tenantId,
    organizationId,
    name: input.name,
    description: null,
    areaType: null,
    parentAreaId: input.parentAreaId ?? null,
    sortOrder: 0,
    appearanceIcon: null,
    appearanceColor: null,
    isActive: true,
    updatedAt: new Date('2026-09-08T00:00:00.000Z'),
    deletedAt: null,
    childCount: input.childCount ?? 0,
  }
}

async function read(url: string) {
  const response = await GET(new Request(`http://localhost${url}`))
  return response.json()
}

beforeEach(() => {
  mockFind.mockReset()
  mockCount.mockReset()
  dispose.mockClear()
  container.resolve.mockClear()
  mockCount.mockResolvedValue(1)
  mockFind.mockResolvedValue([])
})

describe('resource areas GET', () => {
  it('uses a scoped id query for ids lookups', async () => {
    const requested = area({ id: 'area-parent', name: 'Parent' })
    mockFind.mockResolvedValueOnce([requested])
    mockCount.mockResolvedValueOnce(1)
    mockCount.mockResolvedValueOnce(0)

    const body = await read('/api/resources/areas?ids=area-parent&page=1&pageSize=1')

    expect(mockCount).toHaveBeenNthCalledWith(1, ResourcesResourceArea, expect.objectContaining({
      organizationId,
      tenantId,
      deletedAt: null,
      id: 'area-parent',
    }))
    expect(mockFind).toHaveBeenNthCalledWith(1, ResourcesResourceArea, expect.objectContaining({
      organizationId,
      tenantId,
      deletedAt: null,
      id: 'area-parent',
    }), expect.objectContaining({ limit: 1, offset: 0 }))
    expect(body.items).toEqual([expect.objectContaining({ id: 'area-parent', path_label: 'Parent' })])
  })

  it('loads root children directly for lazy tree pages', async () => {
    const root = area({ id: 'area-root', name: 'Head Office' })
    mockFind.mockResolvedValueOnce([root])
    mockCount.mockResolvedValueOnce(1)
    mockCount.mockResolvedValueOnce(0)

    const body = await read('/api/resources/areas?parentAreaId=null&page=1&pageSize=100')

    expect(mockCount).toHaveBeenNthCalledWith(1, ResourcesResourceArea, expect.objectContaining({
      organizationId,
      tenantId,
      deletedAt: null,
      parentAreaId: null,
    }))
    expect(mockFind).toHaveBeenNthCalledWith(1, ResourcesResourceArea, expect.objectContaining({
      organizationId,
      tenantId,
      deletedAt: null,
      parentAreaId: null,
    }), expect.objectContaining({ limit: 100, offset: 0 }))
    expect(body.items[0]).toEqual(expect.objectContaining({ id: 'area-root', child_count: 0 }))
  })

  it('excludes the current area subtree from parent option lookups', async () => {
    mockFind
      .mockResolvedValueOnce([area({ id: 'area-child', name: 'Child', parentAreaId: 'area-current' })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([area({ id: 'area-root', name: 'Root' })])
    mockCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)

    const body = await read('/api/resources/areas?parentAreaId=null&excludeSubtreeOf=area-current&page=1&pageSize=100')

    expect(mockFind).toHaveBeenNthCalledWith(1, ResourcesResourceArea, expect.objectContaining({
      parentAreaId: 'area-current',
    }), expect.any(Object))
    expect(mockFind).toHaveBeenNthCalledWith(3, ResourcesResourceArea, expect.objectContaining({
      parentAreaId: null,
      id: { $nin: ['area-current', 'area-child'] },
    }), expect.any(Object))
    expect(body.items).toEqual([expect.objectContaining({ id: 'area-root' })])
  })
})
