"use client"

/**
 * Shared "is an AI provider key configured?" probe.
 *
 * `/api/ai_assistant/ai/agents` already reports `aiConfigured`
 * (`llmProviderRegistry.resolveFirstConfigured() != null`), so this hook
 * reuses that endpoint instead of adding a second server signal. Results are
 * cached per endpoint at module scope, and in-flight requests are shared, so a
 * page mounting several AI triggers issues exactly one request.
 *
 * `configured === null` means "unknown" — the probe has not resolved, or the
 * endpoint failed. Callers MUST treat unknown as configured (fail open) so a
 * transient 401/500 never replaces a working assistant with a setup notice.
 */

import * as React from 'react'
import { apiCall } from '../backend/utils/apiCall'

export const AI_AGENTS_ENDPOINT = '/api/ai_assistant/ai/agents'

interface AiAgentsConfiguredResponse {
  aiConfigured?: boolean
}

export interface UseAiConfiguredResult {
  /** `true`/`false` once known, `null` while loading or when the probe failed. */
  configured: boolean | null
  /** `true` once the probe settled, whether it produced an answer or not. */
  loaded: boolean
  /** Convenience: the probe answered and the answer was "no provider key". */
  isUnconfigured: boolean
}

const resolvedByEndpoint = new Map<string, boolean | null>()
const inFlightByEndpoint = new Map<string, Promise<boolean | null>>()

export function resetAiConfiguredCacheForTests(): void {
  resolvedByEndpoint.clear()
  inFlightByEndpoint.clear()
}

function probe(endpoint: string): Promise<boolean | null> {
  const inFlight = inFlightByEndpoint.get(endpoint)
  if (inFlight) return inFlight

  const request = apiCall<AiAgentsConfiguredResponse>(endpoint, {
    credentials: 'same-origin',
    headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
  })
    .then((call) => {
      if (!call.ok || !call.result) return null
      return typeof call.result.aiConfigured === 'boolean' ? call.result.aiConfigured : null
    })
    .catch(() => null)
    .then((value) => {
      resolvedByEndpoint.set(endpoint, value)
      inFlightByEndpoint.delete(endpoint)
      return value
    })

  inFlightByEndpoint.set(endpoint, request)
  return request
}

export function useAiConfigured(endpoint: string = AI_AGENTS_ENDPOINT): UseAiConfiguredResult {
  const cached = resolvedByEndpoint.get(endpoint)
  const hasCached = resolvedByEndpoint.has(endpoint)
  const [configured, setConfigured] = React.useState<boolean | null>(hasCached ? (cached ?? null) : null)
  const [loaded, setLoaded] = React.useState(hasCached)

  React.useEffect(() => {
    if (resolvedByEndpoint.has(endpoint)) {
      setConfigured(resolvedByEndpoint.get(endpoint) ?? null)
      setLoaded(true)
      return
    }
    let cancelled = false
    setLoaded(false)
    probe(endpoint).then((value) => {
      if (cancelled) return
      setConfigured(value)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [endpoint])

  return React.useMemo(
    () => ({ configured, loaded, isUnconfigured: loaded && configured === false }),
    [configured, loaded],
  )
}
