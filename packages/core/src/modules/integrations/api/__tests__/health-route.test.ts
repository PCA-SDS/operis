/** @jest-environment node */

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { POST } from '../[id]/health/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  ...jest.requireActual('@open-mercato/shared/modules/integrations/types'),
  getIntegration: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn(),
}))

const runAfterSuccessMock = jest.fn()

function buildRequest(): Request {
  return new Request('http://localhost/api/integrations/sync_akeneo/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
}

describe('integrations health POST route — mutation guard contract', () => {
  const runHealthCheckMock = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    runHealthCheckMock.mockReset()
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'u1' })
    ;(getIntegration as jest.Mock).mockReturnValue({ id: 'sync_akeneo', title: 'Akeneo PIM' })
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (key: string) => {
        if (key === 'integrationHealthService') {
          return { runHealthCheck: runHealthCheckMock }
        }
        throw new Error(`unexpected resolve(${key})`)
      },
    })
  })

  it('blocks the health probe and after-success callbacks when a guard denies the mutation', async () => {
    ;(runRouteMutationGuards as jest.Mock).mockResolvedValue({
      ok: false,
      errorStatus: 403,
      errorBody: { error: 'Blocked by guard' },
    })

    const response = await POST(buildRequest(), { params: { id: 'sync_akeneo' } })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toEqual({ error: 'Blocked by guard' })
    expect(runHealthCheckMock).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('runs the probe and after-success callbacks when guards pass', async () => {
    const checkedAt = new Date('2026-06-19T00:00:00.000Z').toISOString()
    ;(runRouteMutationGuards as jest.Mock).mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    runHealthCheckMock.mockResolvedValue({
      status: 'healthy',
      message: 'ok',
      details: { foo: 'bar' },
      latencyMs: 12,
      checkedAt,
    })

    const response = await POST(buildRequest(), { params: { id: 'sync_akeneo' } })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      status: 'healthy',
      message: 'ok',
      details: { foo: 'bar' },
      latencyMs: 12,
      checkedAt,
    })
    expect(runHealthCheckMock).toHaveBeenCalledWith('sync_akeneo', { organizationId: 'o1', tenantId: 't1' })

    const guardCallOrder = (runRouteMutationGuards as jest.Mock).mock.invocationCallOrder[0]
    const probeCallOrder = runHealthCheckMock.mock.invocationCallOrder[0]
    const afterSuccessCallOrder = runAfterSuccessMock.mock.invocationCallOrder[0]
    expect(guardCallOrder).toBeLessThan(probeCallOrder)
    expect(probeCallOrder).toBeLessThan(afterSuccessCallOrder)
    expect(runAfterSuccessMock).toHaveBeenCalledTimes(1)
  })
})

describe('integrations health POST route — testing unsaved credentials', () => {
  const testCredentialsMock = jest.fn()
  const runHealthCheckMock = jest.fn()
  const userHasAllFeaturesMock = jest.fn()
  const saveMock = jest.fn()
  const schema = {
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: true },
      { key: 'fromEmail', label: 'Sender', type: 'text' },
    ],
  }

  function buildTestRequest(body: unknown): Request {
    return new Request('http://localhost/api/integrations/resend/health', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: 't1', orgId: 'o1', sub: 'u1' })
    ;(getIntegration as jest.Mock).mockReturnValue({ id: 'resend', title: 'Resend' })
    userHasAllFeaturesMock.mockResolvedValue(true)
    testCredentialsMock.mockResolvedValue({
      status: 'unhealthy',
      message: 'Resend rejected the API key with HTTP 401',
      details: { provider: 'resend', httpStatus: 401 },
      latencyMs: 40,
      checkedAt: '2026-09-29T00:00:00.000Z',
    })
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (key: string) => {
        if (key === 'rbacService') return { userHasAllFeatures: userHasAllFeaturesMock }
        if (key === 'integrationHealthService') return { testCredentials: testCredentialsMock, runHealthCheck: runHealthCheckMock }
        if (key === 'integrationCredentialsService') {
          return {
            getSchema: () => schema,
            resolve: async () => ({ apiKey: 're_stored_secret', fromEmail: 'Ops <ops@acme.test>' }),
            save: saveMock,
          }
        }
        throw new Error(`unexpected resolve(${key})`)
      },
    })
  })

  it('requires the credentials permission on top of integrations.manage', async () => {
    userHasAllFeaturesMock.mockResolvedValue(false)

    const response = await POST(buildTestRequest({ credentials: { apiKey: 're_new' } }), { params: { id: 'resend' } })

    expect(response.status).toBe(403)
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith('u1', ['integrations.credentials.manage'], { organizationId: 'o1', tenantId: 't1' })
    expect(testCredentialsMock).not.toHaveBeenCalled()
    expect(runRouteMutationGuards).not.toHaveBeenCalled()
  })

  it('tests the submitted key without saving it or touching health state', async () => {
    const response = await POST(
      buildTestRequest({ credentials: { apiKey: 're_submitted_key', fromEmail: 'Billing <billing@acme.test>' } }),
      { params: { id: 'resend' } },
    )

    expect(response.status).toBe(200)
    expect(testCredentialsMock).toHaveBeenCalledWith(
      'resend',
      { apiKey: 're_submitted_key', fromEmail: 'Billing <billing@acme.test>' },
      { organizationId: 'o1', tenantId: 't1' },
    )
    expect(saveMock).not.toHaveBeenCalled()
    expect(runHealthCheckMock).not.toHaveBeenCalled()
    expect(runRouteMutationGuards).not.toHaveBeenCalled()
    const body = await response.text()
    expect(body).not.toContain('re_submitted_key')
    expect(body).not.toContain('re_stored_secret')
  })

  it('keeps the stored secret when the form sends the masked placeholder with unchanged settings', async () => {
    await POST(
      buildTestRequest({ credentials: { apiKey: '__om_secret_unchanged__', fromEmail: 'Ops <ops@acme.test>' } }),
      { params: { id: 'resend' } },
    )

    expect(testCredentialsMock).toHaveBeenCalledWith(
      'resend',
      { apiKey: 're_stored_secret', fromEmail: 'Ops <ops@acme.test>' },
      { organizationId: 'o1', tenantId: 't1' },
    )
  })

  it('does not reuse the stored secret when other settings changed', async () => {
    const response = await POST(
      buildTestRequest({ credentials: { apiKey: '__om_secret_unchanged__', fromEmail: 'Billing <billing@acme.test>' } }),
      { params: { id: 'resend' } },
    )

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'credentials.secret_reentry_required', fields: ['apiKey'] })
    expect(JSON.stringify(body)).not.toContain('re_stored_secret')
    expect(testCredentialsMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed credentials payload', async () => {
    const response = await POST(buildTestRequest({ credentials: 'not-an-object' }), { params: { id: 'resend' } })

    expect(response.status).toBe(422)
    expect(testCredentialsMock).not.toHaveBeenCalled()
  })
})
