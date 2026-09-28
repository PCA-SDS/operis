import {
  AppOriginConfigurationError,
  AppOriginRejectedError,
  getSecurityEmailBaseUrl,
  resolveRequestOrigin, normalizeOriginPort, isLoopbackHostname,
} from '@open-mercato/shared/lib/url'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('onboarding').child({ component: 'verify' })

type EnvLike = Record<string, string | undefined>

export type VerifyRedirectBaseUrlResult =
  | { ok: true; baseUrl: string }
  | {
    ok: false
    status: 'origin_not_allowed' | 'redirect_misconfigured' | 'url_not_configured'
    message: string
    redirectOrigin: string | null
    httpStatus: number
  }

function normalizeOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

function originsMatchForRedirect(configuredOrigin: string, requestOrigin: string): boolean {
  if (configuredOrigin === requestOrigin) return true
  try {
    const configured = new URL(configuredOrigin)
    const request = new URL(requestOrigin)
    return (
      configured.protocol === request.protocol &&
      isLoopbackHostname(configured.hostname) &&
      isLoopbackHostname(request.hostname) &&
      normalizeOriginPort(configured) === normalizeOriginPort(request)
    )
  } catch {
    return false
  }
}

export function resolveVerifyRedirectBaseUrl(
  req: Request,
  env: EnvLike = process.env,
): VerifyRedirectBaseUrlResult {
  try {
    const baseUrl = getSecurityEmailBaseUrl(req, env)
    const configuredOrigin = normalizeOrigin(baseUrl)
    const requestOrigin = normalizeOrigin(resolveRequestOrigin(req)) ?? normalizeOrigin(req.url)
    if (configuredOrigin && requestOrigin && !originsMatchForRedirect(configuredOrigin, requestOrigin)) {
      logger.error('APP_URL does not match verification request origin', {
        requestUrl: req.url,
        configuredOrigin,
        requestOrigin,
      })
      return {
        ok: false,
        status: 'redirect_misconfigured',
        message: 'Onboarding verification redirect is misconfigured.',
        redirectOrigin: requestOrigin,
        httpStatus: 400,
      }
    }
    return { ok: true, baseUrl }
  } catch (error) {
    if (error instanceof AppOriginRejectedError) {
      logger.error('Rejected request origin for redirect base', {
        requestUrl: req.url,
        reason: error.message,
      })
      return {
        ok: false,
        status: 'origin_not_allowed',
        message: 'Onboarding verification request origin is not allowed.',
        redirectOrigin: null,
        httpStatus: 400,
      }
    }
    if (error instanceof AppOriginConfigurationError) {
      logger.error('APP_URL is required for onboarding verification redirects', {
        requestUrl: req.url,
        reason: error.message,
      })
      return {
        ok: false,
        status: 'url_not_configured',
        message: 'Onboarding verification redirect is not configured.',
        redirectOrigin: null,
        httpStatus: 500,
      }
    }
    throw error
  }
}
