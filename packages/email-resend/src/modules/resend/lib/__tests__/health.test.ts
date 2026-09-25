import { resendHealthCheck } from '../health'

describe('resendHealthCheck', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('confirms a Resend API key through the domains endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as typeof fetch

    await expect(resendHealthCheck.check({ apiKey: 'tenant-key' }, { tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toEqual({
      status: 'healthy',
      message: 'Connected to Resend',
      details: { provider: 'resend', httpStatus: 200 },
    })
    expect(global.fetch).toHaveBeenCalledWith('https://api.resend.com/domains', {
      headers: { Authorization: 'Bearer tenant-key' },
    })
  })

  it('rejects an invalid default sender before calling Resend', async () => {
    global.fetch = jest.fn() as typeof fetch

    await expect(resendHealthCheck.check({ apiKey: 'tenant-key', fromEmail: 'not-an-email' }, { tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toEqual({
      status: 'unhealthy',
      message: 'Default sender email is invalid',
      details: { provider: 'resend', senderConfigured: true, senderFormatValid: false },
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('confirms the default sender domain when Resend returns a verified domain', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ name: 'example.com', status: 'verified' }] }),
    }) as typeof fetch

    await expect(resendHealthCheck.check({ apiKey: 'tenant-key', fromEmail: 'noreply@example.com' }, { tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toEqual({
      status: 'healthy',
      message: 'Connected to Resend and default sender domain is verified',
      details: { provider: 'resend', httpStatus: 200, senderConfigured: true, senderFormatValid: true, senderDomainVerified: true },
    })
  })

  it('accepts a display-name sender and verifies its mailbox domain', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ name: 'example.com', status: 'verified' }] }),
    }) as typeof fetch

    await expect(resendHealthCheck.check({ apiKey: 'tenant-key', fromEmail: 'NAM <noreply@example.com>' }, { tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toMatchObject({
      status: 'healthy',
      details: { senderConfigured: true, senderFormatValid: true, senderDomainVerified: true },
    })
  })

  it('reports rejected credentials without exposing the API key', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as typeof fetch

    await expect(resendHealthCheck.check({ apiKey: 'tenant-key' }, { tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toEqual({
      status: 'unhealthy',
      message: 'Resend rejected the API key with HTTP 401',
      details: { provider: 'resend', httpStatus: 401 },
    })
  })

  it('reports limited sending-only access as degraded instead of invalid', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as typeof fetch

    await expect(resendHealthCheck.check({ apiKey: 'tenant-key' }, { tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toEqual({
      status: 'degraded',
      message: 'Resend accepted the key but denied the non-sending domain probe; Sending access can still send from its permitted domain',
      details: { provider: 'resend', httpStatus: 403, requiredPermission: 'full_access' },
    })
  })

  it('does not call Resend when the credential is empty', async () => {
    global.fetch = jest.fn() as typeof fetch

    await expect(resendHealthCheck.check({ apiKey: '  ' }, { tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toMatchObject({
      status: 'unhealthy',
      message: 'Resend API key is empty',
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
