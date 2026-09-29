import { generateObject } from 'ai'
import {
  resolveAiProviderIdFromEnv,
  resolveFirstConfiguredOpenCodeProvider,
  resolveOpenCodeModel,
  requireOpenCodeProviderApiKey,
  resolveOpenCodeProviderId,
  isOpenCodeProviderId,
  type OpenCodeProviderId,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import { AiModelFactoryError } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import {
  resolveAiCredentialContext,
  resolveScopedAiModel,
  type AiCredentialRequest,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-credentials'
import { IntegrationCredentialError } from '@open-mercato/shared/modules/integrations/credential-resolution'
import { joinProviderModel } from '@open-mercato/shared/lib/ai/model-id'
import { extractionOutputSchema } from '../data/validators'
import { withTimeout } from '@open-mercato/shared/lib/async'

export { withTimeout }

// Vercel AI SDK provider factories return LanguageModelV1 but generateObject()
// expects a narrower LanguageModel union. The types are structurally compatible
// at runtime; the cast is required until the AI SDK unifies its model types.
type AiModel = Parameters<typeof generateObject>[0]['model']
function asAiModel(model: unknown): AiModel {
  return model as AiModel
}

/**
 * Step 5.1 — thin backward-compatibility shim. The public surface of this
 * module (`resolveExtractionProviderId`, `createStructuredModel`,
 * `withTimeout`, `runExtractionWithConfiguredProvider`) is unchanged so
 * `ai-tools.ts`, `translationProvider.ts`, and `extractionWorker.ts` continue
 * to compile and pass their existing tests.
 *
 * The model-instantiation path inside {@link runExtractionWithConfiguredProvider}
 * now delegates to the shared {@link createModelFactory} so every
 * AI-runtime caller shares one resolution order. The legacy
 * `OPENCODE_MODEL` / `OPENCODE_PROVIDER` envs remain honored via
 * {@link resolveExtractionProviderId} and {@link resolveOpenCodeModel} so
 * inbox_ops deployments do not see a behavior change — the factory is
 * consulted first (honoring `OM_AI_INBOX_OPS_MODEL` — legacy `INBOX_OPS_AI_MODEL` — + `input.modelOverride`),
 * with the legacy path as the fallback when no registry provider is
 * configured (preserving the historical error messages).
 */

export function resolveExtractionProviderId(): OpenCodeProviderId {
  // Honors OM_AI_PROVIDER first, then the legacy OPENCODE_PROVIDER, then the
  // first configured provider from `OPEN_CODE_PROVIDER_IDS`, then the unified
  // default (currently `openai`). Mirrors the precedence applied by the
  // shared model factory so the BC fallback path stays consistent.
  // This resolver only runs on the legacy fallback path (the unified factory
  // already threw `no_provider_configured`). If the operator explicitly set the
  // canonical OM_AI_PROVIDER to a provider the native-only switch cannot serve
  // (e.g. a gateway like `openrouter`), fail loudly with a descriptive error
  // instead of silently coercing to `openai` via resolveAiProviderIdFromEnv —
  // reaching here means that provider is also not configured for the factory.
  const canonicalProvider = (process.env.OM_AI_PROVIDER ?? '').trim()
  if (canonicalProvider.length > 0 && !isOpenCodeProviderId(canonicalProvider.toLowerCase())) {
    throw new Error(
      `[internal] OM_AI_PROVIDER="${canonicalProvider}" is set but that provider is not configured ` +
        `(no API key found), and the legacy inbox_ops extraction fallback only supports ` +
        `anthropic, openai, or google. Set the provider's API key (e.g. OPENROUTER_API_KEY for ` +
        `openrouter) so the unified model factory can serve it, or switch OM_AI_PROVIDER to a ` +
        `configured native provider.`,
    )
  }

  const explicit = (canonicalProvider || (process.env.OPENCODE_PROVIDER ?? '').trim())
  if (explicit.length > 0) {
    return resolveAiProviderIdFromEnv(process.env)
  }

  const firstConfiguredProvider = resolveFirstConfiguredOpenCodeProvider()
  if (firstConfiguredProvider) {
    return firstConfiguredProvider
  }

  return resolveOpenCodeProviderId(undefined)
}

export async function createStructuredModel(
  providerId: OpenCodeProviderId,
  apiKey: string,
  modelId: string,
): Promise<AiModel> {
  switch (providerId) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return asAiModel(createAnthropic({ apiKey })(modelId))
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return asAiModel(createOpenAI({ apiKey })(modelId))
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return asAiModel(createGoogleGenerativeAI({ apiKey })(modelId))
    }
    default:
      throw new Error(`Unsupported provider: ${providerId}`)
  }
}

/**
 * Test-only seam for the factory-delegation regression suite. Production
 * callers MUST use {@link runExtractionWithConfiguredProvider} directly; the
 * suite overrides this binding via `jest.spyOn` to assert the shim actually
 * reaches `createModelFactory` without stubbing `@open-mercato/ai-assistant`.
 */
type AiModelContainer = Parameters<typeof resolveScopedAiModel>[0]['container']

export type InboxOpsModelRequest = AiCredentialRequest & {
  container: AiModelContainer
  moduleId?: string
  modelOverride?: string | null
}

/**
 * Resolves the extraction/translation model for the organization in `scope` through
 * `integrationCredentialResolver`. The legacy OpenCode env fallback only runs under the platform
 * credential policy, and its use is recorded like any other platform fallback.
 */
export async function resolveConfiguredStructuredModel(
  input: InboxOpsModelRequest,
): Promise<{ model: AiModel; modelWithProvider: string }> {
  const request: AiCredentialRequest = {
    scope: input.scope,
    operation: input.operation,
    correlationId: input.correlationId ?? null,
  }
  try {
    const resolution = await resolveScopedAiModel({
      container: input.container,
      request,
      model: {
        moduleId: input.moduleId ?? 'inbox_ops',
        callerOverride: input.modelOverride ?? undefined,
      },
    })
    return {
      model: asAiModel(resolution.model),
      modelWithProvider: joinProviderModel(resolution.providerId, resolution.modelId),
    }
  } catch (err) {
    if (!(err instanceof AiModelFactoryError)) throw err
  }
  const context = await resolveAiCredentialContext(input.container, request)
  if (context.source !== 'platform') {
    throw new IntegrationCredentialError('integration_not_configured', { service: 'ai' })
  }
  const providerId = resolveExtractionProviderId()
  const apiKey = requireOpenCodeProviderApiKey(providerId)
  const modelConfig = resolveOpenCodeModel(providerId, {
    overrideModel: input.modelOverride,
  })
  const model = await createStructuredModel(providerId, apiKey, modelConfig.modelId)
  await context.markModelUsed(providerId)
  return { model, modelWithProvider: modelConfig.modelWithProvider }
}

export async function runExtractionWithConfiguredProvider(input: {
  container: AiModelContainer
  scope: AiCredentialRequest['scope']
  correlationId?: string | null
  systemPrompt: string
  userPrompt: string
  modelOverride?: string | null
  timeoutMs: number
}): Promise<{
  object: ReturnType<typeof extractionOutputSchema.parse>
  totalTokens: number
  modelWithProvider: string
}> {
  const { model, modelWithProvider } = await resolveConfiguredStructuredModel({
    container: input.container,
    scope: input.scope,
    operation: 'inbox_ops.email.extraction',
    correlationId: input.correlationId ?? null,
    moduleId: 'inbox_ops',
    modelOverride: input.modelOverride,
  })

  const result = await withTimeout(
    generateObject({
      model,
      schema: extractionOutputSchema,
      system: input.systemPrompt,
      prompt: input.userPrompt,
      temperature: 0,
    }),
    input.timeoutMs,
    `LLM extraction timed out after ${input.timeoutMs}ms`,
  )

  return {
    object: result.object,
    totalTokens: Number(result.usage?.totalTokens ?? 0) || 0,
    modelWithProvider,
  }
}
