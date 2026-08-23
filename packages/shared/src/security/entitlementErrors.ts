import { CrudHttpError } from '../lib/crud/errors'

/**
 * The single error code every entitlement denial reports, so callers (and the
 * browser) can tell "this capability is not part of your plan" apart from an
 * ordinary permission failure without parsing prose.
 */
export const FEATURE_NOT_AVAILABLE = 'FEATURE_NOT_AVAILABLE' as const

export type FeatureNotAvailableBody = {
  error: string
  code: typeof FEATURE_NOT_AVAILABLE
  moduleId?: string
}

/**
 * Builds the standardized 403 for a module the caller is not entitled to.
 * Pass an already-translated message — this helper never derives one, so the
 * copy stays routed through i18n. The body deliberately carries only the module
 * id: which tenant or which layer withheld it is not the caller's business.
 */
export function featureNotAvailable(message: string, moduleId?: string): CrudHttpError {
  const body: FeatureNotAvailableBody = { error: message, code: FEATURE_NOT_AVAILABLE }
  if (moduleId) body.moduleId = moduleId
  return new CrudHttpError(403, body)
}
