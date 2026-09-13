import { createLogger } from '@open-mercato/shared/lib/logger'
import { registerTranslationProvider } from '@open-mercato/shared/lib/translation/provider'
import { createCTranslate2Provider } from './lib/adapter'

const logger = createLogger('translate_ctranslate2')

/**
 * A number from the environment, or the default.
 *
 * `Number(process.env.X ?? fallback)` reads as if it defends against a bad
 * value and does not: the `??` fires on the string, so a typo becomes `NaN` and
 * `NaN ?? d` is `NaN`. Both settings here fail dangerously in that state — a
 * `NaN` timeout aborts every request before it is sent, and a `NaN` minimum
 * confidence disables the gate entirely, because `x < NaN` is always false.
 * Neither produces an error anyone would see.
 */
function readNumber(
  name: string,
  fallback: number,
  isValid: (value: number) => boolean,
): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !isValid(parsed)) {
    logger.error('Ignoring an invalid translation setting and using the default', {
      name,
      fallback,
    })
    return fallback
  }
  return parsed
}

/**
 * The engine's address, if it is one this may talk to.
 *
 * Operator-controlled configuration, so the check is against typos rather than
 * an attacker: a scheme-less value registers happily and then fails every
 * request with a URL parse error that the command reports as an outage. Failing
 * at boot with a named reason is the difference between a five-minute fix and a
 * day of looking at the engine.
 */
function readBaseUrl(): string | null {
  const raw = process.env.TRANSLATION_SERVICE_URL
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    logger.error('TRANSLATION_SERVICE_URL is not a URL; translation stays disabled')
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    logger.error('TRANSLATION_SERVICE_URL must be http or https; translation stays disabled', {
      protocol: parsed.protocol,
    })
    return null
  }
  return raw
}

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

  const baseUrl = readBaseUrl()
  if (!baseUrl) return

  registerTranslationProvider(
    createCTranslate2Provider({
      baseUrl,
      // Part of the cache key. Left unset the cache cannot tell two model
      // vintages apart, so this is set alongside the image tag and bumped with
      // it; see deploy/env.production.example.
      revision: process.env.TRANSLATION_MODEL_REVISION?.trim() || undefined,
      timeoutMs: readNumber('TRANSLATION_TIMEOUT_MS', 15_000, (value) => value > 0),
      minConfidence: readNumber(
        'TRANSLATION_MIN_CONFIDENCE',
        0.5,
        (value) => value >= 0 && value <= 1,
      ),
    }),
    { asDefault: true },
  )
}

export default register
