import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import type { IntegrationHealthService } from '../../../lib/health-service'
import { organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveIntegrationsOrganizationIdForRequest } from '../../../lib/organization-scope'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const idParamsSchema = z.object({ id: z.string().min(1) })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['integrations.manage'] },
}

export const openApi = {
  tags: ['Integrations'],
  summary: 'Run health check for an integration',
}

export async function POST(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const rawParams = (ctx.params && typeof (ctx.params as Promise<unknown>).then === 'function')
    ? await (ctx.params as Promise<{ id?: string }>)
    : (ctx.params as { id?: string } | undefined)

  const parsedParams = idParamsSchema.safeParse(rawParams)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 })
  }

  const integration = getIntegration(parsedParams.data.id)
  if (!integration) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  const container = await createRequestContainer()
  const organizationId = await resolveIntegrationsOrganizationIdForRequest({ container, auth, request: req })
  if (!organizationId) {
    return organizationScopeRequiredResponse()
  }

  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: auth.sub ?? '', tenantId: auth.tenantId, organizationId },
    input: {
      resourceKind: 'integrations.integration',
      resourceId: integration.id,
      operation: 'update',
      mutationPayload: { integrationId: integration.id },
    },
  })
  if (!guardResult.ok) {
    return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
  }

  const healthService = container.resolve('integrationHealthService') as IntegrationHealthService

  const result = await healthService.runHealthCheck(
    integration.id,
    { organizationId: organizationId, tenantId: auth.tenantId },
  )

  await guardResult.runAfterSuccess()

  return NextResponse.json({
    status: result.status,
    message: result.message ?? null,
    details: result.details ?? null,
    latencyMs: result.latencyMs,
    checkedAt: result.checkedAt,
  })
}
