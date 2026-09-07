import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CatalogProductOption } from '../../data/entities'
import { catalogProductOptionCreateSchema, catalogProductOptionUpdateSchema } from '../../data/validators'
import { E } from '#generated/entities.ids.generated'
import * as FV from '#generated/entities/catalog_product_option'
import { parseBooleanFlag, sanitizeSearchTerm } from '../helpers'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  createCatalogCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    groupId: z.string().uuid().optional(),
    code: z.string().optional(),
    isActive: z.string().optional(),
    withDeleted: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type Query = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  POST: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
}

export const metadata = routeMetadata

export async function buildFilters(query: Query): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}
  const term = sanitizeSearchTerm(query.search)
  if (query.id) {
    filters.id = { $eq: query.id }
  }
  if (term) {
    const like = `%${escapeLikePattern(term)}%`
    filters.$or = [
      { name: { $ilike: like } },
      { code: { $ilike: like } },
    ]
  }
  if (query.groupId) {
    filters.group_id = { $eq: query.groupId }
  }
  if (query.code) {
    filters.code = { $eq: query.code }
  }
  const isActive = parseBooleanFlag(query.isActive)
  if (isActive !== undefined) filters.is_active = isActive
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogProductOption,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.catalog.catalog_product_option },
  enrichers: {
    entityId: E.catalog.catalog_product_option,
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_product_option,
    fields: [
      FV.id,
      'group_id',
      FV.code,
      FV.name,
      FV.description,
      FV.note,
      FV.unit,
      FV.price_flat,
      FV.price_min,
      FV.price_max,
      FV.duration_value,
      FV.duration_unit,
      FV.duration_min,
      FV.duration_max,
      FV.is_addon,
      FV.sort_order,
      FV.is_active,
      FV.metadata,
      FV.created_at,
      FV.updated_at,
    ],
    sortFieldMap: {
      name: FV.name,
      code: FV.code,
      sortOrder: FV.sort_order,
      createdAt: FV.created_at,
      updatedAt: FV.updated_at,
    },
    defaultSort: { field: FV.sort_order, dir: 'asc' },
    buildFilters,
  },
  create: {
    schema: catalogProductOptionCreateSchema,
    mapToEntity: (input) => ({
      group: input.groupId,
      code: input.code ?? null,
      name: input.name,
      description: input.description ?? null,
      note: input.note ?? null,
      unit: input.unit ?? null,
      priceFlat: input.priceFlat ?? null,
      priceMin: input.priceMin ?? null,
      priceMax: input.priceMax ?? null,
      durationValue: input.durationValue ?? null,
      durationUnit: input.durationUnit ?? null,
      durationMin: input.durationMin ?? null,
      durationMax: input.durationMax ?? null,
      isAddon: input.isAddon ?? false,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      metadata: input.metadata ?? null,
    }),
  },
  update: {
    schema: catalogProductOptionUpdateSchema,
    applyToEntity: (entity, input) => {
      if (input.code !== undefined) entity.code = input.code
      if (input.name !== undefined) entity.name = input.name
      if (input.description !== undefined) entity.description = input.description
      if (input.note !== undefined) entity.note = input.note
      if (input.unit !== undefined) entity.unit = input.unit
      if (input.priceFlat !== undefined) entity.priceFlat = input.priceFlat
      if (input.priceMin !== undefined) entity.priceMin = input.priceMin
      if (input.priceMax !== undefined) entity.priceMax = input.priceMax
      if (input.durationValue !== undefined) entity.durationValue = input.durationValue
      if (input.durationUnit !== undefined) entity.durationUnit = input.durationUnit
      if (input.durationMin !== undefined) entity.durationMin = input.durationMin
      if (input.durationMax !== undefined) entity.durationMax = input.durationMax
      if (input.isAddon !== undefined) entity.isAddon = input.isAddon
      if (input.sortOrder !== undefined) entity.sortOrder = input.sortOrder
      if (input.isActive !== undefined) entity.isActive = input.isActive
      if (input.metadata !== undefined) entity.metadata = input.metadata
    },
  },
  del: {},
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const listItemSchema = z.object({
  id: z.string().uuid(),
  group_id: z.string().uuid().nullable().optional(),
  code: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
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
  is_addon: z.boolean().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createCatalogCrudOpenApi({
  resourceName: 'ProductOption',
  pluralName: 'ProductOptions',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: catalogProductOptionCreateSchema,
    description: 'Creates a new product option.',
  },
  update: {
    schema: catalogProductOptionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a product option.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a product option.',
  },
})
