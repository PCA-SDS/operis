import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { ResourcesResourceArea } from '../data/entities'
import { resourcesResourceAreaCreateSchema, resourcesResourceAreaUpdateSchema } from '../data/validators'
import { createResourcesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'
import { computeHierarchyForAreas } from '../lib/areaHierarchy'

const rawBodySchema = z.object({}).passthrough()
const createInputSchema = resourcesResourceAreaCreateSchema

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(100),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['resources.areas.view'] },
  POST: { requireAuth: true, requireFeatures: ['resources.areas.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['resources.areas.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['resources.areas.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ResourcesResourceArea,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    fields: [
      'id', 'name', 'description', 'area_type_id', 'parent_area_id', 'sort_order',
      'appearance_icon', 'appearance_color', 'is_active', 'organization_id', 'tenant_id'
    ],
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`
        filters.$or = [
          { name: { $ilike: pattern } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'resources.resourceAreas.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = parseScopedCommandInput(createInputSchema, raw ?? {}, ctx, translate)
        return resourcesResourceAreaCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.areaId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'resources.resourceAreas.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        try {
          return resourcesResourceAreaUpdateSchema.parse(raw ?? {})
        } catch {
          throw new CrudHttpError(400, { error: translate('resources.resources.areas.errors.invalid', 'Invalid area payload') })
        }
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'resources.resourceAreas.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, { error: translate('resources.resources.areas.errors.required', 'Area id is required') })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const viewSchema = z
  .object({
    view: z.enum(['manage', 'tree']).default('manage'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(100),
    search: z.string().optional(),
    status: z.enum(['all', 'active', 'inactive']).optional(),
    areaTypeId: z.string().optional(),
    ids: z.string().optional(),
    id: z.string().optional(),
    parentAreaId: z.string().optional(),
    excludeSubtreeOf: z.string().optional(),
  })
  .passthrough()

type QueryShape = z.infer<typeof viewSchema>

function sanitizeSearch(term?: string | null): string {
  if (!term) return ''
  return term.trim().toLowerCase()
}

function parseIdList(value?: string | null): string[] {
  if (!value) return []
  return Array.from(new Set(value.split(',').map((id) => id.trim()).filter(Boolean)))
}

function isDirectScopedAreaLookup(query: QueryShape): boolean {
  return query.view !== 'tree' &&
    query.sortField !== 'child_count' &&
    Boolean(query.id || query.ids || typeof query.parentAreaId === 'string')
}

function buildDirectAreaOrderBy(sortField?: string, sortDir?: 'asc' | 'desc'): Record<string, unknown> {
  const direction = sortDir === 'desc' ? 'DESC' : 'ASC'
  switch (sortField) {
    case 'updatedAt':
      return { updatedAt: direction }
    case 'name':
      return { name: direction }
    case 'area_type_id':
      return { areaType: { id: direction }, name: 'ASC' }
    case 'sort_order':
    default:
      return { sortOrder: direction, name: 'ASC' }
  }
}

async function collectResourceAreaSubtreeIds(
  em: EntityManager,
  params: {
    rootId?: string | null
    tenantId: string
    orgWhere: Record<string, unknown>
  },
): Promise<string[]> {
  const rootId = params.rootId?.trim()
  if (!rootId) return []
  const excluded = new Set<string>([rootId])
  let frontier = [rootId]

  while (frontier.length > 0) {
    const children = await em.find(
      ResourcesResourceArea,
      {
        ...params.orgWhere,
        tenantId: params.tenantId,
        deletedAt: null,
        parentAreaId: frontier.length === 1 ? frontier[0] : { $in: frontier },
      } as FilterQuery<ResourcesResourceArea>,
      { fields: ['id'] },
    )
    frontier = children
      .map((child) => String(child.id))
      .filter((id) => {
        if (excluded.has(id)) return false
        excluded.add(id)
        return true
      })
  }

  return Array.from(excluded)
}

async function loadAncestorAreasForPath(
  em: EntityManager,
  areas: ResourcesResourceArea[],
  params: { tenantId: string; orgWhere: Record<string, unknown> },
): Promise<ResourcesResourceArea[]> {
  const loaded = new Map<string, ResourcesResourceArea>()
  for (const area of areas) loaded.set(String(area.id), area)

  let parentIds = Array.from(new Set(
    areas
      .map((area) => area.parentAreaId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && !loaded.has(id)),
  ))

  while (parentIds.length > 0) {
    const parents = await em.find(
      ResourcesResourceArea,
      {
        ...params.orgWhere,
        tenantId: params.tenantId,
        deletedAt: null,
        id: parentIds.length === 1 ? parentIds[0] : { $in: parentIds },
      } as FilterQuery<ResourcesResourceArea>,
      { populate: ['areaType'] },
    )
    const nextParentIds: string[] = []
    for (const parent of parents) {
      const id = String(parent.id)
      if (loaded.has(id)) continue
      loaded.set(id, parent)
      if (parent.parentAreaId && !loaded.has(parent.parentAreaId)) {
        nextParentIds.push(parent.parentAreaId)
      }
    }
    parentIds = Array.from(new Set(nextParentIds))
  }

  return Array.from(loaded.values())
}

async function countChildrenByParentId(
  em: EntityManager,
  rows: ResourcesResourceArea[],
  params: { tenantId: string; orgWhere: Record<string, unknown>; excludedIds?: string[] },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  await Promise.all(rows.map(async (row) => {
    const where: Record<string, unknown> = {
      ...params.orgWhere,
      tenantId: params.tenantId,
      deletedAt: null,
      parentAreaId: row.id,
    }
    if (params.excludedIds && params.excludedIds.length > 0) {
      where.id = { $nin: params.excludedIds }
    }
    counts.set(String(row.id), await em.count(ResourcesResourceArea, where as FilterQuery<ResourcesResourceArea>))
  }))
  return counts
}

function mapAreaResponseItems(
  rows: ResourcesResourceArea[],
  hierarchyAreas: ResourcesResourceArea[],
  childCounts: Map<string, number>,
  tenantId: string,
): Array<Record<string, unknown>> {
  const hierarchy = computeHierarchyForAreas(hierarchyAreas)
  return rows.map((area) => {
    const node = hierarchy.map.get(String(area.id))
    const parentName = node?.parentId ? hierarchy.map.get(node.parentId)?.name ?? null : null
    return {
      id: area.id,
      name: area.name,
      description: area.description ?? null,
      area_type_id: area.areaType?.id ?? null,
      area_type_name: area.areaType?.name ?? null,
      parent_area_id: area.parentAreaId ?? null,
      parent_name: parentName,
      sort_order: area.sortOrder,
      appearance_icon: area.appearanceIcon ?? null,
      appearance_color: area.appearanceColor ?? null,
      is_active: area.isActive,
      organization_id: area.organizationId ?? null,
      tenant_id: tenantId,
      depth: node?.depth ?? 0,
      path_label: node?.pathLabel ?? area.name,
      ancestor_ids: node?.ancestorIds ?? [],
      child_count: childCounts.get(String(area.id)) ?? node?.childIds.length ?? 0,
      descendant_count: node?.descendantIds.length ?? 0,
      updatedAt: area.updatedAt ? new Date(area.updatedAt).toISOString() : null,
    }
  })
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [] }, { status: 401 })

  const url = new URL(req.url)
  const parsed = viewSchema.safeParse({
    view: url.searchParams.get('view') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    areaTypeId: url.searchParams.get('areaTypeId') ?? undefined,
    ids: url.searchParams.get('ids') ?? undefined,
    id: url.searchParams.get('id') ?? undefined,
    parentAreaId: url.searchParams.get('parentAreaId') ?? undefined,
    excludeSubtreeOf: url.searchParams.get('excludeSubtreeOf') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], error: 'Invalid query' }, { status: 400 })
  }
  const query: QueryShape = parsed.data

  const container = await createRequestContainer()
  try {
    const em = container.resolve<EntityManager>('em')
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const { translate } = await resolveTranslations()

    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    if (!tenantId) {
      return NextResponse.json(
        { items: [], error: translate('resources.errors.tenant_required', 'Tenant context is required.') },
        { status: 400 }
      )
    }

    const orgFilter = resolveOrganizationScopeFilter(scope, auth)
    const responseOrganizationId = orgFilter.rbacOrganizationId ?? null

    if (isDirectScopedAreaLookup(query)) {
      const excludedIds = await collectResourceAreaSubtreeIds(em, {
        rootId: query.excludeSubtreeOf,
        tenantId,
        orgWhere: orgFilter.where,
      })
      const where: Record<string, unknown> = {
        ...orgFilter.where,
        tenantId,
        deletedAt: null,
      }
      const ids = parseIdList(query.ids)
      if (query.id) {
        where.id = query.id
      } else if (ids.length > 0) {
        where.id = ids.length === 1 ? ids[0] : { $in: ids }
      } else if (typeof query.parentAreaId === 'string') {
        const parentAreaId = query.parentAreaId.trim()
        where.parentAreaId = parentAreaId === 'null' ? null : parentAreaId
      }
      if (excludedIds.length > 0) {
        const existingIdFilter = where.id
        if (typeof existingIdFilter === 'string') {
          if (excludedIds.includes(existingIdFilter)) {
            return NextResponse.json({
              items: [],
              total: 0,
              page: query.page,
              pageSize: query.pageSize,
              totalPages: 1,
              organizationId: responseOrganizationId,
              tenantId,
            })
          }
        } else if (existingIdFilter && typeof existingIdFilter === 'object' && '$in' in existingIdFilter) {
          const idFilter = existingIdFilter as { $in?: unknown[] }
          const nextIds = (idFilter.$in ?? []).filter((id: unknown) => !excludedIds.includes(String(id)))
          where.id = nextIds.length === 1 ? String(nextIds[0]) : { $in: nextIds.map(String) }
        } else {
          where.id = { $nin: excludedIds }
        }
      }
      const status = query.status ?? 'all'
      if (status === 'active') where.isActive = true
      if (status === 'inactive') where.isActive = false
      const areaTypeId = typeof query.areaTypeId === 'string' ? query.areaTypeId.trim() : ''
      if (areaTypeId) where.areaType = { id: areaTypeId }
      const search = sanitizeSearch(query.search ?? null)
      if (search) {
        const pattern = `%${escapeLikePattern(search)}%`
        where.name = { $ilike: pattern }
      }

      const filter = where as FilterQuery<ResourcesResourceArea>
      const total = await em.count(ResourcesResourceArea, filter)
      const pageSize = query.pageSize
      const page = query.page
      const directSortField = typeof query.sortField === 'string' ? query.sortField : undefined
      const directSortDir = query.sortDir === 'desc' || query.sortDir === 'asc' ? query.sortDir : undefined
      const rows = await em.find(ResourcesResourceArea, filter, {
        orderBy: buildDirectAreaOrderBy(directSortField, directSortDir),
        limit: pageSize,
        offset: (page - 1) * pageSize,
        populate: ['areaType'],
      })
      const hierarchyAreas = await loadAncestorAreasForPath(em, rows, { tenantId, orgWhere: orgFilter.where })
      const childCounts = await countChildrenByParentId(em, rows, { tenantId, orgWhere: orgFilter.where, excludedIds })
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      return NextResponse.json({
        items: mapAreaResponseItems(rows, hierarchyAreas, childCounts, tenantId),
        total,
        page,
        pageSize,
        totalPages,
        organizationId: responseOrganizationId,
        tenantId,
      })
    }

    const areas = await em.find(
      ResourcesResourceArea,
      { ...orgFilter.where, tenantId, deletedAt: null },
      { orderBy: { sortOrder: 'ASC', name: 'ASC' }, populate: ['areaType'] }
    )
    const areaMap = new Map(areas.map((area) => [String(area.id), area]))
    
    const hierarchy = computeHierarchyForAreas(areas)

    if (query.view === 'tree') {
      return NextResponse.json({ items: hierarchy.ordered })
    }

    const status = query.status ?? 'all'
    const search = sanitizeSearch(query.search ?? null)
    let rows = hierarchy.ordered

    if (query.id) {
      rows = rows.filter((node) => node.id === query.id)
    } else if (query.ids) {
      const ids = query.ids.split(',').map((id) => id.trim())
      rows = rows.filter((node) => ids.includes(node.id))
    } else if (typeof query.parentAreaId === 'string') {
      const parentAreaId = query.parentAreaId.trim()
      rows = parentAreaId === 'null'
        ? rows.filter((node) => node.parentId === null)
        : rows.filter((node) => node.parentId === parentAreaId)
    }

    if (status === 'active') rows = rows.filter((node) => node.isActive)
    if (status === 'inactive') rows = rows.filter((node) => !node.isActive)
    const areaTypeId = typeof query.areaTypeId === 'string' ? query.areaTypeId.trim() : ''
    if (areaTypeId) {
      rows = rows.filter((node) => areaMap.get(node.id)?.areaType?.id === areaTypeId)
    }
    if (search) {
      rows = rows.filter((node) => {
        const label = node.pathLabel.toLowerCase()
        return node.name.toLowerCase().includes(search) || label.includes(search)
      })
    }
    const sortField = typeof query.sortField === 'string' ? query.sortField.trim() : ''
    if (sortField) {
      const direction = query.sortDir === 'desc' ? -1 : 1
      rows = [...rows].sort((left, right) => {
        const leftArea = areaMap.get(left.id)
        const rightArea = areaMap.get(right.id)
        const leftValue = getResourceAreaSortValue(sortField, left, leftArea)
        const rightValue = getResourceAreaSortValue(sortField, right, rightArea)
        if (typeof leftValue === 'number' && typeof rightValue === 'number') {
          return (leftValue - rightValue) * direction
        }
        return String(leftValue).localeCompare(String(rightValue)) * direction
      })
    }

    const total = rows.length
    const pageSize = query.pageSize
    const page = query.page
    const start = (page - 1) * pageSize
    const paged = rows.slice(start, start + pageSize)

    const items = paged.map((node) => {
      const area = areaMap.get(node.id)
      const parentName = node.parentId ? hierarchy.map.get(node.parentId)?.name ?? null : null
      
      return {
        id: node.id,
        name: node.name,
        description: area?.description ?? null,
        area_type_id: area?.areaType?.id ?? null,
        area_type_name: area?.areaType?.name ?? null,
        parent_area_id: node.parentId,
        parent_name: parentName,
        sort_order: node.sortOrder,
        appearance_icon: area?.appearanceIcon ?? null,
        appearance_color: area?.appearanceColor ?? null,
        is_active: node.isActive,
        organization_id: area?.organizationId ?? null,
        tenant_id: tenantId,
        depth: node.depth,
        path_label: node.pathLabel,
        ancestor_ids: node.ancestorIds,
        child_count: node.childIds.length,
        descendant_count: node.descendantIds.length,
        updatedAt: area?.updatedAt ? new Date(area.updatedAt).toISOString() : null,
      }
    })

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      totalPages,
      organizationId: responseOrganizationId,
      tenantId,
    })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

function getResourceAreaSortValue(
  sortField: string,
  node: { name: string; sortOrder: number; childIds: string[] },
  area: ResourcesResourceArea | undefined,
): string | number {
  switch (sortField) {
    case 'area_type_id':
      return area?.areaType?.id ?? ''
    case 'child_count':
      return node.childIds.length
    case 'updatedAt':
      return area?.updatedAt ? new Date(area.updatedAt).getTime() : 0
    case 'sort_order':
      return node.sortOrder
    case 'name':
    default:
      return node.name
  }
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const areaListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  area_type_id: z.string().uuid().nullable().optional(),
  parent_area_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  appearance_icon: z.string().nullable().optional(),
  appearance_color: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  depth: z.number().optional(),
  path_label: z.string().nullable().optional(),
  ancestor_ids: z.array(z.string().uuid()).optional(),
  child_count: z.number().optional(),
  descendant_count: z.number().optional(),
})

export const openApi = createResourcesCrudOpenApi({
  resourceName: 'Resource area',
  pluralName: 'Resource areas',
  querySchema: viewSchema,
  listResponseSchema: createPagedListResponseSchema(areaListItemSchema),
  create: {
    schema: createInputSchema,
    description: 'Creates a resource area.',
  },
  update: {
    schema: resourcesResourceAreaUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a resource area by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a resource area by id.',
  },
})
