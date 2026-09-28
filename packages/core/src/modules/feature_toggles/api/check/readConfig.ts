import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { FeatureTogglesService } from '../../lib/feature-flag-check'

export type FeatureToggleConfigReader = 'getBoolConfig' | 'getStringConfig' | 'getJsonConfig' | 'getNumberConfig'

export async function readFeatureToggleConfig(req: Request, reader: FeatureToggleConfigReader): Promise<NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const identifier = url.searchParams.get('identifier')

  if (!identifier) {
    return NextResponse.json({ error: 'Missing required parameter: identifier' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const { scope } = await resolveFeatureCheckContext({
    container,
    auth,
    request: req
  })

  if (!scope.tenantId) {
    return NextResponse.json({ error: 'Tenant context required. Please select a tenant.' }, { status: 400 })
  }

  const featureTogglesService = container.resolve('featureTogglesService') as FeatureTogglesService
  const result = await featureTogglesService[reader](identifier, scope.tenantId)

  if (!result.ok) {
    return NextResponse.json(result, { status: result.error.code === "MISSING_TOGGLE" ? 404 : 400 })
  }

  return NextResponse.json(result)
}
