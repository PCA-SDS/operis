/** @jest-environment node */

/**
 * Regression suite for `packages/core/src/modules/inbox_ops/lib/llmProvider.ts`.
 *
 * Asserts that extraction, translation and categorization resolve their model through
 * `resolveScopedAiModel` for the organization in scope (so organization keys and the AI fallback
 * policy apply), and that the legacy OpenCode env path only runs under the platform policy.
 */

import { generateObject } from 'ai'
import { AiModelFactoryError } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { IntegrationCredentialError } from '@open-mercato/shared/modules/integrations/credential-resolution'
import * as llmProvider from '../lib/llmProvider'
import { extractionOutputSchema } from '../data/validators'

const resolveScopedAiModelMock = jest.fn()
const resolveAiCredentialContextMock = jest.fn()

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}))

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-credentials', () => ({
  resolveScopedAiModel: (...args: unknown[]) => resolveScopedAiModelMock(...args),
  resolveAiCredentialContext: (...args: unknown[]) => resolveAiCredentialContextMock(...args),
}))

type ExtractionObject = ReturnType<typeof extractionOutputSchema.parse>

const FAKE_EXTRACTION_OBJECT = {
  emailClassification: 'inquiry',
  confidenceScore: 0.9,
  language: 'en',
  participants: [],
  extractedItems: [],
  proposedActions: [],
  discrepancies: [],
  summary: 'fake',
} as unknown as ExtractionObject

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const container = { resolve: jest.fn() }

function resolution(overrides: Record<string, unknown> = {}) {
  return {
    model: { __kind: 'fake-model-from-factory' },
    modelId: 'claude-haiku-fake',
    providerId: 'anthropic',
    source: 'module_env' as const,
    credentialSource: 'customer' as const,
    resolveProviderApiKey: () => null,
    ...overrides,
  }
}

describe('inbox_ops llmProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(generateObject as jest.Mock).mockResolvedValue({
      object: FAKE_EXTRACTION_OBJECT,
      usage: { totalTokens: 123 },
    })
  })

  it('keeps the public API shape', () => {
    expect(typeof llmProvider.resolveExtractionProviderId).toBe('function')
    expect(typeof llmProvider.createStructuredModel).toBe('function')
    expect(typeof llmProvider.withTimeout).toBe('function')
    expect(typeof llmProvider.runExtractionWithConfiguredProvider).toBe('function')
    expect(typeof llmProvider.resolveConfiguredStructuredModel).toBe('function')
  })

  it('resolves the extraction model for the email organization through the credential resolver', async () => {
    const resolved = resolution()
    resolveScopedAiModelMock.mockResolvedValue(resolved)

    const result = await llmProvider.runExtractionWithConfiguredProvider({
      container,
      scope,
      correlationId: 'email-1',
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
      modelOverride: 'caller-pinned',
      timeoutMs: 1000,
    })

    expect(resolveScopedAiModelMock).toHaveBeenCalledWith({
      container,
      request: { scope, operation: 'inbox_ops.email.extraction', correlationId: 'email-1' },
      model: { moduleId: 'inbox_ops', callerOverride: 'caller-pinned' },
    })
    const generateCall = (generateObject as jest.Mock).mock.calls[0][0]
    expect(generateCall.model).toBe(resolved.model)
    expect(generateCall.schema).toBe(extractionOutputSchema)
    expect(generateCall.system).toBe('system prompt')
    expect(generateCall.prompt).toBe('user prompt')
    expect(result.object).toBe(FAKE_EXTRACTION_OBJECT)
    expect(result.totalTokens).toBe(123)
    expect(result.modelWithProvider).toBe('anthropic/claude-haiku-fake')
  })

  it('passes an undefined callerOverride through when no override is set', async () => {
    resolveScopedAiModelMock.mockResolvedValue(resolution())

    await llmProvider.runExtractionWithConfiguredProvider({ container, scope, systemPrompt: 's', userPrompt: 'u', timeoutMs: 1000 })

    expect(resolveScopedAiModelMock.mock.calls[0][0].model).toEqual({ moduleId: 'inbox_ops', callerOverride: undefined })
  })

  it('builds a single-prefixed modelWithProvider for a gateway resolution', async () => {
    resolveScopedAiModelMock.mockResolvedValue(resolution({ modelId: 'anthropic/claude-sonnet-4.5', providerId: 'openrouter' }))

    const result = await llmProvider.runExtractionWithConfiguredProvider({ container, scope, systemPrompt: 's', userPrompt: 'u', timeoutMs: 1000 })

    expect(result.modelWithProvider).toBe('openrouter/anthropic/claude-sonnet-4.5')
  })

  it('routes categorize/translation through the same resolution with their own operation', async () => {
    const resolved = resolution({ modelId: 'anthropic/claude-sonnet-4.5', providerId: 'openrouter' })
    resolveScopedAiModelMock.mockResolvedValue(resolved)

    const res = await llmProvider.resolveConfiguredStructuredModel({
      container,
      scope,
      operation: 'inbox_ops.proposal.translate',
      moduleId: 'inbox_ops',
    })

    expect(res.model).toBe(resolved.model)
    expect(res.modelWithProvider).toBe('openrouter/anthropic/claude-sonnet-4.5')
    expect(resolveScopedAiModelMock.mock.calls[0][0].request).toEqual({
      scope,
      operation: 'inbox_ops.proposal.translate',
      correlationId: null,
    })
  })

  it('propagates credential errors without trying the legacy env path', async () => {
    resolveScopedAiModelMock.mockRejectedValue(new IntegrationCredentialError('integration_not_configured', { service: 'ai' }))

    await expect(
      llmProvider.resolveConfiguredStructuredModel({ container, scope, operation: 'x', moduleId: 'inbox_ops' }),
    ).rejects.toMatchObject({ code: 'integration_not_configured' })
    expect(resolveAiCredentialContextMock).not.toHaveBeenCalled()
  })

  it('never uses the legacy env path for an organization running on its own keys', async () => {
    resolveScopedAiModelMock.mockRejectedValue(new AiModelFactoryError('no_provider_configured', 'none configured'))
    resolveAiCredentialContextMock.mockResolvedValue({ source: 'customer', markModelUsed: jest.fn() })

    await expect(
      llmProvider.resolveConfiguredStructuredModel({ container, scope, operation: 'x', moduleId: 'inbox_ops' }),
    ).rejects.toMatchObject({ code: 'integration_not_configured' })
  })

  it('records the legacy env fallback as platform credential use', async () => {
    const saved = { provider: process.env.OM_AI_PROVIDER, key: process.env.ANTHROPIC_API_KEY }
    process.env.OM_AI_PROVIDER = 'anthropic'
    process.env.ANTHROPIC_API_KEY = 'sk-platform-anthropic'
    const markModelUsed = jest.fn()
    resolveScopedAiModelMock.mockRejectedValue(new AiModelFactoryError('no_provider_configured', 'none configured'))
    resolveAiCredentialContextMock.mockResolvedValue({ source: 'platform', markModelUsed })
    try {
      const res = await llmProvider.resolveConfiguredStructuredModel({ container, scope, operation: 'x', moduleId: 'inbox_ops' })
      expect(res.modelWithProvider).toMatch(/^anthropic\//)
      expect(markModelUsed).toHaveBeenCalledWith('anthropic')
    } finally {
      if (saved.provider === undefined) delete process.env.OM_AI_PROVIDER
      else process.env.OM_AI_PROVIDER = saved.provider
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = saved.key
    }
  })

  it('fails loudly (never silently openai) when a non-native OM_AI_PROVIDER reaches the legacy fallback', async () => {
    const prev = process.env.OM_AI_PROVIDER
    process.env.OM_AI_PROVIDER = 'openrouter'
    resolveScopedAiModelMock.mockRejectedValue(new AiModelFactoryError('no_provider_configured', 'none configured'))
    resolveAiCredentialContextMock.mockResolvedValue({ source: 'platform', markModelUsed: jest.fn() })

    try {
      await expect(
        llmProvider.resolveConfiguredStructuredModel({ container, scope, operation: 'x', moduleId: 'inbox_ops' }),
      ).rejects.toThrow(/OM_AI_PROVIDER="openrouter"/)
    } finally {
      if (prev === undefined) delete process.env.OM_AI_PROVIDER
      else process.env.OM_AI_PROVIDER = prev
    }
  })
})

describe('resolveExtractionProviderId — loud failure vs BC fall-through', () => {
  const savedOm = process.env.OM_AI_PROVIDER
  const savedOc = process.env.OPENCODE_PROVIDER

  const setEnv = (key: 'OM_AI_PROVIDER' | 'OPENCODE_PROVIDER', value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  afterEach(() => {
    setEnv('OM_AI_PROVIDER', savedOm)
    setEnv('OPENCODE_PROVIDER', savedOc)
  })

  it('throws a descriptive error for a non-native canonical OM_AI_PROVIDER', () => {
    setEnv('OM_AI_PROVIDER', 'openrouter')
    setEnv('OPENCODE_PROVIDER', undefined)
    expect(() => llmProvider.resolveExtractionProviderId()).toThrow(/OM_AI_PROVIDER="openrouter"/)
  })

  it('still honors a native canonical OM_AI_PROVIDER', () => {
    setEnv('OM_AI_PROVIDER', 'anthropic')
    setEnv('OPENCODE_PROVIDER', undefined)
    expect(llmProvider.resolveExtractionProviderId()).toBe('anthropic')
  })

  it('leaves the legacy OPENCODE_PROVIDER fall-through untouched (no throw)', () => {
    setEnv('OM_AI_PROVIDER', undefined)
    setEnv('OPENCODE_PROVIDER', 'google')
    expect(llmProvider.resolveExtractionProviderId()).toBe('google')
  })
})
