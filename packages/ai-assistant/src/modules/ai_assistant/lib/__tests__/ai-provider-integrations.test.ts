import { createAiProviderHealthCheck } from '../ai-provider-health'
import {
  AI_CREDENTIAL_PROVIDER_IDS,
  aiIntegrationIdForProvider,
  aiProviderHealthCheckServiceName,
  buildAiProviderIntegrations,
  listAiCredentialProviders,
} from '../ai-provider-integrations'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('AI provider integrations', () => {
  it('offers only providers with fixed endpoints, one integration each', () => {
    const integrations = buildAiProviderIntegrations()

    expect(integrations.map((integration) => integration.id)).toEqual(
      AI_CREDENTIAL_PROVIDER_IDS.map((providerId) => aiIntegrationIdForProvider(providerId)),
    )
    for (const excluded of ['azure', 'litellm', 'ollama', 'lm-studio', 'openrouter', 'requesty']) {
      expect(integrations.some((integration) => integration.providerKey === excluded)).toBe(false)
    }
  })

  it('declares a single secret key field and no customer-controlled URL', () => {
    for (const integration of buildAiProviderIntegrations()) {
      expect(integration.category).toBe('ai')
      expect(integration.credentials?.fields).toEqual([
        expect.objectContaining({ key: 'apiKey', type: 'secret', required: true }),
      ])
      expect(integration.credentialResolution).toEqual({
        service: 'ai',
        secretField: 'apiKey',
        platformEnv: { apiKey: expect.arrayContaining([expect.stringMatching(/_API_KEY$/)]) },
      })
      expect(integration.healthCheck?.service).toBe(aiProviderHealthCheckServiceName(integration.providerKey as never))
    }
  })

  it('maps the platform env keys each provider already reads', () => {
    const openai = buildAiProviderIntegrations().find((integration) => integration.id === 'ai_openai')

    expect(openai?.credentialResolution?.platformEnv.apiKey).toEqual(['OPENAI_API_KEY', 'OPENCODE_OPENAI_API_KEY'])
  })
})

describe('AI provider key check', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  function descriptor(providerId: string) {
    const found = listAiCredentialProviders().find((entry) => entry.providerId === providerId)
    if (!found) throw new Error(`missing descriptor ${providerId}`)
    return found
  }

  function mockFetch(response: Partial<Response> | Error) {
    const fetchMock = jest.fn(async () => {
      if (response instanceof Error) throw response
      return response as Response
    })
    global.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it('lists models with a bearer header for OpenAI-compatible providers and never puts the key in the URL', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 })

    const result = await createAiProviderHealthCheck(descriptor('groq'), {}).check({ apiKey: 'gsk-secret' }, scope)

    expect(result).toEqual({ status: 'healthy', message: 'Connected to Groq', details: { provider: 'groq', httpStatus: 200 } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.groq.com/openai/v1/models')
    expect(url).not.toContain('gsk-secret')
    expect(init.headers).toEqual({ Authorization: 'Bearer gsk-secret' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('probes the platform-configured base URL, never one supplied by the organization', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 })

    await createAiProviderHealthCheck(descriptor('openai'), { OPENAI_BASE_URL: 'https://gateway.platform.test/v1/' })
      .check({ apiKey: 'sk-secret', baseURL: 'https://attacker.example' }, scope)

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://gateway.platform.test/v1/models')
  })

  it('uses provider-specific headers for Anthropic and Google', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 })

    await createAiProviderHealthCheck(descriptor('anthropic'), {}).check({ apiKey: 'sk-ant' }, scope)
    await createAiProviderHealthCheck(descriptor('google'), {}).check({ apiKey: 'AIza-secret' }, scope)

    const [anthropicUrl, anthropicInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const [googleUrl, googleInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(anthropicUrl).toBe('https://api.anthropic.com/v1/models')
    expect(anthropicInit.headers).toEqual({ 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' })
    expect(googleUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(googleUrl).not.toContain('AIza-secret')
    expect(googleInit.headers).toEqual({ 'x-goog-api-key': 'AIza-secret' })
  })

  it.each([
    [401, 'unhealthy', 'OpenAI rejected the API key (HTTP 401)'],
    [403, 'unhealthy', 'OpenAI rejected the API key (HTTP 403)'],
    [429, 'degraded', 'OpenAI rate limited the check (HTTP 429); try again shortly'],
    [503, 'unhealthy', 'OpenAI is unavailable (HTTP 503); try again later'],
    [404, 'unhealthy', 'OpenAI returned HTTP 404'],
  ])('classifies HTTP %s', async (status, expectedStatus, expectedMessage) => {
    mockFetch({ ok: false, status })

    const result = await createAiProviderHealthCheck(descriptor('openai'), {}).check({ apiKey: 'sk-secret' }, scope)

    expect(result.status).toBe(expectedStatus)
    expect(result.message).toBe(expectedMessage)
  })

  it('reports timeouts and connection failures without echoing error details', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    mockFetch(timeout)
    const timedOut = await createAiProviderHealthCheck(descriptor('openai'), {}).check({ apiKey: 'sk-secret' }, scope)
    mockFetch(new Error('getaddrinfo ENOTFOUND api.openai.com sk-secret'))
    const failed = await createAiProviderHealthCheck(descriptor('openai'), {}).check({ apiKey: 'sk-secret' }, scope)

    expect(timedOut).toMatchObject({ status: 'unhealthy', message: 'OpenAI did not respond in time' })
    expect(failed).toEqual({ status: 'unhealthy', message: 'OpenAI connection failed', details: { provider: 'openai' } })
  })

  it('does not call the provider without a key', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 })

    const result = await createAiProviderHealthCheck(descriptor('openai'), {}).check({ apiKey: '  ' }, scope)

    expect(result.status).toBe('unhealthy')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
