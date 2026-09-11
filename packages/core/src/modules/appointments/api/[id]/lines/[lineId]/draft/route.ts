import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AppointmentSeatPlannerService } from '../../../../../lib/seatPlannerService'

const upsertDraftSchema = z.object({
  resourceId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  assignedMemberId: z.string().uuid().nullable().optional(),
})

export type RouteContext = { params: Promise<{ id: string; lineId: string }> }

const logger = createLogger('appointments').child({ component: 'seat-planner-draft-api' })
const uuidSchema = z.string().uuid()

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['appointments.seat_planner.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['appointments.seat_planner.manage'] },
}

/**
 * PUT /api/appointments/:id/lines/:lineId/draft
 * Creates or updates a draft assignment for an appointment line
 */
export async function PUT(req: Request, ctx: RouteContext) {
  const { translate } = await resolveTranslations()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: appointmentId, lineId } = await ctx.params
    if (!uuidSchema.safeParse(appointmentId).success) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if (!uuidSchema.safeParse(lineId).success) {
      return NextResponse.json(
        { error: translate('appointments.lines.notFound', 'Line not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const body = upsertDraftSchema.parse(await readJsonSafe(req, {}))

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope.selectedId || auth.orgId || null
    if (!organizationId || !uuidSchema.safeParse(organizationId).success) {
      return NextResponse.json(
        { error: 'Organization scope is required', code: 'ORGANIZATION_SCOPE_REQUIRED' },
        { status: 400 },
      )
    }

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: 'appointments.seatPlannerDraft',
      resourceId: lineId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { appointmentId, lineId, ...body },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const service = new AppointmentSeatPlannerService(em)

    const assignment = await service.upsertDraft({
      appointmentId,
      tenantId: auth.tenantId,
      organizationId,
      lineId,
      resourceId: body.resourceId,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      assignedMemberId: body.assignedMemberId ?? null,
      userId: auth.userId ?? null,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: 'appointments.seatPlannerDraft',
        resourceId: lineId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json(assignment)
  } catch (error) {
    logger.error('Seat planner draft save failed', { error })

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', issues: error.issues },
        { status: 400 },
      )
    }

    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code

      // Map service errors to HTTP responses
      if (code === 'LINE_NOT_FOUND') {
        return NextResponse.json(
          { error: translate('appointments.lines.notFound', 'Line not found.'), code: 'NOT_FOUND' },
          { status: 404 },
        )
      }

      if (code === 'RESOURCE_NOT_FOUND') {
        return NextResponse.json(
          { error: translate('resources.resources.notFound', 'Resource not found.'), code: 'RESOURCE_NOT_FOUND' },
          { status: 404 },
        )
      }

      if (code === 'RESOURCE_INACTIVE') {
        return NextResponse.json(
          { error: translate('resources.resources.inactive', 'Resource is not active.'), code: 'RESOURCE_INACTIVE' },
          { status: 400 },
        )
      }

      if (code === 'RESOURCE_BLOCKED') {
        return NextResponse.json(
          { error: translate('resources.assignments.blocked', 'Resource is blocked for this time.'), code: 'RESOURCE_BLOCKED' },
          { status: 409 },
        )
      }

      if (code === 'OUTSIDE_AVAILABILITY') {
        return NextResponse.json(
          { error: translate('resources.assignments.outsideAvailability', 'Outside resource availability hours.'), code: 'OUTSIDE_AVAILABILITY' },
          { status: 409 },
        )
      }

      if (code === 'ASSIGNMENT_CONFLICT') {
        return NextResponse.json(
          { error: translate('resources.assignments.conflict', 'Resource is already booked for this time.'), code: 'ASSIGNMENT_CONFLICT' },
          { status: 409 },
        )
      }
    }

    const message = error instanceof Error ? error.message : 'Failed to save draft'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/appointments/:id/lines/:lineId/draft
 * Removes the draft assignment for an appointment line
 */
export async function DELETE(req: Request, ctx: RouteContext) {
  const { translate } = await resolveTranslations()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: appointmentId, lineId } = await ctx.params
    if (!uuidSchema.safeParse(appointmentId).success) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if (!uuidSchema.safeParse(lineId).success) {
      return NextResponse.json(
        { error: translate('appointments.lines.notFound', 'Line not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope.selectedId || auth.orgId || null
    if (!organizationId || !uuidSchema.safeParse(organizationId).success) {
      return NextResponse.json(
        { error: 'Organization scope is required', code: 'ORGANIZATION_SCOPE_REQUIRED' },
        { status: 400 },
      )
    }

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: 'appointments.seatPlannerDraft',
      resourceId: lineId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { appointmentId, lineId },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const service = new AppointmentSeatPlannerService(em)

    await service.clearDraft({
      appointmentId,
      lineId,
      tenantId: auth.tenantId,
      organizationId,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: 'appointments.seatPlannerDraft',
        resourceId: lineId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Seat planner draft clear failed', { error })

    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code

      if (code === 'LINE_NOT_FOUND') {
        return NextResponse.json(
          { error: translate('appointments.lines.notFound', 'Line not found.'), code: 'NOT_FOUND' },
          { status: 404 },
        )
      }
    }

    const message = error instanceof Error ? error.message : 'Failed to clear draft'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Manage appointment seat planner drafts',
  methods: {
    PUT: {
      summary: 'Create or update a draft seat assignment',
      requestBody: { contentType: 'application/json', schema: upsertDraftSchema },
      responses: [
        { status: 200, description: 'Draft assignment saved' },
        { status: 400, description: 'Invalid payload or inactive resource' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden' },
        { status: 404, description: 'Appointment line or resource not found' },
        { status: 409, description: 'Resource assignment conflict' },
      ],
    },
    DELETE: {
      summary: 'Clear a draft seat assignment',
      responses: [
        { status: 200, description: 'Draft assignment cleared' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden' },
        { status: 404, description: 'Appointment line not found' },
      ],
    },
  },
}
