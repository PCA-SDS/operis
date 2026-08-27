import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogProduct, CatalogProductConstraint } from '../../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { ProductConstraintsSyncInput } from '../../../../data/validators'
import { CATALOG_CONSTRAINT_TYPES } from '../../../../data/types'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.constraints.manage'] },
}

const constraintResponseSchema = z.object({
  id: z.string().uuid(),
  constraint_type: z.enum(CATALOG_CONSTRAINT_TYPES),
  source_product_id: z.string().uuid().nullable(),
  source_option_id: z.string().uuid().nullable(),
  target_product_id: z.string().uuid().nullable(),
  target_option_id: z.string().uuid().nullable(),
  locked: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

const responseSchema = z.object({
  updated_at: z.string().nullable(),
  constraints: z.array(constraintResponseSchema),
})

const syncConstraintBodySchema = z
  .object({
    id: z.string().uuid().optional(),
    constraint_type: z.enum(CATALOG_CONSTRAINT_TYPES).optional(),
    constraintType: z.enum(CATALOG_CONSTRAINT_TYPES).optional(),
    source_product_id: z.string().uuid().nullable().optional(),
    sourceProductId: z.string().uuid().nullable().optional(),
    source_option_id: z.string().uuid().nullable().optional(),
    sourceOptionId: z.string().uuid().nullable().optional(),
    target_product_id: z.string().uuid().nullable().optional(),
    targetProductId: z.string().uuid().nullable().optional(),
    target_option_id: z.string().uuid().nullable().optional(),
    targetOptionId: z.string().uuid().nullable().optional(),
    locked: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasSourceProduct = value.source_product_id != null || value.sourceProductId != null
    const hasSourceOption = value.source_option_id != null || value.sourceOptionId != null
    const hasTargetProduct = value.target_product_id != null || value.targetProductId != null
    const hasTargetOption = value.target_option_id != null || value.targetOptionId != null

    if ((hasSourceProduct ? 1 : 0) + (hasSourceOption ? 1 : 0) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source'],
        message: 'Exactly one of source_product_id or source_option_id is required',
      })
    }

    if ((hasTargetProduct ? 1 : 0) + (hasTargetOption ? 1 : 0) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: 'Exactly one of target_product_id or target_option_id is required',
      })
    }
  })

const syncBodySchema = z.object({
  constraints: z.array(syncConstraintBodySchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Product constraints',
  methods: {
    GET: {
      summary: 'Get product constraints',
      tags: ['Catalog'],
      responses: [
        { status: 200, description: 'Constraints list', schema: responseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Product not found' },
      ],
    },
    PUT: {
      summary: 'Sync product constraints',
      tags: ['Catalog'],
      responses: [
        { status: 200, description: 'Synced constraints', schema: responseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid body' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Product not found' },
      ],
    },
  },
}

function latestIso(values: Array<Date | null | undefined>): string | null {
  const isos = values
    .map((v) => (v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString() : null))
    .filter((v): v is string => v !== null)
  if (isos.length === 0) return null
  return isos.reduce((max, cur) => (cur > max ? cur : max))
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { ctx } = await resolveRequestContext(request)
  const productId = params.id

  if (!productId) throw new CrudHttpError(400, { error: 'Product ID is required' })
  if (!ctx.auth?.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  if (!ctx.auth.orgId) throw new CrudHttpError(400, { error: 'Organization context is required' })

  const tenantId = ctx.auth.tenantId
  const organizationId = ctx.auth.orgId
  const em = ctx.container.resolve('em') as EntityManager

  const product = await em.findOne(CatalogProduct, {
    id: productId,
    tenantId,
    organizationId,
    deletedAt: null,
  })

  if (!product) throw new CrudHttpError(404, { error: 'Product not found' })

  const constraints = await em.find(
    CatalogProductConstraint,
    { sourceProduct: productId, tenantId, organizationId },
    { populate: ['sourceProduct', 'sourceOption', 'targetProduct', 'targetOption'] }
  )

  const updatedAt = latestIso([product.updatedAt, ...constraints.map((c) => c.updatedAt)])

  const serialized = constraints.map((c) => ({
    id: c.id,
    constraint_type: c.constraintType,
    source_product_id: c.sourceProduct?.id ?? null,
    source_option_id: c.sourceOption?.id ?? null,
    target_product_id: c.targetProduct?.id ?? null,
    target_option_id: c.targetOption?.id ?? null,
    locked: c.locked,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  }))

  return NextResponse.json({ updated_at: updatedAt, constraints: serialized })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { ctx } = await resolveRequestContext(request)
  const productId = params.id

  if (!productId) throw new CrudHttpError(400, { error: 'Product ID is required' })
  if (!ctx.auth?.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  if (!ctx.auth.orgId) throw new CrudHttpError(400, { error: 'Organization context is required' })

  const tenantId = ctx.auth.tenantId
  const organizationId = ctx.auth.orgId

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    throw new CrudHttpError(400, { error: 'Invalid JSON body' })
  }

  const parsedBody = syncBodySchema.safeParse(rawBody)
  if (!parsedBody.success) {
    throw new CrudHttpError(400, { error: 'Invalid request body', details: parsedBody.error.flatten() })
  }

  const commandInput: ProductConstraintsSyncInput = {
    productId,
    tenantId,
    organizationId,
    constraints: parsedBody.data.constraints.map((c) => ({
      id: c.id,
      constraintType: (c.constraint_type ?? c.constraintType)!,
      sourceProductId: c.source_product_id ?? c.sourceProductId ?? null,
      sourceOptionId: c.source_option_id ?? c.sourceOptionId ?? null,
      targetProductId: c.target_product_id ?? c.targetProductId ?? null,
      targetOptionId: c.target_option_id ?? c.targetOptionId ?? null,
      locked: c.locked ?? false,
    })),
  }

  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  await commandBus.execute('catalog.product_constraints.sync', {
    input: commandInput,
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

  // Re-fetch and return updated state
  return GET(request, { params })
}
