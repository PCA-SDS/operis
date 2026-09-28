export function parseNumberWithDefault(
  raw: string | null | undefined,
  fallback: number,
  options?: { min?: number; integer?: boolean },
): number {
  if (raw == null) return fallback
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const value = options?.integer ? Number.parseInt(trimmed, 10) : Number(trimmed)
  if (!Number.isFinite(value)) return fallback
  const min = options?.min ?? -Infinity
  if (value < min) return fallback
  return value
}

/**
 * A finite number, or a non-blank string that parses to one with `Number()`;
 * anything else is `null`. Unlike {@link parseNumberWithDefault} it accepts
 * numbers as well as strings, which is what untyped payload readers need.
 */
export function toFiniteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** {@link toFiniteNumberOrNull} with a fallback (`0` by default) in place of `null`. */
export function toFiniteNumber(value: unknown, fallback = 0): number {
  return toFiniteNumberOrNull(value) ?? fallback
}

/** The value only when it already is a finite number; strings are not parsed. */
export function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A number as the string a numeric database column is written with; `null` stays `null`. */
export function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

/**
 * A count read from loosely typed context such as a DataTable injection payload:
 * a finite number as given, a numeric string parsed as a base-10 integer,
 * anything else `0`.
 */
export function readCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}
