import { NextRequest } from 'next/server'
import { GET as getConstraints, PUT as putConstraints } from '../products/[id]/constraints/route'
import { GET as getExternalOptions } from '../products/[id]/external-options/route'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { CatalogProduct, CatalogProductOption, CatalogProductOptionGroup, CatalogProductConstraint } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: jest.fn(),
}))

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const EXTERNAL_PRODUCT_ID = '55555555-5555-4555-8555-555555555555'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'

function buildContext(orgId: string | null, isSuperAdmin = false) {
  const product = {
    id: PRODUCT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    deletedAt: null,
    updatedAt: new Date('2026-08-26T08:00:00.000Z'),
    title: 'Product',
  }
  const externalProduct = {
    ...product,
    id: EXTERNAL_PRODUCT_ID,
    title: 'External product',
  }
  const em = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockImplementation(async (entity: unknown, where: { id?: string }) => {
      if (entity !== CatalogProduct) return null
      return where.id === EXTERNAL_PRODUCT_ID ? externalProduct : product
    }),
    find: jest.fn().mockImplementation(async (entity: unknown) => {
      if (entity === CatalogProductOptionGroup) return []
      if (entity === CatalogProductOption) return []
      if (entity === CatalogProductConstraint) return []
      return []
    }),
  }

  return {
    container: {
      resolve: (token: string) => token === 'em' ? em : null,
    },
    auth: {
      tenantId: TENANT_ID,
      orgId,
      sub: 'user-1',
      isSuperAdmin,
    },
    em,
  }
}

describe('catalog product-scoped custom routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('resolves constraints reads using the selected record organization', async () => {
    const context = buildContext(ORG_ID)
    ;(resolveRequestContext as jest.Mock).mockResolvedValue({ ctx: context })

    const response = await getConstraints(
      new NextRequest(`http://localhost/api/catalog/products/${PRODUCT_ID}/constraints?incoming=true`),
      { params: { id: PRODUCT_ID } },
    )

    expect(response.status).toBe(200)
    expect(context.em.findOne).toHaveBeenCalledWith(
      CatalogProduct,
      expect.objectContaining({ organizationId: { $in: [ORG_ID] } }),
    )
  })

  it('allows all-organization reads but rejects writes without a concrete organization', async () => {
    const context = buildContext(null, true)
    ;(resolveRequestContext as jest.Mock).mockResolvedValue({ ctx: context })

    const readResponse = await getConstraints(
      new NextRequest(`http://localhost/api/catalog/products/${PRODUCT_ID}/constraints`),
      { params: { id: PRODUCT_ID } },
    )
    expect(readResponse.status).toBe(200)
    expect(context.em.findOne).toHaveBeenCalledWith(
      CatalogProduct,
      expect.not.objectContaining({ organizationId: expect.anything() }),
    )

    await expect(putConstraints(
      new NextRequest(`http://localhost/api/catalog/products/${PRODUCT_ID}/constraints`, {
        method: 'PUT',
        body: JSON.stringify({ constraints: [] }),
      }),
      { params: { id: PRODUCT_ID } },
    )).rejects.toMatchObject({
      body: {
        code: 'organization_scope_required',
      },
    })
  })

  it('scopes external option reads through the current product record', async () => {
    const context = buildContext(ORG_ID)
    ;(resolveRequestContext as jest.Mock).mockResolvedValue({ ctx: context })

    const response = await getExternalOptions(
      new NextRequest(
        `http://localhost/api/catalog/products/${PRODUCT_ID}/external-options?externalProductId=${EXTERNAL_PRODUCT_ID}`,
      ),
      { params: { id: PRODUCT_ID } },
    )

    expect(response.status).toBe(200)
    expect(context.em.findOne).toHaveBeenNthCalledWith(
      1,
      CatalogProduct,
      expect.objectContaining({ organizationId: { $in: [ORG_ID] } }),
    )
    expect(context.em.findOne).toHaveBeenNthCalledWith(
      2,
      CatalogProduct,
      expect.objectContaining({ organizationId: ORG_ID }),
    )
  })
})
