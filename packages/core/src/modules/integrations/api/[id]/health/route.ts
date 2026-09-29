import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import type { IntegrationHealthService } from '../../../lib/health-service'
import { organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveIntegrationsOrganizationIdForRequest } from '../../../lib/organization-scope'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isRecord } from '@open-mercato/shared/lib/guards'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { CredentialsService } from '../../../lib/credentials-service'
import { isCredentialsEncryptionUnavailableError } from '../../../lib/credentials-service'
import { findMaskedSecretsWithChangedSettings, mergeMaskedSecretCredentials } from '../../../lib/credentials-masking'
import { collectCredentialUrlValidationErrors } from '../../../lib/credentials-field-validation'
import { saveCredentialsSchema } from '../../../data/validators'

const idParamsSchema = z.object({ id: z.string().min(1) })

export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['integrations.manage'],
    rateLimit: { points: 30, duration: 60, keyPrefix: 'integrations_health' },
  },
}

const CREDENTIALS_MANAGE_FEATURE = 'integrations.credentials.manage'
const SECRET_REENTRY_REQUIRED_CODE = 'credentials.secret_reentry_required'

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

  const body = await readJsonSafe<unknown>(req, null)
  if (isRecord(body) && body.credentials !== undefined) {
    return testSubmittedCredentials({
      container,
      integrationId: integration.id,
      userId: auth.sub,
      scope: { organizationId, tenantId: auth.tenantId },
      body,
    })
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

async function testSubmittedCredentials(input: {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  integrationId: string
  userId: string
  scope: { organizationId: string; tenantId: string }
  body: Record<string, unknown>
}): Promise<Response> {
  const rbac = input.container.resolve('rbacService') as RbacService
  const canManageCredentials = await rbac.userHasAllFeatures(input.userId, [CREDENTIALS_MANAGE_FEATURE], input.scope)
  if (!canManageCredentials) {
    return NextResponse.json({ error: 'Forbidden', requiredFeatures: [CREDENTIALS_MANAGE_FEATURE] }, { status: 403 })
  }
  const parsed = saveCredentialsSchema.safeParse(input.body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid credentials payload', details: parsed.error.flatten() }, { status: 422 })
  }
  const credentialsService = input.container.resolve('integrationCredentialsService') as CredentialsService
  const schema = credentialsService.getSchema(input.integrationId)
  const fieldErrors = collectCredentialUrlValidationErrors(schema, parsed.data.credentials)
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: 'Invalid credentials payload', details: { fieldErrors } }, { status: 422 })
  }
  let credentials: Record<string, unknown>
  try {
    const existing = (await credentialsService.resolve(input.integrationId, input.scope)) ?? {}
    const secretsToReenter = findMaskedSecretsWithChangedSettings(schema, parsed.data.credentials, existing)
    if (secretsToReenter.length > 0) {
      return NextResponse.json(
        { error: 'Re-enter secret fields to test changed connection settings', code: SECRET_REENTRY_REQUIRED_CODE, fields: secretsToReenter },
        { status: 422 },
      )
    }
    credentials = mergeMaskedSecretCredentials(schema, parsed.data.credentials, existing)
  } catch (error) {
    if (isCredentialsEncryptionUnavailableError(error)) {
      return NextResponse.json({ error: 'Integration credentials encryption is unavailable' }, { status: 503 })
    }
    throw error
  }
  const healthService = input.container.resolve('integrationHealthService') as IntegrationHealthService
  const result = await healthService.testCredentials(input.integrationId, credentials, input.scope)
  return NextResponse.json({
    status: result.status,
    message: result.message ?? null,
    details: result.details ?? null,
    latencyMs: result.latencyMs,
    checkedAt: result.checkedAt,
  })
}
