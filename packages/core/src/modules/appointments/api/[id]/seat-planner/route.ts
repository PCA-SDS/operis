import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AppointmentSeatPlannerService } from '../../../lib/seatPlannerService'

type RouteContext = { params: Promise<{ id: string }> }

const logger = createLogger('appointments').child({ component: 'seat-planner-api' })
const uuidSchema = z.string().uuid()

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.seat_planner.view'] },
}

export async function GET(req: Request, ctx: RouteContext) {
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

    const service = new AppointmentSeatPlannerService(em)

    const workspace = await service.getWorkspace({
      appointmentId,
      tenantId: auth.tenantId,
      organizationId,
    })

    return NextResponse.json(workspace)
  } catch (error) {
    logger.error('Seat planner workspace load failed', { error })
    const message = error instanceof Error ? error.message : 'Failed to load seat planner'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Appointments',
  summary: 'Load appointment seat planner workspace',
  methods: {
    GET: {
      summary: 'Load seat planner workspace',
      responses: [
        { status: 200, description: 'Seat planner workspace' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Appointment not found' },
      ],
    },
  },
}
