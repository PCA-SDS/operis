import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { generateObject } from '../../lib/ai-sdk'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { resolveOpenCodeModel } from '@open-mercato/shared/lib/ai/opencode-provider'
import { joinProviderModel } from '@open-mercato/shared/lib/ai/model-id'
import {
  resolveChatConfig,
  type ChatProviderId,
} from '../../lib/chat-config'
import { AiModelFactoryError } from '../../lib/model-factory'
import { resolveAiCredentialContext, resolveScopedAiModel, type AiCredentialRequest } from '../../lib/ai-credentials'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  IntegrationCredentialError,
  integrationCredentialErrorResponse,
  isIntegrationCredentialError,
} from '@open-mercato/shared/modules/integrations/credential-resolution'

const logger = createLogger('ai_assistant')

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI query routing',
  methods: {
    POST: { summary: 'Route user query to appropriate AI handler' },
  },
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

const RouteResultSchema = z.object({
  intent: z.enum(['tool', 'general_chat']),
  toolName: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

function createRoutingModel(providerId: ChatProviderId, apiKey: string, configuredModel?: string) {
  const provider = llmProviderRegistry.get(providerId)
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`)
  }

  // resolveOpenCodeModel is still used for token parsing and provider-prefix
  // validation (`openai/gpt-5-mini` vs `anthropic/claude-…`). It falls back
  // to the provider's defaultModel via the opencode-provider facade, which
  // is only populated for the three native providers — if the registry
  // returns a preset-based provider whose id is unknown to opencode-provider,
  // we short-circuit and use the provider's own defaultModel.
  let modelId: string
  let modelWithProvider: string
  try {
    const resolved = resolveOpenCodeModel(providerId as 'anthropic' | 'openai' | 'google', {
      overrideModel: configuredModel,
    })
    modelId = resolved.modelId
    modelWithProvider = resolved.modelWithProvider
  } catch {
    // Preset-based provider or unknown id — fall back to the provider's own
    // model list. The explicit override (if any) wins.
    const requested = (configuredModel ?? '').trim()
    modelId = requested.length > 0 ? requested : provider.defaultModel
    modelWithProvider = joinProviderModel(providerId, modelId)
  }

  const model = provider.createModel({ modelId, apiKey }) as unknown as Parameters<
    typeof generateObject
  >[0]['model']
  return { model, modelWithProvider }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { query, availableTools } = body as {
      query: string
      availableTools: Array<{ name: string; description: string }>
    }

    logger.debug('Routing query received', { queryChars: query?.length ?? 0 })
    logger.debug('Available tools count', { count: availableTools?.length })

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 })
    }

    if (!availableTools || !Array.isArray(availableTools)) {
      return NextResponse.json({ error: 'availableTools array is required' }, { status: 400 })
    }

    // Get user's configured provider
    const container = await createRequestContainer()
    const credentialRequest: AiCredentialRequest = {
      scope: { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
      operation: 'ai_assistant.route',
    }
    let config = await resolveChatConfig(container)

    // When no DB-stored config is present, delegate provider + model resolution
    // to createModelFactory so OM_AI_PROVIDER / OM_AI_MODEL (Phase 0 of spec
    // 2026-04-27-ai-agents-provider-model-baseurl-overrides) and all registered
    // OpenAI-compatible presets are respected without duplicating the
    // resolution chain here. Legacy OPENCODE_PROVIDER / OPENCODE_MODEL envs are
    // still honored as BC fallbacks inside the factory.
    if (!config) {
      let factoryResolution
      try {
        factoryResolution = await resolveScopedAiModel({
          container,
          request: credentialRequest,
          model: { callerOverride: undefined },
        })
      } catch (error) {
        if (error instanceof AiModelFactoryError && error.code === 'no_provider_configured') {
          return NextResponse.json(
            {
              error:
                'No AI provider configured. Please set an API key for one of the registered providers (Anthropic, OpenAI, Google, DeepInfra, Groq, …).',
            },
            { status: 503 },
          )
        }
        throw error
      }

      logger.debug('Using provider', { providerId: factoryResolution.providerId })

      const modelWithProvider = joinProviderModel(factoryResolution.providerId, factoryResolution.modelId)
      logger.debug('Calling generateObject', { model: modelWithProvider })

      const result = await generateObject({
        model: factoryResolution.model as Parameters<typeof generateObject>[0]['model'],
        schema: RouteResultSchema,
        prompt: `You are a routing assistant. Given a user query, determine if they want to use a specific tool or have a general conversation.

Available tools:
${availableTools.map((t) => `- ${t.name}: ${t.description}`).join('\n')}

User query: "${query}"

Respond with:
- intent: "tool" if user wants to perform an action with a specific tool, "general_chat" otherwise
- toolName: the exact tool name if intent is "tool"
- confidence: 0-1 how confident you are
- reasoning: brief explanation`,
      })

      logger.debug('Routing result', { resultKeys: Object.keys(result.object ?? {}).join(',') })
      return NextResponse.json(result.object)
    }

    logger.debug('Using provider', { providerId: config.providerId })

    // Verify the configured provider is still available
    const credentials = await resolveAiCredentialContext(container, credentialRequest)
    const providerApiKey = credentials.resolveProviderApiKey(config.providerId)
    if (!providerApiKey) {
      if (credentials.source === 'customer') {
        throw new IntegrationCredentialError('integration_not_configured', { service: 'ai' })
      }
      return NextResponse.json(
        { error: `Configured provider ${config.providerId} is no longer available. Please update settings.` },
        { status: 503 }
      )
    }

    // Use fast model for the configured provider
    const { model, modelWithProvider } = createRoutingModel(config.providerId, providerApiKey, config.model)
    await credentials.markModelUsed(config.providerId)

    const toolList = availableTools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n')

    logger.debug('Calling generateObject', { model: modelWithProvider })

    const result = await generateObject({
      model,
      schema: RouteResultSchema,
      prompt: `You are a routing assistant. Given a user query, determine if they want to use a specific tool or have a general conversation.

Available tools:
${toolList}

User query: "${query}"

Respond with:
- intent: "tool" if user wants to perform an action with a specific tool, "general_chat" otherwise
- toolName: the exact tool name if intent is "tool"
- confidence: 0-1 how confident you are
- reasoning: brief explanation`,
    })

    logger.debug('Routing result', { resultKeys: Object.keys(result.object ?? {}).join(',') })
    return NextResponse.json(result.object)
  } catch (error) {
    if (isIntegrationCredentialError(error)) {
      const { translate } = await resolveTranslations()
      return integrationCredentialErrorResponse(error, translate)
    }
    logger.error('AI Route — Error routing query', { err: error })
    return NextResponse.json(
      { error: 'Routing request failed' },
      { status: 500 }
    )
  }
}
