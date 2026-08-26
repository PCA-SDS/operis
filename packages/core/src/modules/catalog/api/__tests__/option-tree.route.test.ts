import { PUT } from '../products/[id]/option-tree/route'
import { NextRequest } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: jest.fn(),
}))

describe('PUT /products/[id]/option-tree', () => {
  const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
  const TENANT_ID = '22222222-2222-4222-8222-222222222222'
  const ORG_ID = '33333333-3333-4333-8333-333333333333'
  
  let commandBus: { execute: jest.Mock }
  
  beforeEach(() => {
    jest.clearAllMocks()
    commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
    
    ;(resolveRequestContext as jest.Mock).mockResolvedValue({
      ctx: {
        container: { resolve: () => commandBus },
        auth: { tenantId: TENANT_ID, orgId: ORG_ID, userId: 'user-1' },
        organizationScope: null,
        selectedOrganizationId: ORG_ID,
        organizationIds: [ORG_ID],
      },
    })
  })

  it('validates request payload and dispatches sync command', async () => {
    const payload = {
      groups: [
        { id: '44444444-4444-4444-8444-444444444444', name: 'Group 1' }
      ],
      options: [
        { id: '55555555-5555-5555-8555-555555555555', groupId: '44444444-4444-4444-8444-444444444444', name: 'Opt 1' }
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

    // Mock GET which is called at the end
    jest.mock('../products/[id]/option-tree/route', () => {
      const original = jest.requireActual('../products/[id]/option-tree/route')
      return {
        ...original,
        GET: jest.fn().mockResolvedValue(new Response(JSON.stringify({ groups: [], options: [] }))),
      }
    })

    // Calling it directly since NextResponse requires proper context if not mocked
    // We will just let it fail at GET, but we want to assert commandBus was called
    try {
      await PUT(req, { params: { id: PRODUCT_ID } })
    } catch (err: any) {
      if (!(err instanceof TypeError)) throw err // ignore NextRequest / Response internal issues in jest
    }

    expect(commandBus.execute).toHaveBeenCalledWith(
      'catalog.product_options.sync_tree',
      expect.objectContaining({
        input: expect.objectContaining({
          productId: PRODUCT_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          groups: expect.any(Array),
          options: expect.any(Array),
        }),
        ctx: expect.any(Object),
        metadata: {
          actorUserId: 'user-1',
        }
      })
    )
  })

  it('rejects without productId', async () => {
    const req = new NextRequest('http://localhost', { method: 'PUT', body: '{}' })
    await expect(PUT(req, { params: { id: '' } })).rejects.toThrow(CrudHttpError)
  })
})
