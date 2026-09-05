import type { TranslationProvider, TranslationRequest, TranslationResult } from './provider'

export const FAKE_PROVIDER_ID = 'fake'

/**
 * A network-free translation engine for tests and offline development.
 *
 * Deterministic on purpose: an integration test asserting on machine-translated
 * prose would be asserting on the model, which changes between revisions and is
 * not what those tests are for. What they need to prove is the plumbing --
 * caching, scoping, mention survival, the skip reasons -- and that is exactly
 * what this makes stable.
 *
 * The output carries its target language so a test can tell "translated into
 * French" from "handed back unchanged" without knowing any French.
 *
 * Two sentinels drive the paths that are otherwise hard to reach:
 *
 *   - text containing `FAIL_TRANSLATION` throws, for the per-message failure path
 *   - text beginning `[[xx]]` declares its source language, so a test can force
 *     "already in your language" without depending on detection
 */
export function createFakeTranslationProvider(): TranslationProvider {
  return {
    id: FAKE_PROVIDER_ID,

    // Anything, so a test can use an unusual language without the fake being the
    // thing that refuses it.
    supports: () => true,

    async translate(request: TranslationRequest): Promise<TranslationResult> {
      if (request.text.includes('FAIL_TRANSLATION')) {
        throw new Error('[internal] fake translation provider was asked to fail')
      }

      const declared = /^\[\[([a-z]{2})\]\]\s*/i.exec(request.text)
      const sourceLocale = request.sourceLocale ?? declared?.[1]?.toLowerCase() ?? 'en'
      const text = declared ? request.text.slice(declared[0].length) : request.text

      return {
        // Prefixed rather than replaced: the original words stay visible, so a
        // test can assert that mention markers survived the round trip.
        body: sourceLocale === request.targetLocale ? text : `[${request.targetLocale}] ${text}`,
        sourceLocale,
        provider: FAKE_PROVIDER_ID,
        modelRevision: 'fake-1',
      }
    },

    async healthcheck() {
      return { ok: true, detail: 'fake' }
    },
  }
}
