export { toOptionalString } from './string/coerce'

/**
 * Trim a value to `null`: non-strings and blank strings become `null`, anything
 * else is returned trimmed.
 *
 * The `null` counterpart of {@link trimToUndefined}. Six modules had declared
 * their own byte-identical copy of this before it lived here; prefer this over
 * writing a seventh. Note it is NOT the same as `toOptionalString`, which keeps
 * the untrimmed value and coerces numbers.
 */
export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function parseCommaSeparatedList(value: string | null | undefined): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

