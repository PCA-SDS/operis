import { GET, PUT } from '../products/[id]/option-tree/route'
import { NextRequest } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { CatalogProductOption, CatalogProductOptionGroup, CatalogProduct } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: jest.fn(),
}))

describe('PUT /products/[id]/option-tree', () => {
  const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
  const TENANT_ID = '22222222-2222-4222-8222-222222222222'
  const ORG_ID = '33333333-3333-4333-8333-333333333333'
  
  let commandBus: { execute: jest.Mock }
  let em: { fork: jest.Mock; find: jest.Mock; findOne: jest.Mock }
  
  beforeEach(() => {
    jest.clearAllMocks()
    commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
    em = {
      fork: jest.fn(),
      // The route reads the product to scope the tree and to resolve the display
      // currency, and 404s without it — so the default stub has to return one.
      findOne: jest.fn().mockImplementation(async (entity) =>
        entity === CatalogProduct
          ? {
              id: PRODUCT_ID,
              tenantId: TENANT_ID,
              organizationId: ORG_ID,
              deletedAt: null,
              primaryCurrencyCode: null,
              updatedAt: new Date('2026-08-26T08:00:00.000Z'),
            }
          : null,
      ),
      find: jest.fn().mockImplementation(async (entity) => {
        if (entity === CatalogProductOptionGroup) return []
        if (entity === CatalogProductOption) return []
        return []
      }),
    }
    em.fork.mockReturnValue(em)
    
    ;(resolveRequestContext as jest.Mock).mockResolvedValue({
      ctx: {
        container: {
          resolve: (token: string) => {
            if (token === 'commandBus') return commandBus
            if (token === 'em') return em
            return null
          },
        },
        auth: { tenantId: TENANT_ID, orgId: ORG_ID, userId: 'user-1' },
        organizationScope: null,
        selectedOrganizationId: ORG_ID,
        organizationIds: [ORG_ID],
      },
    })
  })

  it('maps the payload and dispatches sync command', async () => {
    const payload = {
      groups: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Group 1',
          requirement: 'required',
          select_mode: 'multiple',
          sort_order: 2,
        }
      ],
      options: [
        {
          id: '55555555-5555-5555-8555-555555555555',
          group_id: '44444444-4444-4444-8444-444444444444',
          name: 'Opt 1',
          price_flat: '100000',
          duration_value: 45,
        }
      ]
    }

    const req = new NextRequest('http://localhost/api/products/1/option-tree', {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: {
        'x-forwarded-for': '127.0.0.1',
        'user-agent': 'jest-test',
      }
    })

    const response = await PUT(req, { params: { id: PRODUCT_ID } })

    expect(commandBus.execute).toHaveBeenCalledWith(
      'catalog.product_options.sync_tree',
      expect.objectContaining({
        input: expect.objectContaining({
          productId: PRODUCT_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          groups: [
            expect.objectContaining({
              id: '44444444-4444-4444-8444-444444444444',
              parentOptionId: null,
              name: 'Group 1',
              requirement: 'required',
              selectMode: 'multiple',
              sortOrder: 2,
            }),
          ],
          options: [
            expect.objectContaining({
              id: '55555555-5555-5555-8555-555555555555',
              groupId: '44444444-4444-4444-8444-444444444444',
              name: 'Opt 1',
              priceFlat: '100000',
              durationValue: 45,
            }),
          ],
        }),
        ctx: expect.any(Object),
        metadata: {
          actorUserId: 'user-1',
        }
      })
    )

    await expect(response.json()).resolves.toMatchObject({
      // Aggregate lock token: with no groups or options yet it is the product's own updatedAt.
      updated_at: '2026-08-26T08:00:00.000Z',
      groups: [],
      options: [],
      constraints: [],
    })
  })

  it('rejects without productId', async () => {
    const req = new NextRequest('http://localhost', { method: 'PUT', body: '{}' })
    await expect(PUT(req, { params: { id: '' } })).rejects.toThrow(CrudHttpError)
  })

  it('rejects malformed json with 400', async () => {
    const req = new NextRequest('http://localhost/api/products/1/option-tree', {
      method: 'PUT',
      body: '{',
      headers: { 'content-type': 'application/json' },
    })

    await expect(PUT(req, { params: { id: PRODUCT_ID } })).rejects.toMatchObject({
      body: { error: 'Invalid JSON body' },
    })
  })

  it('rejects invalid payload with 400 before dispatch', async () => {
    const req = new NextRequest('http://localhost/api/products/1/option-tree', {
      method: 'PUT',
      body: JSON.stringify({
        groups: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Group 1' }],
        options: [{ id: '55555555-5555-5555-8555-555555555555', name: 'Opt 1' }],
      }),
    })

    await expect(PUT(req, { params: { id: PRODUCT_ID } })).rejects.toMatchObject({
      body: expect.objectContaining({ error: 'Invalid request body' }),
    })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})

describe('GET /products/[id]/option-tree org-scoped isolation', () => {
  const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
  const TENANT_ID = '22222222-2222-4222-8222-222222222222'
  const ORG_A = '33333333-3333-4333-8333-333333333333'
  const ORG_B = '44444444-4444-4444-8444-444444444444'

  let mockEm: ReturnType<typeof buildMockEm>

  function buildMockEm() {
    const mockProduct = {
      id: PRODUCT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_A,
      deletedAt: null,
      updatedAt: new Date('2026-08-26T08:00:00.000Z'),
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(mockProduct),
      find: jest.fn().mockImplementation(async (entity) => {
        if (entity === CatalogProductOptionGroup) return []
        if (entity === CatalogProductOption) return []
        return []
      }),
    }
    return { em, mockProduct }
  }

  function buildContext(orgId: string) {
    return {
      container: {
        resolve: (token: string) => {
          if (token === 'em') return mockEm.em
          return null
        },
      },
      auth: { tenantId: TENANT_ID, orgId },
      organizationScope: null,
      selectedOrganizationId: orgId,
      organizationIds: [orgId],
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockEm = buildMockEm()
    ;(resolveRequestContext as jest.Mock).mockResolvedValue({ ctx: buildContext(ORG_A) })
  })

  it('scopes GET by organizationId from auth context', async () => {
    const req = new NextRequest('http://localhost/api/products/1/option-tree', {
      method: 'GET',
      headers: { 'user-agent': 'jest-test' },
    })

    await GET(req, { params: { id: PRODUCT_ID } })

    expect(mockEm.em.findOne).toHaveBeenCalledWith(
      CatalogProduct,
      expect.objectContaining({
        id: PRODUCT_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_A,
        deletedAt: null,
      }),
    )
    expect(mockEm.em.findOne).toHaveBeenCalledWith(
      CatalogProduct,
      expect.not.objectContaining({ organizationId: ORG_B }),
    )
  })

  it('fails closed when organization context is absent', async () => {
    ;(resolveRequestContext as jest.Mock).mockResolvedValue({
      ctx: {
        container: { resolve: () => mockEm.em },
        auth: { tenantId: TENANT_ID, orgId: null },
        organizationScope: null,
        selectedOrganizationId: null,
        organizationIds: null,
      },
    })

    const req = new NextRequest('http://localhost/api/products/1/option-tree', {
      method: 'GET',
      headers: { 'user-agent': 'jest-test' },
    })

    await expect(GET(req, { params: { id: PRODUCT_ID } })).rejects.toMatchObject({
      body: { error: 'Organization context is required' },
    })
  })
})

describe('PUT /products/[id]/option-tree org-scoped isolation', () => {
  const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
  const TENANT_ID = '22222222-2222-4222-8222-222222222222'
  const ORG_A = '33333333-3333-4333-8333-333333333333'

  let commandBus: { execute: jest.Mock }
  let mockEm: ReturnType<typeof buildMockEm>

  function buildMockEm() {
    const mockProduct = {
      id: PRODUCT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_A,
      deletedAt: null,
      updatedAt: new Date('2026-08-26T08:00:00.000Z'),
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(mockProduct),
      find: jest.fn().mockImplementation(async (entity) => {
        if (entity === CatalogProductOptionGroup) return []
        if (entity === CatalogProductOption) return []
        return []
      }),
    }
    return { em, mockProduct }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
    mockEm = buildMockEm()

    ;(resolveRequestContext as jest.Mock).mockResolvedValue({
      ctx: {
        container: {
          resolve: (token: string) => {
            if (token === 'commandBus') return commandBus
            if (token === 'em') return mockEm.em
            return null
          },
        },
        auth: { tenantId: TENANT_ID, orgId: ORG_A, userId: 'user-1' },
        organizationScope: null,
        selectedOrganizationId: ORG_A,
        organizationIds: [ORG_A],
      },
    })
  })

  it('dispatches command with org-scoped tenantId and organizationId', async () => {
    const payload = {
      groups: [],
      options: [],
    }
    const req = new NextRequest('http://localhost/api/products/1/option-tree', {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    })

    await PUT(req, { params: { id: PRODUCT_ID } })

    expect(commandBus.execute).toHaveBeenCalledWith(
      'catalog.product_options.sync_tree',
      expect.objectContaining({
        input: expect.objectContaining({
          productId: PRODUCT_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_A,
        }),
      }),
    )
  })
})
