import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProductOptionGroup, CatalogProductOption } from '../../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.products.update'] },
}

const optionGroupSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  parent_option_id: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable().optional(),
  requirement: z.string(),
  select_mode: z.string(),
  sort_order: z.number(),
  is_active: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

const optionSchema = z.object({
  id: z.string().uuid(),
  group_id: z.string().uuid(),
  code: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  price_flat: z.string().nullable().optional(),
  price_min: z.string().nullable().optional(),
  price_max: z.string().nullable().optional(),
  duration_value: z.number().nullable().optional(),
  duration_unit: z.string().nullable().optional(),
  duration_min: z.number().nullable().optional(),
  duration_max: z.number().nullable().optional(),
  is_addon: z.boolean(),
  sort_order: z.number(),
  is_active: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

const responseSchema = z.object({
  groups: z.array(optionGroupSchema),
  options: z.array(optionSchema),
})

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
  if (!ctx.auth.orgId) {
    throw new CrudHttpError(400, { error: 'Organization context is required' })
  }

  const em = ctx.container.resolve<EntityManager>('em').fork()
  const tenantId = ctx.auth.tenantId
  const organizationId = ctx.auth.orgId

  // Fetch all groups for this product
  const groups = await em.find(
    CatalogProductOptionGroup,
    { product: productId, tenantId, organizationId },
    { orderBy: { sortOrder: 'asc', createdAt: 'asc' } }
  )

  const groupIds = groups.map((g) => g.id)

  let options: CatalogProductOption[] = []
  if (groupIds.length > 0) {
    // Fetch all options for these groups
    options = await em.find(
      CatalogProductOption,
      { group: { $in: groupIds }, tenantId, organizationId },
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

const syncBodySchema = z.object({
  groups: z.array(z.any()),
  options: z.array(z.any()),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { ctx } = await resolveRequestContext(request)
  const productId = params.id

  if (!productId) throw new CrudHttpError(400, { error: 'Product ID is required' })
  if (!ctx.auth?.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  if (!ctx.auth.orgId) throw new CrudHttpError(400, { error: 'Organization context is required' })

  const body = await request.json()

  const payload = {
    productId,
    tenantId: ctx.auth.tenantId,
    organizationId: ctx.auth.orgId,
    groups: (body.groups || []).map((g: any) => ({
      id: g.id,
      parentOptionId: g.parent_option_id ?? g.parentOptionId ?? null,
      name: g.name,
      description: g.description ?? null,
      requirement: g.requirement ?? 'optional',
      selectMode: g.select_mode ?? g.selectMode ?? 'single',
      sortOrder: g.sort_order ?? g.sortOrder ?? 0,
      isActive: g.is_active ?? g.isActive ?? true,
      metadata: g.metadata ?? null,
    })),
    options: (body.options || []).map((o: any) => ({
      id: o.id,
      groupId: o.group_id ?? o.groupId,
      code: o.code ?? null,
      name: o.name,
      description: o.description ?? null,
      note: o.note ?? null,
      unit: o.unit ?? null,
      priceFlat: o.price_flat ?? o.priceFlat ?? null,
      priceMin: o.price_min ?? o.priceMin ?? null,
      priceMax: o.price_max ?? o.priceMax ?? null,
      durationValue: o.duration_value ?? o.durationValue ?? null,
      durationUnit: o.duration_unit ?? o.durationUnit ?? null,
      durationMin: o.duration_min ?? o.durationMin ?? null,
      durationMax: o.duration_max ?? o.durationMax ?? null,
      isAddon: o.is_addon ?? o.isAddon ?? false,
      sortOrder: o.sort_order ?? o.sortOrder ?? 0,
      isActive: o.is_active ?? o.isActive ?? true,
      metadata: o.metadata ?? null,
    })),
  }

  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  await commandBus.execute('catalog.product_options.sync_tree', {
    input: payload,
    ctx: {
      container: ctx.container,
      auth: ctx.auth,
      organizationScope: ctx.organizationScope as any,
      selectedOrganizationId: ctx.selectedOrganizationId ?? null,
      organizationIds: ctx.organizationIds ?? null,
      request: request as any,
    },
    metadata: {
      actorUserId: ctx.auth?.userId ?? null,
    },
  })

  // Call GET logic manually to bypass generic fetch
  return GET(request, { params })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog product option tree',
  methods: {
    GET: {
      summary: 'Read product option tree',
      tags: ['Catalog'],
      responses: [
        { status: 200, description: 'Product option tree', schema: responseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing product or organization context' },
        { status: 401, description: 'Authentication required' },
      ],
    },
    PUT: {
      summary: 'Sync product option tree',
      tags: ['Catalog'],
      requestBody: { schema: syncBodySchema },
      responses: [
        { status: 200, description: 'Updated option tree', schema: responseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload or context' },
        { status: 401, description: 'Authentication required' },
      ],
    },
  },
}
