/**
 * Canonical date-normalization helpers for API and command layers.
 *
 * These replaced roughly sixty hand-written copies that had settled into two
 * genuinely different contracts for the same job. Both are kept, named for what
 * they actually do, because collapsing them would change API responses:
 *
 * - {@link toIsoOrNull} answers `null` for anything it cannot parse.
 * - {@link toIsoOrEcho} hands the original string back instead.
 *
 * Prefer `toIsoOrNull` in new code. Echoing an unparseable value leaves a field
 * the client reads as a timestamp holding arbitrary text, with no way to tell
 * the difference; `null` is at least honest about it.
 */

/** ISO-8601 string, or `null` when the value is absent or unparseable. */
export function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * ISO-8601 string, falling back to the original string when it cannot be parsed.
 *
 * Only for response mappers that already shipped this behavior — a caller
 * relying on it would otherwise see a field change from text to `null`.
 */
export function toIsoOrEcho(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    if (value.length === 0) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

/** `Date` for a truthy value, else `null`. Does not validate — mirrors the ORM-facing copies. */
export function toDateOrNull(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

/** `YYYY-MM-DD` in UTC, or `null` when the value is absent or unparseable. */
export function toDateOnlyIso(value: Date | string | null | undefined): string | null {
  const iso = toIsoOrNull(value)
  return iso ? iso.slice(0, 10) : null
}
