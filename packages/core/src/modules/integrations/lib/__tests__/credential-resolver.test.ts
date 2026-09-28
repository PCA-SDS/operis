/** @jest-environment node */

import { inspect } from 'node:util'
import {
  clearRegisteredIntegrations,
  registerIntegrations,
  type IntegrationDefinition,
  type IntegrationScope,
} from '@open-mercato/shared/modules/integrations/types'
import {
  IntegrationCredentialError,
  isIntegrationCredentialError,
} from '@open-mercato/shared/modules/integrations/credential-resolution'
import type { CredentialsReadResult } from '../credentials-service'
import {
  createIntegrationCredentialResolver,
  resolveCredentialFallbackPolicy,
  type PlatformUsageRecord,
} from '../credential-resolver'

const mockLogCalls: Array<{ level: string; message: string; fields: unknown }> = []

jest.mock('@open-mercato/shared/lib/logger', () => {
  const build = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {}
    for (const level of ['debug', 'info', 'warn', 'error']) {
      logger[level] = (message: string, fields?: unknown) => mockLogCalls.push({ level, message, fields })
    }
    logger.child = () => build()
    return logger
  }
  return { createLogger: () => build() }
})

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_A2 = 'abababab-abab-4bab-8bab-abababababab'
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const definitions: IntegrationDefinition[] = [
  {
    id: 'test_mail',
    title: 'Test mail',
    credentials: {
      fields: [
        { key: 'apiKey', label: 'API key', type: 'secret', required: true },
        { key: 'fromEmail', label: 'Sender', type: 'text' },
      ],
    },
    credentialResolution: {
      service: 'email',
      secretField: 'apiKey',
      platformEnv: { apiKey: ['TEST_MAIL_KEY'], fromEmail: ['TEST_MAIL_FROM'] },
    },
  },
  {
    id: 'test_ai_alpha',
    title: 'AI alpha',
    credentials: { fields: [{ key: 'apiKey', label: 'API key', type: 'secret', required: true }] },
    credentialResolution: { service: 'ai', secretField: 'apiKey', platformEnv: { apiKey: ['ALPHA_KEY'] } },
  },
  {
    id: 'test_ai_beta',
    title: 'AI beta',
    credentials: { fields: [{ key: 'apiKey', label: 'API key', type: 'secret', required: true }] },
    credentialResolution: { service: 'ai', secretField: 'apiKey', platformEnv: { apiKey: ['BETA_KEY'] } },
  },
  { id: 'test_plain', title: 'Plain integration' },
]

type StoredValue = Record<string, unknown> | 'unreadable' | 'db-error'

function createHarness(options: {
  stored?: Record<string, StoredValue>
  disabled?: string[]
  env?: Record<string, string | undefined>
  recordFails?: boolean
  readDelayMs?: (key: string) => number
} = {}) {
  const stored = options.stored ?? {}
  const records: Array<PlatformUsageRecord & { scope: IntegrationScope }> = []
  const reads: string[] = []
  const keyFor = (integrationId: string, scope: IntegrationScope) =>
    `${scope.tenantId}:${scope.organizationId}:${integrationId}`
  const readOne = async (integrationId: string, scope: IntegrationScope): Promise<CredentialsReadResult> => {
    const key = keyFor(integrationId, scope)
    reads.push(key)
    const delay = options.readDelayMs?.(key) ?? 0
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    const value = stored[key]
    if (value === undefined) return { status: 'missing' }
    if (value === 'unreadable') throw new IntegrationCredentialError('credential_unreadable', { integrationId })
    if (value === 'db-error') throw new Error('connection terminated unexpectedly')
    return { status: 'present', values: value }
  }
  const resolver = createIntegrationCredentialResolver({
    credentials: {
      readForResolution: readOne,
      async readManyForResolution(integrationIds, scope) {
        const results = new Map<string, CredentialsReadResult>()
        for (const integrationId of integrationIds) results.set(integrationId, await readOne(integrationId, scope))
        return results
      },
    },
    state: {
      async isEnabled(integrationId, scope) {
        return !(options.disabled ?? []).includes(keyFor(integrationId, scope))
      },
    },
    async recordPlatformUsage(record, scope) {
      if (options.recordFails) throw new Error('database unavailable')
      records.push({ ...record, scope })
    },
    env: options.env ?? {},
  })
  return { resolver, records, reads }
}

async function captureError(promise: Promise<unknown>): Promise<IntegrationCredentialError> {
  const error = await promise.then(() => null, (caught: unknown) => caught)
  if (!isIntegrationCredentialError(error)) throw new Error(`expected an IntegrationCredentialError, got ${String(error)}`)
  return error
}

const mailRequest = (tenantId: string, organizationId: string) => ({
  integrationId: 'test_mail',
  scope: { tenantId, organizationId },
  operation: 'sales.quote.send',
  correlationId: 'quote-1',
})

beforeEach(() => {
  clearRegisteredIntegrations()
  registerIntegrations(definitions)
  mockLogCalls.length = 0
})

afterAll(() => {
  clearRegisteredIntegrations()
})

describe('resolveCredentialFallbackPolicy', () => {
  it('defaults to disabled and accepts only the documented values', () => {
    expect(resolveCredentialFallbackPolicy('email', {})).toBe('disabled')
    expect(resolveCredentialFallbackPolicy('email', { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform' })).toBe('platform')
    expect(resolveCredentialFallbackPolicy('ai', { OM_AI_CREDENTIAL_FALLBACK: ' PLATFORM ' })).toBe('platform')
    expect(resolveCredentialFallbackPolicy('ai', { OM_AI_CREDENTIAL_FALLBACK: 'yes' })).toBe('disabled')
  })

  it('keeps email and AI policies independent', () => {
    const env = { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform' }
    expect(resolveCredentialFallbackPolicy('email', env)).toBe('platform')
    expect(resolveCredentialFallbackPolicy('ai', env)).toBe('disabled')
  })
})

describe('integrationCredentialResolver.resolve', () => {
  it('selects the organization credential and records no platform usage', async () => {
    const { resolver, records } = createHarness({
      stored: { [`${TENANT_A}:${ORG_A}:test_mail`]: { apiKey: 're_org_a', fromEmail: 'Acme <billing@acme.test>' } },
      env: { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform', TEST_MAIL_KEY: 're_platform' },
    })

    const credential = await resolver.resolve(mailRequest(TENANT_A, ORG_A))

    expect(credential.source).toBe('customer')
    expect(credential.requiresUsageAttribution).toBe(false)
    expect(credential.secret.reveal()).toBe('re_org_a')
    expect(credential.settings).toEqual({ fromEmail: 'Acme <billing@acme.test>' })
    expect(credential).toMatchObject({ integrationId: 'test_mail', service: 'email', tenantId: TENANT_A, organizationId: ORG_A })
    expect(records).toHaveLength(0)
  })

  it('never exposes the secret through serialization, interpolation or inspection', async () => {
    const { resolver } = createHarness({
      stored: { [`${TENANT_A}:${ORG_A}:test_mail`]: { apiKey: 're_do_not_leak' } },
    })

    const credential = await resolver.resolve(mailRequest(TENANT_A, ORG_A))

    expect(JSON.stringify(credential)).not.toContain('re_do_not_leak')
    expect(`${credential.secret}`).toBe('[redacted]')
    expect(inspect(credential, { depth: 5 })).not.toContain('re_do_not_leak')
    expect(Object.values(credential.settings)).not.toContain('re_do_not_leak')
  })

  it('uses the platform credential only when the policy allows it, and records the use', async () => {
    const { resolver, records } = createHarness({
      env: { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform', TEST_MAIL_KEY: 're_platform', TEST_MAIL_FROM: 'Ops <ops@platform.test>' },
    })

    const credential = await resolver.resolve(mailRequest(TENANT_A, ORG_A))

    expect(credential.source).toBe('platform')
    expect(credential.requiresUsageAttribution).toBe(true)
    expect(credential.secret.reveal()).toBe('re_platform')
    expect(credential.settings).toEqual({ fromEmail: 'Ops <ops@platform.test>' })
    expect(records).toEqual([
      {
        integrationId: 'test_mail',
        service: 'email',
        operation: 'sales.quote.send',
        correlationId: 'quote-1',
        scope: { tenantId: TENANT_A, organizationId: ORG_A, userId: null },
      },
    ])
  })

  it('refuses with integration_not_configured when fallback is disabled, even if a platform key exists', async () => {
    const { resolver, records } = createHarness({ env: { TEST_MAIL_KEY: 're_platform' } })

    const error = await captureError(resolver.resolve(mailRequest(TENANT_A, ORG_A)))

    expect(error.code).toBe('integration_not_configured')
    expect(error.service).toBe('email')
    expect(error.status).toBe(409)
    expect(records).toHaveLength(0)
  })

  it('treats a saved row without the secret field as not configured', async () => {
    const { resolver } = createHarness({
      stored: { [`${TENANT_A}:${ORG_A}:test_mail`]: { fromEmail: 'Acme <billing@acme.test>', apiKey: '   ' } },
    })

    const error = await captureError(resolver.resolve(mailRequest(TENANT_A, ORG_A)))

    expect(error.code).toBe('integration_not_configured')
  })

  it('isolates tenants and organizations', async () => {
    const { resolver } = createHarness({
      stored: {
        [`${TENANT_A}:${ORG_A}:test_mail`]: { apiKey: 're_tenant_a' },
        [`${TENANT_B}:${ORG_B}:test_mail`]: { apiKey: 're_tenant_b' },
      },
    })

    await expect(resolver.resolve(mailRequest(TENANT_A, ORG_A)).then((c) => c.secret.reveal())).resolves.toBe('re_tenant_a')
    await expect(resolver.resolve(mailRequest(TENANT_B, ORG_B)).then((c) => c.secret.reveal())).resolves.toBe('re_tenant_b')
    expect((await captureError(resolver.resolve(mailRequest(TENANT_A, ORG_B)))).code).toBe('integration_not_configured')
    expect((await captureError(resolver.resolve(mailRequest(TENANT_B, ORG_A)))).code).toBe('integration_not_configured')
    expect((await captureError(resolver.resolve(mailRequest(TENANT_A, ORG_A2)))).code).toBe('integration_not_configured')
  })

  it('keeps interleaved resolutions for two tenants apart', async () => {
    const { resolver } = createHarness({
      stored: {
        [`${TENANT_A}:${ORG_A}:test_mail`]: { apiKey: 're_tenant_a' },
        [`${TENANT_B}:${ORG_B}:test_mail`]: { apiKey: 're_tenant_b' },
      },
      readDelayMs: (key) => (key.startsWith(TENANT_A) ? 15 : 1),
    })

    const requests = Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? [TENANT_A, ORG_A] : [TENANT_B, ORG_B]))
    const resolved = await Promise.all(requests.map(([tenantId, organizationId]) => resolver.resolve(mailRequest(tenantId, organizationId))))

    resolved.forEach((credential, index) => {
      const expected = index % 2 === 0 ? 're_tenant_a' : 're_tenant_b'
      expect(credential.secret.reveal()).toBe(expected)
      expect(credential.tenantId).toBe(index % 2 === 0 ? TENANT_A : TENANT_B)
    })
  })

  it('does not reuse one provider credential for another provider', async () => {
    const { resolver } = createHarness({
      stored: { [`${TENANT_A}:${ORG_A}:test_ai_alpha`]: { apiKey: 'sk-alpha' } },
    })

    const alpha = await resolver.resolve({ integrationId: 'test_ai_alpha', scope: { tenantId: TENANT_A, organizationId: ORG_A }, operation: 'ocr' })
    const betaError = await captureError(
      resolver.resolve({ integrationId: 'test_ai_beta', scope: { tenantId: TENANT_A, organizationId: ORG_A }, operation: 'ocr' }),
    )

    expect(alpha.secret.reveal()).toBe('sk-alpha')
    expect(betaError.code).toBe('integration_not_configured')
    expect(betaError.integrationId).toBe('test_ai_beta')
  })

  it.each(['unreadable', 'db-error'] as const)('fails safely without fallback when the stored credential is %s', async (state) => {
    const { resolver, records } = createHarness({
      stored: { [`${TENANT_A}:${ORG_A}:test_mail`]: state },
      env: { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform', TEST_MAIL_KEY: 're_platform' },
    })

    const error = await captureError(resolver.resolve(mailRequest(TENANT_A, ORG_A)))

    expect(error.code).toBe('credential_unreadable')
    expect(error.status).toBe(503)
    expect(records).toHaveLength(0)
  })

  it.each([
    ['missing organization', { tenantId: TENANT_A, organizationId: null }],
    ['missing tenant', { tenantId: undefined, organizationId: ORG_A }],
    ['malformed id', { tenantId: 'tenant-a', organizationId: ORG_A }],
  ])('rejects %s before reading any credential', async (_label, scope) => {
    const { resolver, reads, records } = createHarness({
      env: { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform', TEST_MAIL_KEY: 're_platform' },
    })

    const error = await captureError(resolver.resolve({ integrationId: 'test_mail', scope, operation: 'sales.quote.send' }))

    expect(error.code).toBe('tenant_context_missing')
    expect(reads).toHaveLength(0)
    expect(records).toHaveLength(0)
  })

  it('refuses a disabled integration even when fallback is allowed', async () => {
    const { resolver, records } = createHarness({
      stored: { [`${TENANT_A}:${ORG_A}:test_mail`]: { apiKey: 're_org_a' } },
      disabled: [`${TENANT_A}:${ORG_A}:test_mail`],
      env: { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform', TEST_MAIL_KEY: 're_platform' },
    })

    const error = await captureError(resolver.resolve(mailRequest(TENANT_A, ORG_A)))

    expect(error.code).toBe('integration_disabled')
    expect(records).toHaveLength(0)
  })

  it('reports platform_credential_unavailable when fallback is allowed but no platform key is set', async () => {
    const { resolver } = createHarness({ env: { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform' } })

    expect((await captureError(resolver.resolve(mailRequest(TENANT_A, ORG_A)))).code).toBe('platform_credential_unavailable')
  })

  it('blocks the operation when platform usage cannot be recorded', async () => {
    const { resolver } = createHarness({
      env: { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform', TEST_MAIL_KEY: 're_platform' },
      recordFails: true,
    })

    expect((await captureError(resolver.resolve(mailRequest(TENANT_A, ORG_A)))).code).toBe('usage_recording_failed')
  })

  it('rejects integrations that do not opt into resolution', async () => {
    const { resolver } = createHarness()

    const error = await captureError(
      resolver.resolve({ integrationId: 'test_plain', scope: { tenantId: TENANT_A, organizationId: ORG_A }, operation: 'x' }),
    )

    expect(error.code).toBe('provider_unsupported')
  })

  it('never writes a credential value to the logs', async () => {
    const { resolver } = createHarness({
      stored: { [`${TENANT_A}:${ORG_A}:test_mail`]: 'unreadable' },
      env: { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform', TEST_MAIL_KEY: 're_platform_secret' },
    })
    await captureError(resolver.resolve(mailRequest(TENANT_A, ORG_A)))
    const fallback = createHarness({ env: { OM_EMAIL_CREDENTIAL_FALLBACK: 'platform', TEST_MAIL_KEY: 're_platform_secret' } })
    await fallback.resolver.resolve(mailRequest(TENANT_A, ORG_A))

    expect(mockLogCalls.length).toBeGreaterThan(0)
    expect(JSON.stringify(mockLogCalls.map((call) => ({ message: call.message, fields: call.fields })))).not.toContain('re_platform_secret')
  })
})

describe('integrationCredentialResolver.resolveService', () => {
  const aiRequest = (tenantId: string, organizationId: string) => ({
    service: 'ai' as const,
    scope: { tenantId, organizationId },
    operation: 'ai_assistant.chat',
    correlationId: 'turn-1',
  })

  it('returns only the organization credentials when any provider is configured', async () => {
    const { resolver, records } = createHarness({
      stored: { [`${TENANT_A}:${ORG_A}:test_ai_beta`]: { apiKey: 'sk-beta-org-a' } },
      env: { OM_AI_CREDENTIAL_FALLBACK: 'platform', ALPHA_KEY: 'sk-alpha-platform', BETA_KEY: 'sk-beta-platform' },
    })

    const resolved = await resolver.resolveService(aiRequest(TENANT_A, ORG_A))
    await resolved.markUsed('test_ai_beta')

    expect(resolved.source).toBe('customer')
    expect(resolved.credentials.map((credential) => [credential.integrationId, credential.secret.reveal()])).toEqual([
      ['test_ai_beta', 'sk-beta-org-a'],
    ])
    expect(records).toHaveLength(0)
  })

  it('skips disabled providers', async () => {
    const { resolver } = createHarness({
      stored: {
        [`${TENANT_A}:${ORG_A}:test_ai_alpha`]: { apiKey: 'sk-alpha-org-a' },
        [`${TENANT_A}:${ORG_A}:test_ai_beta`]: { apiKey: 'sk-beta-org-a' },
      },
      disabled: [`${TENANT_A}:${ORG_A}:test_ai_alpha`],
    })

    const resolved = await resolver.resolveService(aiRequest(TENANT_A, ORG_A))

    expect(resolved.credentials.map((credential) => credential.integrationId)).toEqual(['test_ai_beta'])
  })

  it('falls back to the platform set under the platform policy and records the provider actually used', async () => {
    const { resolver, records } = createHarness({
      env: { OM_AI_CREDENTIAL_FALLBACK: 'platform', ALPHA_KEY: 'sk-alpha-platform' },
    })

    const resolved = await resolver.resolveService(aiRequest(TENANT_B, ORG_B))

    expect(resolved.source).toBe('platform')
    expect(resolved.credentials.map((credential) => credential.integrationId)).toEqual(['test_ai_alpha'])
    expect(records).toHaveLength(0)
    await resolved.markUsed('test_ai_alpha')
    expect(records).toEqual([
      expect.objectContaining({ integrationId: 'test_ai_alpha', service: 'ai', operation: 'ai_assistant.chat', correlationId: 'turn-1' }),
    ])
    expect((await captureError(resolved.markUsed('test_mail'))).code).toBe('provider_unsupported')
    expect((await captureError(resolved.markUsed('  '))).code).toBe('provider_unsupported')
  })

  it('records platform use for a platform-only provider that has no integration definition', async () => {
    const { resolver, records } = createHarness({ env: { OM_AI_CREDENTIAL_FALLBACK: 'platform' } })

    const resolved = await resolver.resolveService(aiRequest(TENANT_A, ORG_A))
    await resolved.markUsed('ai_azure')

    expect(resolved.source).toBe('platform')
    expect(resolved.credentials).toHaveLength(0)
    expect(records).toEqual([expect.objectContaining({ integrationId: 'ai_azure', service: 'ai' })])
  })

  it('refuses when no provider is configured and fallback is disabled', async () => {
    const { resolver } = createHarness({ env: { ALPHA_KEY: 'sk-alpha-platform' } })

    const error = await captureError(resolver.resolveService(aiRequest(TENANT_A, ORG_A)))

    expect(error.code).toBe('integration_not_configured')
    expect(error.service).toBe('ai')
  })

  it('fails safely when any stored provider credential is unreadable', async () => {
    const { resolver } = createHarness({
      stored: { [`${TENANT_A}:${ORG_A}:test_ai_alpha`]: 'unreadable' },
      env: { OM_AI_CREDENTIAL_FALLBACK: 'platform', ALPHA_KEY: 'sk-alpha-platform' },
    })

    expect((await captureError(resolver.resolveService(aiRequest(TENANT_A, ORG_A)))).code).toBe('credential_unreadable')
  })
})

describe('integrationCredentialResolver.authorizePlatformUse', () => {
  const request = {
    integrationId: 'test_ai_alpha',
    scope: { tenantId: TENANT_A, organizationId: ORG_A },
    operation: 'ai_assistant.opencode_chat',
  }

  it('refuses platform-only operations when the policy is disabled', async () => {
    const { resolver, records } = createHarness({ stored: { [`${TENANT_A}:${ORG_A}:test_ai_alpha`]: { apiKey: 'sk-org' } } })

    expect((await captureError(resolver.authorizePlatformUse(request))).code).toBe('platform_fallback_prohibited')
    expect(records).toHaveLength(0)
  })

  it('records the use when the policy allows platform credentials', async () => {
    const { resolver, records } = createHarness({ env: { OM_AI_CREDENTIAL_FALLBACK: 'platform' } })

    await resolver.authorizePlatformUse(request)

    expect(records).toEqual([expect.objectContaining({ integrationId: 'test_ai_alpha', operation: 'ai_assistant.opencode_chat' })])
  })
})

describe('integrationCredentialResolver.getServiceStatus', () => {
  it('reports customer, platform and missing configuration without recording usage', async () => {
    const customer = createHarness({ stored: { [`${TENANT_A}:${ORG_A}:test_ai_alpha`]: { apiKey: 'sk-org' } } })
    const platform = createHarness({ env: { OM_AI_CREDENTIAL_FALLBACK: 'platform', BETA_KEY: 'sk-beta-platform' } })
    const none = createHarness({ env: { BETA_KEY: 'sk-beta-platform' } })
    const scope = { tenantId: TENANT_A, organizationId: ORG_A }

    await expect(customer.resolver.getServiceStatus({ service: 'ai', scope })).resolves.toEqual({
      service: 'ai',
      configured: true,
      source: 'customer',
      integrationIds: ['test_ai_alpha'],
      platformFallbackAllowed: false,
    })
    await expect(platform.resolver.getServiceStatus({ service: 'ai', scope })).resolves.toEqual({
      service: 'ai',
      configured: true,
      source: 'platform',
      integrationIds: ['test_ai_beta'],
      platformFallbackAllowed: true,
    })
    await expect(none.resolver.getServiceStatus({ service: 'ai', scope })).resolves.toEqual({
      service: 'ai',
      configured: false,
      source: null,
      integrationIds: [],
      platformFallbackAllowed: false,
    })
    expect([...customer.records, ...platform.records, ...none.records]).toHaveLength(0)
  })
})
