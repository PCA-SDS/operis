import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CatalogProductOptionGroup } from '../../data/entities'
import { catalogProductOptionGroupCreateSchema, catalogProductOptionGroupUpdateSchema } from '../../data/validators'
import { E } from '#generated/entities.ids.generated'
import * as FV from '#generated/entities/catalog_product_option_group'
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
    productId: z.string().uuid().optional(),
    parentOptionId: z.string().uuid().optional(),
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
    ]
  }
  if (query.productId) {
    filters.product_id = { $eq: query.productId }
  }
  if (query.parentOptionId) {
    filters.parent_option_id = { $eq: query.parentOptionId }
  }
  const isActive = parseBooleanFlag(query.isActive)
  if (isActive !== undefined) filters.is_active = isActive
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogProductOptionGroup,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.catalog.catalog_product_option_group },
  enrichers: {
    entityId: E.catalog.catalog_product_option_group,
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_product_option_group,
    fields: [
      FV.id,
      'product_id',
      'parent_option_id',
      FV.name,
      FV.description,
      FV.requirement,
      FV.select_mode,
      FV.sort_order,
      FV.is_active,
      FV.metadata,
      FV.created_at,
      FV.updated_at,
    ],
    sortFieldMap: {
      name: FV.name,
      sortOrder: FV.sort_order,
      createdAt: FV.created_at,
      updatedAt: FV.updated_at,
    },
    defaultSort: { field: FV.sort_order, dir: 'asc' },
    buildFilters,
  },
  create: {
    schema: catalogProductOptionGroupCreateSchema,
    mapToEntity: (input) => ({
      product: input.productId,
      parentOption: input.parentOptionId ?? null,
      name: input.name,
      description: input.description ?? null,
      requirement: input.requirement ?? 'optional',
      selectMode: input.selectMode ?? 'single',
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      metadata: input.metadata ?? null,
    }),
  },
  update: {
    schema: catalogProductOptionGroupUpdateSchema,
    applyToEntity: (entity, input) => {
      if (input.name !== undefined) entity.name = input.name
      if (input.description !== undefined) entity.description = input.description
      if (input.requirement !== undefined) entity.requirement = input.requirement
      if (input.selectMode !== undefined) entity.selectMode = input.selectMode
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
  product_id: z.string().uuid().nullable().optional(),
  parent_option_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  requirement: z.string().nullable().optional(),
  select_mode: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createCatalogCrudOpenApi({
  resourceName: 'OptionGroup',
  pluralName: 'OptionGroups',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: {
    schema: catalogProductOptionGroupCreateSchema,
    description: 'Creates a new option group.',
  },
  update: {
    schema: catalogProductOptionGroupUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an option group.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an option group.',
  },
})
