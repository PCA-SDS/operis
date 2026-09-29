import type { LlmProvider } from '@open-mercato/shared/lib/ai/llm-provider'
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import { aiProviderIntegrationId } from '@open-mercato/shared/modules/integrations/credential-resolution'
import { createAnthropicAdapter } from './llm-adapters/anthropic'
import { createGoogleAdapter } from './llm-adapters/google'
import { OPENAI_COMPATIBLE_PRESETS } from './openai-compatible-presets'

/**
 * Providers an organization may configure with its own key. Only providers with a fixed public
 * endpoint and an authenticated model-listing call are offered: providers that need a base URL
 * (azure, litellm, ollama, lm-studio) would let a customer point requests at an arbitrary host,
 * and openrouter/requesty have no verified key-check call yet. Those stay platform-only.
 */
export const AI_CREDENTIAL_PROVIDER_IDS = ['openai', 'anthropic', 'google', 'deepinfra', 'groq', 'together', 'fireworks'] as const

export type AiCredentialProviderId = (typeof AI_CREDENTIAL_PROVIDER_IDS)[number]

export type AiProviderProbe =
  | { kind: 'openai_compatible'; baseURL: string; baseURLEnvKeys: readonly string[] }
  | { kind: 'anthropic' }
  | { kind: 'google' }

export type AiCredentialProviderDescriptor = {
  providerId: AiCredentialProviderId
  name: string
  envKeys: readonly string[]
  docsUrl: string
  probe: AiProviderProbe
}

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

const DOCS_URLS: Record<AiCredentialProviderId, string> = {
  openai: 'https://platform.openai.com/docs',
  anthropic: 'https://docs.anthropic.com',
  google: 'https://ai.google.dev',
  deepinfra: 'https://deepinfra.com/docs',
  groq: 'https://console.groq.com/docs',
  together: 'https://docs.together.ai',
  fireworks: 'https://docs.fireworks.ai',
}

export function isAiCredentialProviderId(value: string): value is AiCredentialProviderId {
  return (AI_CREDENTIAL_PROVIDER_IDS as readonly string[]).includes(value)
}

export function aiIntegrationIdForProvider(providerId: string): string {
  return aiProviderIntegrationId(providerId)
}

export function aiProviderHealthCheckServiceName(providerId: AiCredentialProviderId): string {
  return `aiProviderHealthCheck_${providerId}`
}

function describeAdapter(provider: LlmProvider, probe: AiProviderProbe): AiCredentialProviderDescriptor | null {
  if (!isAiCredentialProviderId(provider.id)) return null
  return { providerId: provider.id, name: provider.name, envKeys: provider.envKeys, docsUrl: DOCS_URLS[provider.id], probe }
}

export function listAiCredentialProviders(): AiCredentialProviderDescriptor[] {
  const descriptors: AiCredentialProviderDescriptor[] = []
  for (const preset of OPENAI_COMPATIBLE_PRESETS) {
    if (!isAiCredentialProviderId(preset.id)) continue
    descriptors.push({
      providerId: preset.id,
      name: preset.name,
      envKeys: preset.envKeys,
      docsUrl: DOCS_URLS[preset.id],
      probe: {
        kind: 'openai_compatible',
        baseURL: preset.baseURL ?? OPENAI_DEFAULT_BASE_URL,
        baseURLEnvKeys: preset.baseURLEnvKeys ?? [],
      },
    })
  }
  const anthropic = describeAdapter(createAnthropicAdapter(), { kind: 'anthropic' })
  if (anthropic) descriptors.push(anthropic)
  const google = describeAdapter(createGoogleAdapter(), { kind: 'google' })
  if (google) descriptors.push(google)
  return AI_CREDENTIAL_PROVIDER_IDS.flatMap((providerId) => descriptors.filter((descriptor) => descriptor.providerId === providerId))
}

export function buildAiProviderIntegrations(): IntegrationDefinition[] {
  return listAiCredentialProviders().map((descriptor) => ({
    id: aiIntegrationIdForProvider(descriptor.providerId),
    title: descriptor.name,
    description: `Run AI features for this organization with its own ${descriptor.name} API key.`,
    category: 'ai',
    providerKey: descriptor.providerId,
    icon: 'sparkles',
    docsUrl: descriptor.docsUrl,
    package: '@open-mercato/ai-assistant',
    tags: ['ai', descriptor.providerId],
    defaultState: { isEnabled: true },
    healthCheck: { service: aiProviderHealthCheckServiceName(descriptor.providerId) },
    credentialResolution: {
      service: 'ai',
      secretField: 'apiKey',
      platformEnv: { apiKey: descriptor.envKeys },
    },
    credentials: {
      fields: [
        {
          key: 'apiKey',
          label: `${descriptor.name} API key`,
          type: 'secret',
          required: true,
          helpText: 'Stored encrypted and never shown again. Enter a new key to replace it.',
        },
      ],
    },
  }))
}
