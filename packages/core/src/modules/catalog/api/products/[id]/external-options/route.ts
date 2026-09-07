import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CatalogProduct, CatalogProductOptionGroup, CatalogProductOption } from '../../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
}

/**
 * GET /api/catalog/products/[id]/external-options?externalProductId=xxx
 * Returns option tree (groups + options) for an external product,
 * used when selecting an option from another product as constraint target.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { ctx } = await resolveRequestContext(request)
  const productId = params.id
  const externalProductId = request.nextUrl.searchParams.get('externalProductId')

  if (!productId) throw new CrudHttpError(400, { error: 'Product ID is required' })
  if (!externalProductId) throw new CrudHttpError(400, { error: 'externalProductId query param is required' })
  if (!ctx.auth?.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  if (!ctx.auth.orgId) throw new CrudHttpError(400, { error: 'Organization context is required' })

  const tenantId = ctx.auth.tenantId
  const organizationId = ctx.auth.orgId
  const em = ctx.container.resolve<EntityManager>('em').fork()

  const externalProduct = await em.findOne(CatalogProduct, {
    id: externalProductId,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!externalProduct) throw new CrudHttpError(404, { error: 'External product not found' })

  const groups = await em.find(
    CatalogProductOptionGroup,
    { product: externalProductId, tenantId, organizationId, deletedAt: null },
    { orderBy: { sortOrder: 'asc', createdAt: 'asc' } }
  )

  const groupIds = groups.map((g) => g.id)

  let options: CatalogProductOption[] = []
  if (groupIds.length > 0) {
    options = await em.find(
      CatalogProductOption,
      { group: { $in: groupIds }, tenantId, organizationId, deletedAt: null },
      { orderBy: { sortOrder: 'asc', createdAt: 'asc' } }
    )
  }

  return NextResponse.json({
    productId: externalProductId,
    productName: (externalProduct as unknown as { title?: string }).title ?? null,
    groups: groups.map((g) => ({
      id: g.id,
      parent_option_id: (g as unknown as { parentOption?: { id: string } | null }).parentOption?.id ?? null,
      name: g.name,
    })),
    options: options.map((o) => ({
      id: o.id,
      group_id: (o as unknown as { group?: { id: string } | null }).group?.id ?? null,
      name: o.name,
    })),
  })
}

const externalOptionsResponseSchema = z.object({
  groups: z.array(
    z.object({
      id: z.string().uuid(),
      parent_option_id: z.string().uuid().nullable(),
      name: z.string(),
    }),
  ),
  options: z.array(
    z.object({
      id: z.string().uuid(),
      group_id: z.string().uuid().nullable(),
      name: z.string(),
    }),
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'External product option tree',
  methods: {
    GET: {
      summary: 'Read another product\'s option tree for constraint targeting',
      description:
        'Returns the option groups and options of `externalProductId` within the caller\'s tenant and organization, so the constraints editor can point at an option owned by a different product.',
      responses: [
        { status: 200, description: 'External product option tree', schema: externalOptionsResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing product, organization context or externalProductId' },
        { status: 401, description: 'Authentication required' },
        { status: 404, description: 'External product not found' },
      ],
    },
  },
}
