import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  createOrganizationInDb,
  deleteIntegrationCredentialsInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
  withClient,
} from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

type JsonRecord = Record<string, unknown>

const RESEND_ID = 'resend'
const AI_OPENAI_ID = 'ai_openai'
const MASKED_SECRET_VALUE = '__om_secret_unchanged__'
const HEALTH_STATUSES = ['healthy', 'degraded', 'unhealthy', 'unconfigured']

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function isRegistered(request: APIRequestContext, token: string, integrationId: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', `/api/integrations/${integrationId}`, { token })
  return response.status() === 200
}

async function countOrganizationRows(organizationId: string): Promise<Record<string, number>> {
  return withClient(async (client) => {
    const counts: Record<string, number> = {}
    for (const table of ['integration_credentials', 'integration_states', 'integration_logs']) {
      const result = await client.query<{ count: string }>(
        `select count(*)::text as count from ${table} where organization_id = $1`,
        [organizationId],
      )
      counts[table] = Number(result.rows[0]?.count ?? 0)
    }
    return counts
  })
}

async function deleteOrganizationIntegrationRows(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  await withClient(async (client) => {
    await client.query('delete from integration_logs where organization_id = $1', [organizationId])
    await client.query('delete from integration_states where organization_id = $1', [organizationId])
  })
}

/**
 * TC-INT-011: Organization credential test action and secret handling [P0]
 *
 * Surfaces: POST /api/integrations/:id/health (with `credentials`), PUT/GET /api/integrations/:id/credentials,
 * GET /api/integrations/:id
 *
 * Spec: .ai/specs/2026-09-29-customer-integration-credentials.md. Runs in a fresh organization so every
 * row it writes is removed in teardown. The provider probe may reach the network; the assertions hold
 * whether the provider rejects the fake key, times out, or is unreachable.
 */
test.describe('TC-INT-011: Organization credential test action and secret handling', () => {
  test('AI provider integrations are listed without their credential resolution config', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    if (!(await isRegistered(request, token, AI_OPENAI_ID))) {
      test.skip(true, 'AI provider integrations are not registered in this environment')
      return
    }

    const detail = await readJson(await apiRequest(request, 'GET', `/api/integrations/${AI_OPENAI_ID}`, { token }))
    const integration = (detail.integration ?? {}) as JsonRecord

    expect(integration.category).toBe('ai')
    expect(integration).not.toHaveProperty('credentialResolution')
    expect(detail.hasHealthCheck).toBe(true)
    const fields = ((integration.credentials ?? {}) as JsonRecord).fields as JsonRecord[]
    expect(fields.map((field) => [field.key, field.type])).toEqual([['apiKey', 'secret']])

    const list = await readJson(await apiRequest(request, 'GET', '/api/integrations?category=ai&pageSize=100', { token }))
    const ids = (Array.isArray(list.items) ? (list.items as JsonRecord[]) : []).map((item) => item.id)
    expect(ids).toEqual(expect.arrayContaining(['ai_openai', 'ai_anthropic', 'ai_google']))
    expect(ids).not.toEqual(expect.arrayContaining(['ai_ollama']))
  })

  test('testing credentials saves nothing, never echoes secrets, and needs credentials.manage', async ({ request }) => {
    test.slow()

    const stamp = Date.now()
    const password = 'Secret123!'
    const managerEmail = `tc-int-011-manager-${stamp}@example.com`
    const operatorEmail = `tc-int-011-operator-${stamp}@example.com`
    const submittedSecret = `re_tc_int_011_submitted_${stamp}`
    const storedSecret = `re_tc_int_011_stored_${stamp}`
    const fromEmail = `TC-INT-011 <tc-int-011-${stamp}@example.com>`
    const healthPath = `/api/integrations/${RESEND_ID}/health`
    const credentialsPath = `/api/integrations/${RESEND_ID}/credentials`

    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()
    if (!(await isRegistered(request, adminToken, RESEND_ID))) {
      test.skip(true, 'The Resend integration is not registered in this environment')
      return
    }

    let organizationId: string | null = null
    let roleId: string | null = null
    let managerId: string | null = null
    let operatorId: string | null = null

    try {
      organizationId = await createOrganizationInDb({ name: `TC-INT-011 Org ${stamp}`, tenantId: tenantId as string })
      roleId = await createRoleFixture(request, adminToken, { name: `TC-INT-011 Role ${stamp}` })
      managerId = await createUserFixture(request, adminToken, {
        email: managerEmail,
        password,
        organizationId,
        roles: [roleId],
      })
      operatorId = await createUserFixture(request, adminToken, {
        email: operatorEmail,
        password,
        organizationId,
        roles: [roleId],
      })
      await setUserAclVisibility(request, adminToken, {
        userId: managerId,
        features: ['integrations.view', 'integrations.manage', 'integrations.credentials.manage'],
        organizations: [organizationId],
      })
      await setUserAclVisibility(request, adminToken, {
        userId: operatorId,
        features: ['integrations.view', 'integrations.manage'],
        organizations: [organizationId],
      })
      const managerToken = await getAuthToken(request, managerEmail, password)
      const operatorToken = await getAuthToken(request, operatorEmail, password)

      const initial = await apiRequest(request, 'GET', credentialsPath, { token: managerToken })
      if (initial.status() === 503) {
        test.skip(true, 'Integration credentials encryption is unavailable in this environment')
        return
      }
      expect(initial.status()).toBe(200)
      expect(await countOrganizationRows(organizationId)).toEqual({
        integration_credentials: 0,
        integration_states: 0,
        integration_logs: 0,
      })

      const unsavedTest = await apiRequest(request, 'POST', healthPath, {
        token: managerToken,
        data: { credentials: { apiKey: submittedSecret, fromEmail } },
      })
      const unsavedText = await unsavedTest.text()
      expect(unsavedTest.status(), unsavedText).toBe(200)
      expect(HEALTH_STATUSES).toContain((JSON.parse(unsavedText) as JsonRecord).status)
      expect(unsavedText).not.toContain(submittedSecret)
      expect(await countOrganizationRows(organizationId), 'a test must not persist credentials, state or logs').toEqual({
        integration_credentials: 0,
        integration_states: 0,
        integration_logs: 0,
      })

      const forbiddenTest = await apiRequest(request, 'POST', healthPath, {
        token: operatorToken,
        data: { credentials: { apiKey: submittedSecret } },
      })
      expect(forbiddenTest.status()).toBe(403)
      expect(await readJson(forbiddenTest)).toMatchObject({ requiredFeatures: ['integrations.credentials.manage'] })
      expect(await forbiddenTest.text()).not.toContain(submittedSecret)

      const save = await apiRequest(request, 'PUT', credentialsPath, {
        token: managerToken,
        data: { credentials: { apiKey: storedSecret, fromEmail } },
      })
      expect(save.status(), 'the credentials manager saves the organization key').toBe(200)

      const readBack = await apiRequest(request, 'GET', credentialsPath, { token: managerToken })
      const readBackText = await readBack.text()
      expect(readBack.status()).toBe(200)
      expect(readBackText).not.toContain(storedSecret)
      const readBackBody = JSON.parse(readBackText) as JsonRecord
      expect(readBackBody.credentials).toMatchObject({ apiKey: MASKED_SECRET_VALUE, fromEmail })
      expect(readBackBody.secretFieldsConfigured).toMatchObject({ apiKey: true })

      const storedTest = await apiRequest(request, 'POST', healthPath, {
        token: managerToken,
        data: { credentials: { apiKey: MASKED_SECRET_VALUE, fromEmail } },
      })
      const storedText = await storedTest.text()
      expect(storedTest.status(), storedText).toBe(200)
      expect(storedText).not.toContain(storedSecret)

      const detail = await apiRequest(request, 'GET', `/api/integrations/${RESEND_ID}`, { token: managerToken })
      const detailText = await detail.text()
      expect(detailText).not.toContain(storedSecret)
      const detailBody = JSON.parse(detailText) as JsonRecord
      expect(detailBody.integration).not.toHaveProperty('credentialResolution')
      expect(detailBody.hasCredentials).toBe(true)
      expect(detailBody.hasHealthCheck).toBe(true)

      const afterCounts = await countOrganizationRows(organizationId)
      expect(afterCounts.integration_credentials, 'only the explicit save stored a row').toBe(1)
      expect(afterCounts.integration_states, 'tests never write health state').toBe(0)
    } finally {
      await deleteUserIfExists(request, adminToken, managerId)
      await deleteUserIfExists(request, adminToken, operatorId)
      await deleteUserAclInDb(managerId ?? '').catch(() => undefined)
      await deleteUserAclInDb(operatorId ?? '').catch(() => undefined)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteIntegrationCredentialsInDb(organizationId).catch(() => undefined)
      await deleteOrganizationIntegrationRows(organizationId).catch(() => undefined)
      await deleteOrganizationInDb(organizationId).catch(() => undefined)
    }
  })
})
