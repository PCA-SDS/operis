import { NextResponse } from 'next/server'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK, RATE_LIMIT_FALLBACK_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'

const logger = createLogger('auth').child({ component: 'rate-limit' })

export interface CheckAuthRateLimitOptions {
  req: Request
  ipConfig: RateLimitConfig
  compoundConfig?: RateLimitConfig
  /** Raw identifier for compound key (e.g., email). Hashed internally before use. */
  compoundIdentifier?: string
}

export interface CheckAuthRateLimitResult {
  error: NextResponse | null
  compoundKey: string | null
}

/**
 * Announce that an unexpected throw inside the rate-limit check let a login,
 * refresh or reset request through uncounted.
 *
 * A Redis outage does NOT reach here: `RateLimiterService.consume()` absorbs it
 * behind an in-memory insurance limiter and, when even that fails, returns a
 * `degraded` result rather than throwing. What lands in the caller's catch is
 * everything else — a bootstrap/DI failure, a translation load failure, a hash
 * failure — and each of those silently disables brute-force protection.
 *
 * Reporting is best-effort and swallows its own errors: observability must
 * never turn a fail-open into a failed login.
 */
function reportRateLimitCheckFailure(error: unknown, keyPrefix: string | undefined): void {
  try {
    logger.error(
      'Auth rate limit check failed; brute-force protection was not enforced for this request',
      { keyPrefix, err: error },
    )
    getTelemetryRuntime()?.reportError(error, {
      module: 'auth',
      attributes: { operation: 'checkAuthRateLimit', keyPrefix, degraded: true },
    })
  } catch {
    // Reporting must never alter authentication behavior.
  }
}

/**
 * Fail-open rate limit check for auth endpoints.
 * Layer 1: IP-only check with ipConfig.
 * Layer 2 (optional): compound IP + hashed identifier check with compoundConfig.
 *
 * Stays fail-open by design — see `reportRateLimitCheckFailure`. Flipping it to
 * fail-closed would turn any unexpected throw in this path (DI, i18n, hashing)
 * into a total login outage for every tenant, so the degradation is made loud
 * instead of being changed silently.
 */
export async function checkAuthRateLimit(options: CheckAuthRateLimitOptions): Promise<CheckAuthRateLimitResult> {
  try {
    const isIntegrationTestMode = process.env.OM_TEST_MODE === '1' && process.env.OM_TEST_AUTH_RATE_LIMIT_MODE === 'opt-in'
    if (isIntegrationTestMode) {
      const rateLimitHeader = options.req.headers.get('x-om-test-rate-limit')
      if (rateLimitHeader !== 'on') {
        return { error: null, compoundKey: null }
      }
    }

    const rateLimiterService = getCachedRateLimiterService()
    if (!rateLimiterService) return { error: null, compoundKey: null }

    const clientIp = getClientIp(options.req, rateLimiterService.trustProxyDepth)
    const clientKey = clientIp ?? RATE_LIMIT_FALLBACK_KEY

    const { translate } = await resolveTranslations()
    const errorMessage = translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)

    const ipError = await checkRateLimit(rateLimiterService, options.ipConfig, clientKey, errorMessage)
    if (ipError) return { error: ipError, compoundKey: null }

    if (options.compoundConfig && options.compoundIdentifier) {
      const hash = computeEmailHash(options.compoundIdentifier)
      const compoundKey = `${clientKey}:${hash}`
      const compoundError = await checkRateLimit(rateLimiterService, options.compoundConfig, compoundKey, errorMessage)
      if (compoundError) return { error: compoundError, compoundKey }
      return { error: null, compoundKey }
    }

    return { error: null, compoundKey: null }
  } catch (error) {
    reportRateLimitCheckFailure(error, options.ipConfig.keyPrefix)
    return { error: null, compoundKey: null }
  }
}

/**
 * Best-effort reset of a compound rate-limit key after successful authentication.
 * Never throws — wrapped in try/catch.
 */
export async function resetAuthRateLimit(compoundKey: string, config: RateLimitConfig): Promise<void> {
  try {
    const rateLimiterService = getCachedRateLimiterService()
    if (rateLimiterService) {
      await rateLimiterService.delete(compoundKey, config)
    }
  } catch {
    // best-effort — don't fail the request if counter reset fails
  }
}
