export { matchFeature } from '../lib/auth/featureMatch'
import { matchFeature, hasAllFeatures as matchAllFeatures } from '../lib/auth/featureMatch'

export function hasFeature(granted: readonly string[] | undefined, required: string): boolean {
  if (!Array.isArray(granted) || !granted.length) return false
  return granted.some((feature) => matchFeature(required, feature))
}

/**
 * Documented facade over the grant-matching primitive, with the `(granted, required)`
 * argument order used across the browser/UI call sites.
 *
 * Delegates to `lib/auth/featureMatch` so there is exactly ONE implementation of the
 * check — the two used to be independent copies with reversed parameter orders, which
 * TypeScript could not tell apart because both take string arrays.
 */
export function hasAllFeatures(
  granted: readonly string[] | undefined,
  required: readonly string[] | undefined
): boolean {
  if (!required || required.length === 0) return true
  if (!Array.isArray(granted) || !granted.length) return false
  return matchAllFeatures(required, granted)
}
