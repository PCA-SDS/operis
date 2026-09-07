import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { EmailTemplate } from '../../data/entities'
import {
  createEmailTemplateSchema,
  deleteEmailTemplateSchema,
  emailTemplateQuerySchema,
  emailTemplateStatusSchema,
  updateEmailTemplateSchema,
} from '../../data/validators'
import { createEmailCrudOpenApi, createPagedListResponseSchema } from '../openapi'

const ENTITY_ID = 'email:template' as const

const templateListItemSchema = z.object({
  id: z.string().uuid(),
  template_key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  status: emailTemplateStatusSchema,
  subject: z.string(),
  preheader: z.string().nullable(),
  design: z.unknown(),
  blocks: z.unknown(),
  variables: z.unknown(),
  accounting_metadata: z.unknown().nullable(),
  tenant_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  created_by_user_id: z.string().uuid().nullable(),
  updated_by_user_id: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type EmailTemplateRow = {
  id: string
  template_key: string
  name: string
  description?: string | null
  category: string
  status: 'draft' | 'published' | 'archived'
  subject: string
  preheader?: string | null
  design: unknown
  blocks: unknown
  variables: unknown
  accounting_metadata?: unknown | null
  tenant_id: string
  organization_id: string
  created_by_user_id?: string | null
  updated_by_user_id?: string | null
  created_at: Date | string
  updated_at: Date | string
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['email.templates.view'] },
    POST: { requireAuth: true, requireFeatures: ['email.templates.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['email.templates.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['email.templates.manage'] },
  },
  orm: {
    entity: EmailTemplate,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: { module: 'email', entity: 'template', persistent: true },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: emailTemplateQuerySchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'template_key',
      'name',
      'description',
      'category',
      'status',
      'subject',
      'preheader',
      'design',
      'blocks',
      'variables',
      'accounting_metadata',
      'tenant_id',
      'organization_id',
      'created_by_user_id',
      'updated_by_user_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      category: 'category',
      status: 'status',
      createdAt: 'updated_at',
      updatedAt: 'updated_at',
      updated_at: 'updated_at',
    },
    buildFilters: (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.ids) {
        const ids = query.ids.split(',').map((value) => value.trim()).filter(Boolean)
        if (ids.length) filters.id = { $in: ids }
      }
      if (query.search) filters.name = { $ilike: `%${escapeLikePattern(query.search)}%` }
      if (query.category) filters.category = query.category
      if (query.status) filters.status = query.status
      return filters
    },
    transformItem: (item: EmailTemplateRow) => ({
      id: item.id,
      template_key: item.template_key,
      name: item.name,
      description: item.description ?? null,
      category: item.category,
      status: item.status,
      subject: item.subject,
      preheader: item.preheader ?? null,
      design: item.design,
      blocks: item.blocks,
      variables: item.variables,
      accounting_metadata: item.accounting_metadata ?? null,
      tenant_id: item.tenant_id,
      organization_id: item.organization_id,
      created_by_user_id: item.created_by_user_id ?? null,
      updated_by_user_id: item.updated_by_user_id ?? null,
      createdAt: toIso(item.created_at),
      updatedAt: toIso(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'email.templates.create',
      schema: createEmailTemplateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'email.templates.update',
      schema: updateEmailTemplateSchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'email.templates.delete',
      schema: deleteEmailTemplateSchema,
      response: () => ({ ok: true }),
    },
  },
})

export const openApi: OpenApiRouteDoc = createEmailCrudOpenApi({
  resourceName: 'Email template',
  pluralName: 'Email templates',
  querySchema: emailTemplateQuerySchema,
  listResponseSchema: createPagedListResponseSchema(templateListItemSchema),
  create: {
    schema: createEmailTemplateSchema,
    description: 'Creates a tenant-scoped email template.',
    responseSchema: z.object({ id: z.string().uuid() }),
  },
  update: {
    schema: updateEmailTemplateSchema,
    description: 'Updates a tenant-scoped email template.',
    responseSchema: z.object({ ok: z.literal(true) }),
  },
  del: {
    schema: deleteEmailTemplateSchema,
    description: 'Soft-deletes a tenant-scoped email template.',
    responseSchema: z.object({ ok: z.literal(true) }),
  },
})
