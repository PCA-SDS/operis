import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductOptionGroup, CatalogProductOption } from '../../../../data/entities'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { ctx } = await resolveRequestContext(request)
  const productId = params.id

  if (!productId) {
    throw new CrudHttpError(400, { error: 'Product ID is required' })
  }
  if (!ctx.auth?.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }

  const em = ctx.container.resolve<EntityManager>('em').fork()
  const tenantId = ctx.auth.tenantId

  // Fetch all groups for this product
  const groups = await em.find(
    CatalogProductOptionGroup,
    { product: productId, tenantId },
    { orderBy: { sortOrder: 'asc', createdAt: 'asc' } }
  )

  const groupIds = groups.map((g) => g.id)

  let options: CatalogProductOption[] = []
  if (groupIds.length > 0) {
    // Fetch all options for these groups
    options = await em.find(
      CatalogProductOption,
      { group: { $in: groupIds }, tenantId },
      { orderBy: { sortOrder: 'asc', createdAt: 'asc' } }
    )
  }

  // Serialize entities
  const serializedGroups = groups.map((g) => ({
    id: g.id,
    product_id: g.product.id,
    parent_option_id: g.parentOption?.id ?? null,
    name: g.name,
    description: g.description,
    requirement: g.requirement,
    select_mode: g.selectMode,
    sort_order: g.sortOrder,
    is_active: g.isActive,
    metadata: g.metadata,
  }))

  const serializedOptions = options.map((o) => ({
    id: o.id,
    group_id: o.group.id,
    code: o.code,
    name: o.name,
    description: o.description,
    note: o.note,
    unit: o.unit,
    price_flat: o.priceFlat,
    price_min: o.priceMin,
    price_max: o.priceMax,
    duration_value: o.durationValue,
    duration_unit: o.durationUnit,
    duration_min: o.durationMin,
    duration_max: o.durationMax,
    is_addon: o.isAddon,
    sort_order: o.sortOrder,
    is_active: o.isActive,
    metadata: o.metadata,
  }))

  return NextResponse.json({
    groups: serializedGroups,
    options: serializedOptions,
  })
}
