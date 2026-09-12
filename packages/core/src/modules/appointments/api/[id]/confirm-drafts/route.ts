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
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AppointmentSeatPlannerService } from '../../../lib/seatPlannerService'

type RouteContext = { params: Promise<{ id: string }> }

const logger = createLogger('appointments').child({ component: 'seat-planner-confirm-api' })
const uuidSchema = z.string().uuid()

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['appointments.seat_planner.manage'] },
}

/**
 * POST /api/appointments/:id/confirm-drafts
 * Confirms all draft assignments for an appointment
 */
export async function POST(req: Request, ctx: RouteContext) {
  const { translate } = await resolveTranslations()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: appointmentId } = await ctx.params
    if (!uuidSchema.safeParse(appointmentId).success) {
      return NextResponse.json(
        { error: translate('appointments.detail.notFound', 'Appointment not found.'), code: 'NOT_FOUND' },
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
      resourceKind: 'appointments.seatPlanner',
      resourceId: appointmentId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { appointmentId },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const service = new AppointmentSeatPlannerService(em)

    const assignments = await service.confirmDrafts({
      appointmentId,
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.userId ?? null,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: 'appointments.seatPlanner',
        resourceId: appointmentId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({
      success: true,
      assignments,
    })
  } catch (error) {
    logger.error('Seat planner draft confirmation failed', { error })
    const message = error instanceof Error ? error.message : 'Failed to confirm drafts'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Confirm appointment seat planner drafts',
  methods: {
    POST: {
      summary: 'Confirm all draft seat assignments',
      responses: [
        { status: 200, description: 'Draft assignments confirmed' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden' },
        { status: 404, description: 'Appointment not found' },
      ],
    },
  },
}
