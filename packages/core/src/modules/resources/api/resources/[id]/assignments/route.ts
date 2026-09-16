import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ResourceAssignmentService } from '@open-mercato/core/modules/resources/lib/resourceAssignmentService'

type RouteContext = { params: Promise<{ id: string }> }

const logger = createLogger('resources').child({ component: 'resource-assignments-api' })
const uuidSchema = z.string().uuid()

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['resources.view'] },
}

/**
 * GET /api/resources/resources/:id/assignments
 * Get all assignments for a resource within a date range
 */
export async function GET(req: Request, ctx: RouteContext) {
  const { translate } = await resolveTranslations()

  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: resourceId } = await ctx.params
    if (!uuidSchema.safeParse(resourceId).success) {
      return NextResponse.json(
        { error: translate('resources.resources.notFound', 'Resource not found.'), code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const url = new URL(req.url)
    const startsAtParam = url.searchParams.get('startsAt')
    const endsAtParam = url.searchParams.get('endsAt')
    const includeDraft = parseBooleanWithDefault(url.searchParams.get('includeDraft'), false)

    const startsAt = startsAtParam ? new Date(startsAtParam) : new Date()
    startsAt.setHours(0, 0, 0, 0)

    const endsAt = endsAtParam ? new Date(endsAtParam) : new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    endsAt.setHours(23, 59, 59, 999)

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

    const service = new ResourceAssignmentService(em)

    const assignments = await service.getByResource({
      tenantId: auth.tenantId,
      organizationId,
      resourceId,
      startsAt,
      endsAt,
      includeDraft,
    })

    return NextResponse.json({
      resourceId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      assignments,
    })
  } catch (error) {
    logger.error('Resource assignments load failed', { error })
    const message = error instanceof Error ? error.message : 'Failed to load assignments'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Resources',
  summary: 'List resource assignments',
  methods: {
    GET: {
      summary: 'List resource assignments in a date range',
      responses: [
        { status: 200, description: 'Resource assignments' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Resource not found' },
      ],
    },
  },
}
