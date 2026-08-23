export type FeatureEntry = { id: string; title?: string; module?: string }

export function featureString(entry: FeatureEntry | string): string {
  return typeof entry === 'string' ? entry : entry.id
}

export function featureScope(featureId: string): string {
  const dotIndex = featureId.indexOf('.')
  return dotIndex === -1 ? featureId : featureId.slice(0, dotIndex)
}

export function extractFeatureStrings(entries: Array<FeatureEntry | string>): string[] {
  return entries.map(featureString)
}

/**
 * Checks if a required feature is satisfied by a granted feature permission.
 *
 * Wildcard patterns:
 * - `*` (global wildcard): Grants access to all features
 * - `prefix.*` (module wildcard): Grants access to all features starting with `prefix.`
 *   and also the exact prefix itself
 * - Exact match: Feature must match exactly
 */
export function matchFeature(required: string, granted: string): boolean {
  if (granted === '*') return true
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -2)
    return required === prefix || required.startsWith(prefix + '.')
  }
  return granted === required
}

/**
 * Checks if all required features are satisfied by the granted feature set.
 *
 * NOTE ON ARGUMENT ORDER — this is the single implementation of the check, but it
 * is reachable through two import paths with *opposite* conventions:
 *
 *   `@open-mercato/shared/lib/auth/featureMatch` -> hasAllFeatures(required, granted)
 *   `@open-mercato/shared/security/features`     -> hasAllFeatures(granted, required)
 *
 * Both parameters are string arrays, so TypeScript cannot catch a swapped call, and
 * a swap silently changes the authorization answer (the second argument is treated
 * as the wildcard *pattern* set). `security/features` is the documented facade and
 * delegates here; prefer it, and prefer asking the RBAC service over either when a
 * user and scope are available. `__tests__/featureMatch.conventions.test.ts` pins
 * both orders so the two cannot drift apart again.
 */
export function hasAllFeatures(required: readonly string[], granted: readonly string[]): boolean {
  if (!required.length) return true
  if (!granted.length) return false
  return required.every((req) => granted.some((g) => matchFeature(req, g)))
}
