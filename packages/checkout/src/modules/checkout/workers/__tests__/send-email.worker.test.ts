import {
  clearRegisteredIntegrations,
  registerIntegrations,
  type IntegrationScope,
} from '@open-mercato/shared/modules/integrations/types'
import { createIntegrationCredentialResolver } from '@open-mercato/core/modules/integrations/lib/credential-resolver'
import type { CredentialsReadResult } from '@open-mercato/core/modules/integrations/lib/credentials-service'

const sendEmail = jest.fn()
const findOneWithDecryption = jest.fn()
const resolveNotificationDeliveryConfig = jest.fn()

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/deliveryConfig', () => ({
  DEFAULT_NOTIFICATION_DELIVERY_CONFIG: {
    panelPath: '/backend/notifications',
    strategies: {
      database: { enabled: true },
      email: { enabled: true },
      custom: {},
    },
  },
  resolveNotificationDeliveryConfig: (...args: unknown[]) => resolveNotificationDeliveryConfig(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    t: (_key: string, fallback?: string, vars?: Record<string, string>) => {
      if (!fallback) return _key
      if (!vars) return fallback
      return fallback.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`)
    },
  }),
}))

jest.mock('../../emails/PaymentStartEmail', () => ({
  __esModule: true,
  default: jest.fn((props: unknown) => props),
}))

jest.mock('../../emails/PaymentSuccessEmail', () => ({
  __esModule: true,
  default: jest.fn((props: unknown) => props),
}))

jest.mock('../../emails/PaymentErrorEmail', () => ({
  __esModule: true,
  default: jest.fn((props: unknown) => props),
}))

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type StoredCredential = Record<string, unknown> | 'unreadable'

function buildResolver(stored: Record<string, StoredCredential>, env: Record<string, string> = {}) {
  const records: Array<{ integrationId: string; scope: IntegrationScope }> = []
  const read = async (integrationId: string, scope: IntegrationScope): Promise<CredentialsReadResult> => {
    await new Promise((resolve) => setTimeout(resolve, scope.tenantId === TENANT_A ? 10 : 1))
    const value = stored[`${scope.tenantId}:${scope.organizationId}:${integrationId}`]
    if (value === undefined) return { status: 'missing' }
    if (value === 'unreadable') throw new Error('ciphertext could not be decrypted')
    return { status: 'present', values: value }
  }
  const resolver = createIntegrationCredentialResolver({
    credentials: {
      readForResolution: read,
      async readManyForResolution(ids, scope) {
        return new Map(await Promise.all(ids.map(async (id) => [id, await read(id, scope)] as const)))
      },
    },
    state: { isEnabled: async () => true },
    async recordPlatformUsage(record, scope) {
      records.push({ integrationId: record.integrationId, scope })
    },
    env,
  })
  return { resolver, records }
}

function buildContext(resolver: unknown) {
  return {
    resolve: (name: string) => {
      if (name === 'em') return { fork: () => ({}) }
      if (name === 'integrationCredentialResolver') return resolver
      throw new Error(`Missing dependency: ${name}`)
    },
    hasRegistration: (name: string) => name === 'integrationCredentialResolver' || name === 'em',
  }
}

function queueTransaction(tenantId: string, organizationId: string, email: string) {
  findOneWithDecryption
    .mockResolvedValueOnce({
      id: `txn-${tenantId}`,
      linkId: 'link-1',
      email,
      firstName: 'Piotr',
      amount: '33.00',
      currencyCode: 'USD',
      tenantId,
      organizationId,
    })
    .mockResolvedValueOnce({
      id: 'link-1',
      title: 'Spring Gala 2026',
      name: 'Spring Gala 2026',
      successEmailSubject: 'Your Spring Gala ticket is confirmed',
      successEmailBody: null,
      sendSuccessEmail: true,
    })
}

function successJob(tenantId: string, organizationId: string) {
  return {
    payload: { type: 'success', transactionId: `txn-${tenantId}`, tenantId, organizationId },
  } as never
}

describe('checkout send-email worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearRegisteredIntegrations()
    registerIntegrations([
      {
        id: 'resend',
        title: 'Resend',
        credentials: {
          fields: [
            { key: 'apiKey', label: 'API key', type: 'secret', required: true },
            { key: 'fromEmail', label: 'Sender', type: 'text' },
          ],
        },
        credentialResolution: {
          service: 'email',
          secretField: 'apiKey',
          platformEnv: { apiKey: ['RESEND_API_KEY'], fromEmail: ['NOTIFICATIONS_EMAIL_FROM'] },
        },
      },
    ])
    resolveNotificationDeliveryConfig.mockResolvedValue({
      panelPath: '/backend/notifications',
      strategies: {
        database: { enabled: true },
        email: {
          enabled: true,
          from: 'notifications@example.com',
          replyTo: 'reply@example.com',
        },
        custom: {},
      },
    })
  })

  afterAll(() => {
    clearRegisteredIntegrations()
  })

  it('sends with the organization key and falls back to the notification sender when the organization has none', async () => {
    const { resolver } = buildResolver({ [`${TENANT_A}:${ORG_A}:resend`]: { apiKey: 're_org_a' } })
    queueTransaction(TENANT_A, ORG_A, 'buyer@example.com')
    const { default: handle } = await import('../send-email.worker')

    await handle(successJob(TENANT_A, ORG_A), buildContext(resolver) as never)

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 're_org_a',
        to: 'buyer@example.com',
        from: 'notifications@example.com',
        replyTo: 'reply@example.com',
        subject: 'Your Spring Gala ticket is confirmed',
      }),
    )
  })

  it("prefers the organization's own sender over the instance notification sender", async () => {
    const { resolver } = buildResolver({
      [`${TENANT_A}:${ORG_A}:resend`]: { apiKey: 're_org_a', fromEmail: 'Acme Tickets <tickets@acme.test>' },
    })
    queueTransaction(TENANT_A, ORG_A, 'buyer@example.com')
    const { default: handle } = await import('../send-email.worker')

    await handle(successJob(TENANT_A, ORG_A), buildContext(resolver) as never)

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ from: 'Acme Tickets <tickets@acme.test>' }))
  })

  it('keeps the instance notification sender ahead of the platform env sender under platform fallback', async () => {
    const { resolver, records } = buildResolver({}, {
      OM_EMAIL_CREDENTIAL_FALLBACK: 'platform',
      RESEND_API_KEY: 're_platform',
      NOTIFICATIONS_EMAIL_FROM: 'platform@example.com',
    })
    queueTransaction(TENANT_A, ORG_A, 'buyer@example.com')
    const { default: handle } = await import('../send-email.worker')

    await handle(successJob(TENANT_A, ORG_A), buildContext(resolver) as never)

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 're_platform', from: 'notifications@example.com' }))
    expect(records).toEqual([{ integrationId: 'resend', scope: { tenantId: TENANT_A, organizationId: ORG_A, userId: null } }])
  })

  it('uses each tenant key for its own job when jobs for two tenants run concurrently', async () => {
    const { resolver } = buildResolver({
      [`${TENANT_A}:${ORG_A}:resend`]: { apiKey: 're_tenant_a' },
      [`${TENANT_B}:${ORG_B}:resend`]: { apiKey: 're_tenant_b' },
    })
    findOneWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
      if ('linkId' in where || where.id === 'link-1') {
        return { id: 'link-1', title: 'Gala', sendSuccessEmail: true, successEmailSubject: 'Confirmed', successEmailBody: null }
      }
      const tenantId = where.tenantId as string
      return {
        id: `txn-${tenantId}`,
        linkId: 'link-1',
        email: tenantId === TENANT_A ? 'buyer-a@example.com' : 'buyer-b@example.com',
        amount: '10.00',
        currencyCode: 'USD',
      }
    })
    const { default: handle } = await import('../send-email.worker')

    await Promise.all([
      handle(successJob(TENANT_A, ORG_A), buildContext(resolver) as never),
      handle(successJob(TENANT_B, ORG_B), buildContext(resolver) as never),
      handle(successJob(TENANT_A, ORG_A), buildContext(resolver) as never),
      handle(successJob(TENANT_B, ORG_B), buildContext(resolver) as never),
    ])

    const sent = sendEmail.mock.calls.map(([options]) => [options.to, options.apiKey])
    expect(sent).toHaveLength(4)
    for (const [to, apiKey] of sent) {
      expect(apiKey).toBe(to === 'buyer-a@example.com' ? 're_tenant_a' : 're_tenant_b')
    }
  })

  it('skips without retrying when the organization has no key and fallback is disabled', async () => {
    const { resolver } = buildResolver({}, { RESEND_API_KEY: 're_platform' })
    queueTransaction(TENANT_A, ORG_A, 'buyer@example.com')
    const { default: handle } = await import('../send-email.worker')

    await expect(handle(successJob(TENANT_A, ORG_A), buildContext(resolver) as never)).resolves.toBeUndefined()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('rethrows unreadable credentials so the queue retries instead of falling back', async () => {
    const { resolver } = buildResolver(
      { [`${TENANT_A}:${ORG_A}:resend`]: 'unreadable' },
      { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform', RESEND_API_KEY: 're_platform' },
    )
    queueTransaction(TENANT_A, ORG_A, 'buyer@example.com')
    const { default: handle } = await import('../send-email.worker')

    await expect(handle(successJob(TENANT_A, ORG_A), buildContext(resolver) as never)).rejects.toMatchObject({
      code: 'credential_unreadable',
    })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
