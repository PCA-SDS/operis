import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProduct, CatalogProductOptionGroup, CatalogProductOption, CatalogProductPrice } from '../../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CatalogProductOptionTreeSyncInput } from '../../../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
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
  updated_at: z.string().nullable(),
  groups: z.array(optionGroupSchema),
  options: z.array(optionSchema),
})

function latestIso(values: Array<Date | null | undefined>): string | null {
  const candidates = values
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
    .map((value) => value.toISOString())
  if (candidates.length === 0) return null
  return candidates.reduce((latest, current) => (current > latest ? current : latest))
}

const syncGroupBodySchema = z.object({
  id: z.string().uuid(),
  parent_option_id: z.string().uuid().nullable().optional(),
  parentOptionId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().nullable().optional(),
  requirement: z.enum(['required', 'optional']).optional(),
  select_mode: z.enum(['single', 'multiple']).optional(),
  selectMode: z.enum(['single', 'multiple']).optional(),
  sort_order: z.coerce.number().int().optional(),
  sortOrder: z.coerce.number().int().optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

const syncOptionBodySchema = z
  .object({
    id: z.string().uuid(),
    group_id: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    code: z.string().trim().toLowerCase().max(150).nullable().optional(),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().nullable().optional(),
    note: z.string().trim().max(100).nullable().optional(),
    unit: z.string().trim().max(50).nullable().optional(),
    price_flat: z.string().nullable().optional(),
    priceFlat: z.string().nullable().optional(),
    price_min: z.string().nullable().optional(),
    priceMin: z.string().nullable().optional(),
    price_max: z.string().nullable().optional(),
    priceMax: z.string().nullable().optional(),
    duration_value: z.coerce.number().int().min(0).nullable().optional(),
    durationValue: z.coerce.number().int().min(0).nullable().optional(),
    duration_unit: z.string().trim().max(20).nullable().optional(),
    durationUnit: z.string().trim().max(20).nullable().optional(),
    duration_min: z.coerce.number().int().min(0).nullable().optional(),
    durationMin: z.coerce.number().int().min(0).nullable().optional(),
    duration_max: z.coerce.number().int().min(0).nullable().optional(),
    durationMax: z.coerce.number().int().min(0).nullable().optional(),
    is_addon: z.boolean().optional(),
    isAddon: z.boolean().optional(),
    sort_order: z.coerce.number().int().optional(),
    sortOrder: z.coerce.number().int().optional(),
    is_active: z.boolean().optional(),
    isActive: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.group_id && !value.groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groupId'],
        message: 'groupId is required',
      })
    }
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
  const product = await em.findOne(CatalogProduct, {
    id: productId,
    tenantId,
    organizationId,
    deletedAt: null,
  })

  // Fetch all groups for this product
  const groups = await em.find(
    CatalogProductOptionGroup,
    { product: productId, tenantId, organizationId, deletedAt: null },
    { orderBy: { sortOrder: 'asc', createdAt: 'asc' } }
  )

  const groupIds = groups.map((g) => g.id)

  let options: CatalogProductOption[] = []
  if (groupIds.length > 0) {
    // Fetch all options for these groups
    options = await em.find(
      CatalogProductOption,
      { group: { $in: groupIds }, tenantId, organizationId, deletedAt: null },
      { orderBy: { sortOrder: 'asc', createdAt: 'asc' } }
    )
  }

  // Fetch currency from product prices (fallback to VND)
  let currencyCode = 'VND'
  if (productId) {
    const price = await em.findOne(CatalogProductPrice, {
      product: productId,
      tenantId,
      organizationId,
    })
    if (price?.currencyCode) {
      currencyCode = price.currencyCode
    }
  }

  // Serialize entities
  const aggregateUpdatedAt = latestIso([
    product?.updatedAt ?? null,
    ...groups.map((group) => group.updatedAt ?? null),
    ...options.map((option) => option.updatedAt ?? null),
  ])

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
    updated_at: aggregateUpdatedAt,
    currency_code: currencyCode,
    groups: serializedGroups,
    options: serializedOptions,
  })
}

const syncBodySchema = z.object({
  groups: z.array(syncGroupBodySchema),
  options: z.array(syncOptionBodySchema),
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

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    throw new CrudHttpError(400, { error: 'Invalid JSON body' })
  }

  const parsedBody = syncBodySchema.safeParse(rawBody)
  if (!parsedBody.success) {
    throw new CrudHttpError(400, {
      error: 'Invalid request body',
      details: parsedBody.error.flatten(),
    })
  }

  const payload: CatalogProductOptionTreeSyncInput = {
    productId,
    tenantId: ctx.auth.tenantId,
    organizationId: ctx.auth.orgId,
    groups: parsedBody.data.groups.map((g) => ({
      id: g.id,
      parentOptionId: g.parent_option_id ?? g.parentOptionId ?? null,
      name: g.name,
      description: g.description ?? null,
      requirement: g.requirement ?? 'required',
      selectMode: g.select_mode ?? g.selectMode ?? 'single',
      sortOrder: g.sort_order ?? g.sortOrder ?? 0,
      isActive: g.is_active ?? g.isActive ?? true,
      metadata: g.metadata ?? null,
    })),
    options: parsedBody.data.options.map((o) => {
      const groupId = o.group_id ?? o.groupId
      if (!groupId) {
        throw new CrudHttpError(400, { error: 'Invalid request body' })
      }

      return {
        id: o.id,
        groupId,
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
      }
    }),
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
