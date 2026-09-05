import { registerTranslationProvider } from '@open-mercato/shared/lib/translation/provider'
import { createCTranslate2Provider } from './lib/adapter'

/**
 * Registers the engine when a URL is configured, and stays silent when it is
 * not.
 *
 * A deployment without the translation service running is a normal state, not a
 * broken one -- the feature is additive, and every caller already handles "no
 * provider" by leaving the original text alone. Throwing here would take the
 * whole application down over an optional capability.
 */
export function register(): void {
  // An explicit request for the fake wins over a configured engine, and does so
  // here rather than by registration order - which module registers last is not
  // something a test should have to reason about. This is what stops an engine
  // running on a developer's machine from being reached by an integration run,
  // where the assertions would then depend on model output that changes between
  // revisions.
  if (process.env.OM_TRANSLATION_FAKE_PROVIDER === '1') return

  const baseUrl = process.env.TRANSLATION_SERVICE_URL
  if (!baseUrl) return

  registerTranslationProvider(
    createCTranslate2Provider({
      baseUrl,
      timeoutMs: Number(process.env.TRANSLATION_TIMEOUT_MS ?? 15_000),
      minConfidence: Number(process.env.TRANSLATION_MIN_CONFIDENCE ?? 0.5),
    }),
    { asDefault: true },
  )
}

export default register
