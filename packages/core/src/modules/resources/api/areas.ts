import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { ResourcesResourceArea } from '../data/entities'
import { resourcesResourceAreaCreateSchema, resourcesResourceAreaUpdateSchema } from '../data/validators'
import { createResourcesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

const rawBodySchema = z.object({}).passthrough()
const createInputSchema = resourcesResourceAreaCreateSchema

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(100),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['resources.view'] },
  POST: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
  PUT: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
  DELETE: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
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
      'id', 'name', 'description', 'area_type', 'parent_area_id', 'sort_order', 
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

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const areaListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  area_type: z.string().nullable().optional(),
  parent_area_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  appearance_icon: z.string().nullable().optional(),
  appearance_color: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
})

export const openApi = createResourcesCrudOpenApi({
  resourceName: 'Resource area',
  pluralName: 'Resource areas',
  querySchema: listSchema,
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
