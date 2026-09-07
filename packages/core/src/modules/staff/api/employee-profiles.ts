import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { StaffEmployeeProfile } from '../data/entities'
import {
  staffEmployeeProfileCreateSchema,
  staffEmployeeProfileUpdateSchema,
} from '../data/validators'
import { E } from '#generated/entities.ids.generated'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    /** Narrows to one team member — the detail page's only use of this route. */
    memberId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

/**
 * HR data is gated by its own features rather than `staff.view`.
 *
 * Everyone who can see the team can already read a member; that must not also
 * hand them a date of birth and a private phone number.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.hr_profile.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.hr_profile.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.hr_profile.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.hr_profile.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffEmployeeProfile,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: E.staff.staff_employee_profile,
  },
  list: {
    schema: listSchema,
    entityId: E.staff.staff_employee_profile,
    fields: [
      'id',
      'member_id',
      'employee_number',
      'job_title',
      'employment_type',
      'start_date',
      'end_date',
      'work_phone',
      'personal_phone',
      'personal_email',
      'date_of_birth',
      'notes',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      jobTitle: 'job_title',
      employeeNumber: 'employee_number',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.memberId) filters.member_id = { $eq: query.memberId }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'staff.employee-profiles.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffEmployeeProfileCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.profileId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'staff.employee-profiles.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffEmployeeProfileUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'staff.employee-profiles.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return { id: resolveCrudRecordId(parsed, ctx, translate) }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const employeeProfileListItemSchema = z
  .object({
    id: z.string().uuid(),
    member_id: z.string().uuid(),
    employee_number: z.string().nullable().optional(),
    job_title: z.string().nullable().optional(),
    employment_type: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    work_phone: z.string().nullable().optional(),
    personal_phone: z.string().nullable().optional(),
    personal_email: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

export const openApi = createStaffCrudOpenApi({
  resourceName: 'EmployeeProfile',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(employeeProfileListItemSchema),
  create: {
    schema: staffEmployeeProfileCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: "Creates a team member's HR profile.",
  },
  update: {
    schema: staffEmployeeProfileUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: "Updates a team member's HR profile.",
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: "Deletes a team member's HR profile.",
  },
})
