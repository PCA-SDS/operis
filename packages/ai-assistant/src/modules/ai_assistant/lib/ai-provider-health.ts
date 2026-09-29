import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { AiCredentialProviderDescriptor, AiProviderProbe } from './ai-provider-integrations'

type EnvLookup = Record<string, string | undefined>

export type AiProviderHealthResult = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message: string
  details: Record<string, unknown>
}

export const AI_PROVIDER_HEALTH_TIMEOUT_MS = 8_000

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models'
const ANTHROPIC_API_VERSION = '2023-06-01'
const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

function readApiKey(credentials: Record<string, unknown> | null): string {
  return typeof credentials?.apiKey === 'string' ? credentials.apiKey.trim() : ''
}

function readFirstNonEmpty(env: EnvLookup, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return null
}

function buildProbeRequest(probe: AiProviderProbe, apiKey: string, env: EnvLookup): { url: string; headers: Record<string, string> } {
  if (probe.kind === 'anthropic') {
    return { url: ANTHROPIC_MODELS_URL, headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION } }
  }
  if (probe.kind === 'google') {
    return { url: GOOGLE_MODELS_URL, headers: { 'x-goog-api-key': apiKey } }
  }
  const baseURL = (readFirstNonEmpty(env, probe.baseURLEnvKeys) ?? probe.baseURL).replace(/\/+$/, '')
  return { url: `${baseURL}/models`, headers: { Authorization: `Bearer ${apiKey}` } }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/**
 * Validates an AI provider key with the cheapest authenticated call each provider offers: listing
 * models. The key travels only in a request header, never in the URL, and no provider response
 * body is returned, so nothing the provider echoes can reach the caller.
 */
export function createAiProviderHealthCheck(descriptor: AiCredentialProviderDescriptor, env: EnvLookup = process.env) {
  const provider = descriptor.providerId
  return {
    async check(credentials: Record<string, unknown> | null, _scope: IntegrationScope): Promise<AiProviderHealthResult> {
      const apiKey = readApiKey(credentials)
      if (!apiKey) {
        return { status: 'unhealthy', message: `${descriptor.name} API key is empty`, details: { provider } }
      }
      const request = buildProbeRequest(descriptor.probe, apiKey, env)
      let response: Response
      try {
        response = await fetch(request.url, {
          headers: request.headers,
          signal: AbortSignal.timeout(AI_PROVIDER_HEALTH_TIMEOUT_MS),
        })
      } catch (error) {
        if (isTimeoutError(error)) {
          return {
            status: 'unhealthy',
            message: `${descriptor.name} did not respond in time`,
            details: { provider, timeoutMs: AI_PROVIDER_HEALTH_TIMEOUT_MS },
          }
        }
        return { status: 'unhealthy', message: `${descriptor.name} connection failed`, details: { provider } }
      }
      const details = { provider, httpStatus: response.status }
      if (response.ok) {
        return { status: 'healthy', message: `Connected to ${descriptor.name}`, details }
      }
      if (response.status === 401 || response.status === 403) {
        return { status: 'unhealthy', message: `${descriptor.name} rejected the API key (HTTP ${response.status})`, details }
      }
      if (response.status === 429) {
        return { status: 'degraded', message: `${descriptor.name} rate limited the check (HTTP 429); try again shortly`, details }
      }
      if (response.status >= 500) {
        return { status: 'unhealthy', message: `${descriptor.name} is unavailable (HTTP ${response.status}); try again later`, details }
      }
      return { status: 'unhealthy', message: `${descriptor.name} returned HTTP ${response.status}`, details }
    },
  }
}
