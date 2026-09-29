import type { EnvLookup, LlmCreateModelOptions, LlmProvider } from '@open-mercato/shared/lib/ai/llm-provider'
import { IntegrationCredentialError, isIntegrationCredentialError } from '@open-mercato/shared/modules/integrations/credential-resolution'
import { createTestCredentialResolver, type TestCredentialResolver } from '@open-mercato/shared/lib/testing/integrationCredentials'
import type { AiModelFactoryRegistry } from '../model-factory'
import { resolveAiCredentialContext, resolveAiProviderAvailability, resolveScopedAiModel } from '../ai-credentials'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

type CreatedModel = { providerId: string; modelId: string; apiKey: string }

function envProvider(id: string, envKeys: string[], defaultModel: string): LlmProvider {
  const resolveApiKey = (env?: EnvLookup) => {
    for (const key of envKeys) {
      const value = (env ?? {})[key]?.trim()
      if (value) return value
    }
    return null
  }
  return {
    id,
    name: id,
    envKeys,
    defaultModel,
    defaultModels: [{ id: defaultModel, name: defaultModel, contextWindow: 1000 }],
    isConfigured: (env?: EnvLookup) => resolveApiKey(env) !== null,
    resolveApiKey,
    getConfiguredEnvKey: () => envKeys[0],
    createModel: (options: LlmCreateModelOptions): CreatedModel => ({ providerId: id, modelId: options.modelId, apiKey: options.apiKey }),
  }
}

function buildRegistry(): AiModelFactoryRegistry {
  const providers = [
    envProvider('openai', ['OPENAI_API_KEY', 'OPENCODE_OPENAI_API_KEY'], 'gpt-5-mini'),
    envProvider('anthropic', ['ANTHROPIC_API_KEY'], 'claude-haiku-4-5'),
    envProvider('ollama', ['OLLAMA_API_KEY'], 'llama3.3'),
  ]
  return {
    get: (id: string) => providers.find((provider) => provider.id === id) ?? null,
    list: () => providers,
    resolveFirstConfigured: (options) => {
      const env = options?.env ?? {}
      for (const id of options?.order ?? []) {
        const provider = providers.find((candidate) => candidate.id === id)
        if (provider?.isConfigured(env)) return provider
      }
      return providers.find((provider) => provider.isConfigured(env)) ?? null
    },
  }
}

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const platformEnv = {
  OPENAI_API_KEY: 'sk-platform-openai',
  ANTHROPIC_API_KEY: 'sk-platform-anthropic',
  OLLAMA_API_KEY: 'local-platform',
  OM_AI_PROVIDER: 'openai',
  OM_AI_MODEL: 'gpt-5',
}

function containerWith(resolver: TestCredentialResolver) {
  return {
    resolve: <T,>(name: string) => (name === 'integrationCredentialResolver' ? resolver : undefined) as T,
    hasRegistration: (name: string) => name === 'integrationCredentialResolver',
  }
}

const request = (tenantId = TENANT_A, organizationId = ORG_A) => ({
  scope: { tenantId, organizationId },
  operation: 'ai_assistant.agent.test.assistant',
})

describe('resolveAiCredentialContext', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, ...platformEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it("keeps only the organization's keys and none of the platform keys", async () => {
    const resolver = createTestCredentialResolver({ ai_anthropic: { secret: 'sk-org-anthropic', service: 'ai' } }, { defaultService: 'ai' })

    const context = await resolveAiCredentialContext(containerWith(resolver), request(), buildRegistry())

    expect(context.source).toBe('customer')
    expect(context.env.ANTHROPIC_API_KEY).toBe('sk-org-anthropic')
    expect(context.env.OPENAI_API_KEY).toBeUndefined()
    expect(context.env.OPENCODE_OPENAI_API_KEY).toBeUndefined()
    expect(context.env.OLLAMA_API_KEY).toBeUndefined()
    expect(context.env.OM_AI_PROVIDER).toBe('openai')
    expect([...(context.preferredProviderIds ?? [])]).toEqual(['anthropic'])
    expect(context.isProviderConfigured('anthropic')).toBe(true)
    expect(context.isProviderConfigured('openai')).toBe(false)
  })

  it('uses the platform env unchanged under the platform policy', async () => {
    const resolver = createTestCredentialResolver({}, { defaultService: 'ai', platformFallbackAllowed: true })

    const context = await resolveAiCredentialContext(containerWith(resolver), request(), buildRegistry())

    expect(context.source).toBe('platform')
    expect(context.env).toBe(process.env)
    expect(context.preferredProviderIds).toBeNull()
  })

  it('refuses when the organization has no key and fallback is disabled', async () => {
    const resolver = createTestCredentialResolver({}, { defaultService: 'ai' })

    const error = await resolveAiCredentialContext(containerWith(resolver), request(), buildRegistry()).catch((caught: unknown) => caught)

    expect(isIntegrationCredentialError(error)).toBe(true)
    expect((error as IntegrationCredentialError).code).toBe('integration_not_configured')
  })

  it('fails closed without a registered resolver', async () => {
    const error = await resolveAiCredentialContext({ resolve: jest.fn(), hasRegistration: () => false }, request(), buildRegistry())
      .catch((caught: unknown) => caught)

    expect((error as IntegrationCredentialError).code).toBe('resolver_unavailable')
  })
})

describe('resolveScopedAiModel', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, ...platformEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it("creates the model with the organization's key and ignores an env model pinned to another provider", async () => {
    const resolver = createTestCredentialResolver({ ai_anthropic: { secret: 'sk-org-anthropic', service: 'ai' } }, { defaultService: 'ai' })

    const resolution = await resolveScopedAiModel({
      container: containerWith(resolver),
      request: request(),
      model: { moduleId: 'customers' },
      registry: buildRegistry(),
    })

    expect(resolution.model).toEqual({ providerId: 'anthropic', modelId: 'claude-haiku-4-5', apiKey: 'sk-org-anthropic' })
    expect(resolution.credentialSource).toBe('customer')
    expect(resolution.resolveProviderApiKey('anthropic')).toBe('sk-org-anthropic')
    expect(resolution.resolveProviderApiKey('openai')).toBeNull()
    expect(resolver.used).toEqual([])
  })

  it('keeps the env model when it belongs to a provider the organization configured', async () => {
    const resolver = createTestCredentialResolver({ ai_openai: { secret: 'sk-org-openai', service: 'ai' } }, { defaultService: 'ai' })

    const resolution = await resolveScopedAiModel({
      container: containerWith(resolver),
      request: request(),
      model: { moduleId: 'customers' },
      registry: buildRegistry(),
    })

    expect(resolution.model).toEqual({ providerId: 'openai', modelId: 'gpt-5', apiKey: 'sk-org-openai' })
  })

  it('turns an explicit pin to an unconfigured provider into an actionable configuration error', async () => {
    const resolver = createTestCredentialResolver({ ai_anthropic: { secret: 'sk-org-anthropic', service: 'ai' } }, { defaultService: 'ai' })

    const error = await resolveScopedAiModel({
      container: containerWith(resolver),
      request: request(),
      model: { moduleId: 'customers', requestOverride: { providerId: 'openai', modelId: 'gpt-5' } },
      registry: buildRegistry(),
    }).catch((caught: unknown) => caught)

    expect(isIntegrationCredentialError(error)).toBe(true)
    expect((error as IntegrationCredentialError).code).toBe('integration_not_configured')
    expect((error as IntegrationCredentialError).service).toBe('ai')
  })

  it('records platform use for the provider the factory actually picked', async () => {
    const resolver = createTestCredentialResolver({}, { defaultService: 'ai', platformFallbackAllowed: true })

    const resolution = await resolveScopedAiModel({
      container: containerWith(resolver),
      request: request(),
      model: { moduleId: 'customers' },
      registry: buildRegistry(),
    })

    expect(resolution.model).toEqual({ providerId: 'openai', modelId: 'gpt-5', apiKey: 'sk-platform-openai' })
    expect(resolution.credentialSource).toBe('platform')
    expect(resolver.used).toEqual(['ai_openai'])
  })

  it('keeps two tenants on their own keys when their resolutions interleave', async () => {
    const keysByTenant: Record<string, string> = { [TENANT_A]: 'sk-tenant-a', [TENANT_B]: 'sk-tenant-b' }
    const resolver: TestCredentialResolver = {
      ...createTestCredentialResolver({}, { defaultService: 'ai' }),
      async resolveService(serviceRequest) {
        const tenantId = serviceRequest.scope.tenantId as string
        await new Promise((resolve) => setTimeout(resolve, tenantId === TENANT_A ? 10 : 1))
        const scoped = createTestCredentialResolver({ ai_openai: { secret: keysByTenant[tenantId], service: 'ai' } }, { defaultService: 'ai' })
        return scoped.resolveService(serviceRequest)
      },
    }

    const results = await Promise.all(
      [TENANT_A, TENANT_B, TENANT_A, TENANT_B].map((tenantId) =>
        resolveScopedAiModel({
          container: containerWith(resolver),
          request: request(tenantId, tenantId === TENANT_A ? ORG_A : ORG_B),
          model: { moduleId: 'customers' },
          registry: buildRegistry(),
        }),
      ),
    )

    expect(results.map((result) => (result.model as CreatedModel).apiKey)).toEqual([
      'sk-tenant-a',
      'sk-tenant-b',
      'sk-tenant-a',
      'sk-tenant-b',
    ])
  })
})

describe('resolveAiProviderAvailability', () => {
  const env = { OPENAI_API_KEY: 'sk-platform-openai' }

  it("lists the organization's providers", async () => {
    const resolver = createTestCredentialResolver({ ai_anthropic: { secret: 'sk-org', service: 'ai' } }, { defaultService: 'ai' })

    const availability = await resolveAiProviderAvailability(containerWith(resolver), request().scope, buildRegistry(), env)

    expect(availability.source).toBe('customer')
    expect([...availability.providerIds]).toEqual(['anthropic'])
  })

  it('lists env-configured providers only when platform fallback is allowed', async () => {
    const allowed = createTestCredentialResolver({}, { defaultService: 'ai', platformFallbackAllowed: true })
    const disabled = createTestCredentialResolver({}, { defaultService: 'ai' })

    const withFallback = await resolveAiProviderAvailability(containerWith(allowed), request().scope, buildRegistry(), env)
    const withoutFallback = await resolveAiProviderAvailability(containerWith(disabled), request().scope, buildRegistry(), env)

    expect([...withFallback.providerIds]).toEqual(['openai'])
    expect(withoutFallback.providerIds.size).toBe(0)
    expect(withoutFallback.source).toBeNull()
  })

  it('reports nothing when the request has no organization', async () => {
    const resolver = createTestCredentialResolver({ ai_anthropic: { secret: 'sk-org', service: 'ai' } }, { defaultService: 'ai' })

    const availability = await resolveAiProviderAvailability(
      containerWith(resolver),
      { tenantId: TENANT_A, organizationId: null },
      buildRegistry(),
      env,
    )

    expect(availability.providerIds.size).toBe(0)
  })
})
