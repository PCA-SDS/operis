import type {
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from '@open-mercato/shared/lib/translation/provider'

export const PROVIDER_ID = 'ctranslate2'

/**
 * Languages M2M100 covers that this deployment cares about.
 *
 * Kept as an explicit list rather than "anything the model claims", because an
 * unsupported pair should be a clear refusal the caller can show, not confident
 * nonsense the reader has no way to identify as wrong. M2M100 handles ~100
 * languages; widen this as pairs are actually reviewed.
 */
const SUPPORTED = new Set([
  'en', 'fr', 'vi', 'es', 'de', 'pl', 'ko', 'it', 'pt', 'nl', 'ja', 'zh', 'ar', 'ru', 'th', 'id',
])

type ServiceResponse = {
  body: string
  source_locale: string
  model_revision?: string
  detected_confidence?: number
}

export type CTranslate2Options = {
  baseUrl: string
  timeoutMs?: number
  /**
   * Below this, the engine is guessing. Chat messages are short, and a wrong
   * detection produces a translation that is fluent, plausible and wrong --
   * worse than declining, because nothing about it looks incorrect.
   */
  minConfidence?: number
}

export function createCTranslate2Provider(options: CTranslate2Options): TranslationProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? 15_000
  const minConfidence = options.minConfidence ?? 0.5

  return {
    id: PROVIDER_ID,

    supports(sourceLocale, targetLocale) {
      if (!SUPPORTED.has(targetLocale)) return false
      // An unknown source is fine: the engine detects it. Only a source we know
      // we cannot handle is a refusal.
      return sourceLocale === undefined || SUPPORTED.has(sourceLocale)
    },

    async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
      // Own timeout, combined with any the caller passed, so a hung engine
      // cannot hold a request open indefinitely.
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(), timeoutMs)
      const onAbort = () => timeout.abort()
      signal?.addEventListener('abort', onAbort)

      try {
        const response = await fetch(`${baseUrl}/translate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: request.text,
            target_locale: request.targetLocale,
            source_locale: request.sourceLocale,
          }),
          signal: timeout.signal,
        })

        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          throw new Error(`[internal] translation engine responded ${response.status}: ${detail.slice(0, 200)}`)
        }

        const payload = (await response.json()) as ServiceResponse
        if (typeof payload?.body !== 'string' || typeof payload?.source_locale !== 'string') {
          throw new Error('[internal] translation engine returned an unrecognised payload')
        }

        if (
          request.sourceLocale === undefined &&
          typeof payload.detected_confidence === 'number' &&
          payload.detected_confidence < minConfidence
        ) {
          throw new Error('[internal] source language could not be identified with confidence')
        }

        return {
          body: payload.body,
          sourceLocale: payload.source_locale,
          provider: PROVIDER_ID,
          modelRevision: payload.model_revision,
        }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },

    async healthcheck() {
      try {
        const response = await fetch(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(5_000),
        })
        if (!response.ok) return { ok: false, detail: `responded ${response.status}` }
        const payload = (await response.json()) as { model_revision?: string }
        return { ok: true, detail: payload?.model_revision }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'unreachable' }
      }
    },
  }
}
