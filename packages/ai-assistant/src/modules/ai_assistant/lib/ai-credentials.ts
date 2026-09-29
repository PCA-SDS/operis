import type { AwilixContainer } from 'awilix'
import type { EnvLookup } from '@open-mercato/shared/lib/ai/llm-provider'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import {
  IntegrationCredentialError,
  isIntegrationCredentialError,
  requireIntegrationCredentialResolver,
  resolveIntegrationCredentialResolver,
  type IntegrationCredentialScopeInput,
  type IntegrationCredentialSource,
  type ResolvedIntegrationCredential,
} from '@open-mercato/shared/modules/integrations/credential-resolution'
import { aiIntegrationIdForProvider, listAiCredentialProviders } from './ai-provider-integrations'
import {
  createModelFactory,
  type AiModelFactoryInput,
  type AiModelFactoryRegistry,
  type AiModelResolution,
} from './model-factory'
import './llm-bootstrap'

type ResolverContainer = Parameters<typeof requireIntegrationCredentialResolver>[0]

export type AiCredentialRequest = {
  scope: IntegrationCredentialScopeInput
  operation: string
  correlationId?: string | null
}

export type AiCredentialContext = {
  readonly source: IntegrationCredentialSource
  readonly env: EnvLookup
  readonly preferredProviderIds: ReadonlySet<string> | null
  isProviderConfigured(providerId: string): boolean
  resolveProviderApiKey(providerId: string): string | null
  markModelUsed(providerId: string): Promise<void>
}

export type ScopedAiModelResolution = AiModelResolution & {
  readonly credentialSource: IntegrationCredentialSource
  resolveProviderApiKey(providerId: string): string | null
}

type ProviderRegistry = Pick<AiModelFactoryRegistry, 'get' | 'list'>

function providerIdsByIntegration(): Map<string, string> {
  return new Map(listAiCredentialProviders().map((descriptor) => [aiIntegrationIdForProvider(descriptor.providerId), descriptor.providerId]))
}

/**
 * Starts from the process env with every registered provider's secret env keys removed, then adds
 * only the organization's own keys. Non-secret settings (provider/model defaults, base URLs,
 * allowlists) stay platform-controlled, and a provider the organization has not configured cannot
 * be reached with a platform key.
 */
function buildCustomerEnv(
  baseEnv: EnvLookup,
  credentials: readonly ResolvedIntegrationCredential[],
  registry: ProviderRegistry,
): { env: EnvLookup; providerIds: Set<string> } {
  const secretKeys = new Set((registry.list?.() ?? []).flatMap((provider) => provider.envKeys))
  const env: EnvLookup = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!secretKeys.has(key)) env[key] = value
  }
  const byIntegration = providerIdsByIntegration()
  const providerIds = new Set<string>()
  for (const credential of credentials) {
    const providerId = byIntegration.get(credential.integrationId)
    const provider = providerId ? registry.get?.(providerId) : null
    const envKey = provider?.envKeys[0]
    if (!providerId || !envKey) continue
    env[envKey] = credential.secret.reveal()
    providerIds.add(providerId)
  }
  return { env, providerIds }
}

/**
 * Resolves which AI credentials an operation may use, through `integrationCredentialResolver`.
 * Organization keys win; without any, `OM_AI_CREDENTIAL_FALLBACK=platform` allows the platform
 * env keys, otherwise an `IntegrationCredentialError` (`integration_not_configured`) is thrown.
 */
export async function resolveAiCredentialContext(
  container: ResolverContainer,
  request: AiCredentialRequest,
  registry: ProviderRegistry = llmProviderRegistry,
  baseEnv: EnvLookup = process.env,
): Promise<AiCredentialContext> {
  const resolved = await requireIntegrationCredentialResolver(container).resolveService({
    service: 'ai',
    scope: request.scope,
    operation: request.operation,
    correlationId: request.correlationId ?? null,
  })
  const customer = resolved.source === 'customer' ? buildCustomerEnv(baseEnv, resolved.credentials, registry) : null
  const env = customer?.env ?? baseEnv
  return {
    source: resolved.source,
    env,
    preferredProviderIds: customer?.providerIds ?? null,
    isProviderConfigured(providerId: string) {
      return registry.get?.(providerId)?.isConfigured(env) ?? false
    },
    resolveProviderApiKey(providerId: string) {
      return registry.get?.(providerId)?.resolveApiKey(env) ?? null
    },
    async markModelUsed(providerId: string) {
      await resolved.markUsed(aiIntegrationIdForProvider(providerId))
    },
  }
}

function isModelFactoryError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && error.name === 'AiModelFactoryError'
}

/**
 * The single entry point for creating a language model on behalf of an organization: resolves the
 * organization's credentials, lets `createModelFactory` pick the provider and model, and records
 * platform credential use for the provider that was actually chosen.
 */
export async function resolveScopedAiModel(input: {
  container: ResolverContainer
  request: AiCredentialRequest
  model: AiModelFactoryInput
  registry?: AiModelFactoryRegistry
}): Promise<ScopedAiModelResolution> {
  const registry = input.registry ?? llmProviderRegistry
  const context = await resolveAiCredentialContext(input.container, input.request, registry)
  let resolution: AiModelResolution
  try {
    resolution = createModelFactory(input.container as AwilixContainer, {
      registry,
      env: context.env,
      ...(context.preferredProviderIds ? { preferredProviderIds: context.preferredProviderIds } : {}),
    }).resolveModel(input.model)
  } catch (error) {
    if (context.source === 'customer' && isModelFactoryError(error)) {
      throw new IntegrationCredentialError('integration_not_configured', { service: 'ai', cause: error })
    }
    throw error
  }
  await context.markModelUsed(resolution.providerId)
  return {
    ...resolution,
    credentialSource: context.source,
    resolveProviderApiKey: context.resolveProviderApiKey,
  }
}

export type AiProviderAvailability = {
  readonly source: IntegrationCredentialSource | null
  readonly providerIds: ReadonlySet<string>
}

/**
 * Which AI providers the organization can use right now, for "is AI configured" checks and
 * provider pickers. Reads no secrets into the response and records no usage. Returns no
 * providers when the request has no organization.
 */
export async function resolveAiProviderAvailability(
  container: ResolverContainer,
  scope: IntegrationCredentialScopeInput,
  registry: ProviderRegistry = llmProviderRegistry,
  baseEnv: EnvLookup = process.env,
): Promise<AiProviderAvailability> {
  const resolver = resolveIntegrationCredentialResolver(container)
  if (!resolver) return { source: null, providerIds: new Set() }
  let status
  try {
    status = await resolver.getServiceStatus({ service: 'ai', scope })
  } catch (error) {
    if (isIntegrationCredentialError(error) && error.code === 'tenant_context_missing') {
      return { source: null, providerIds: new Set() }
    }
    throw error
  }
  if (status.source === 'customer') {
    const byIntegration = providerIdsByIntegration()
    const providerIds = new Set(
      status.integrationIds.flatMap((integrationId) => {
        const providerId = byIntegration.get(integrationId)
        return providerId ? [providerId] : []
      }),
    )
    return { source: 'customer', providerIds }
  }
  if (!status.platformFallbackAllowed) return { source: null, providerIds: new Set() }
  const providerIds = new Set(
    (registry.list?.() ?? []).filter((provider) => provider.isConfigured(baseEnv)).map((provider) => provider.id),
  )
  return { source: providerIds.size > 0 ? 'platform' : null, providerIds }
}

