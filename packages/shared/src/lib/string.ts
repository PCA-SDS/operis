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

/** A non-empty string exactly as given (not trimmed); anything else is `null`. */
export function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** The string entries of an array that are not blank, left untrimmed; a non-array yields `[]`. */
export function toNonEmptyStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

/** `record[key]` trimmed, or `null` when it is not a non-blank string. */
export function readTrimmedString(record: Record<string, unknown>, key: string): string | null {
  return normalizeOptionalString(record[key])
}

/** `record[key]` as given when it is a string (blank included), otherwise `null`. */
export function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

