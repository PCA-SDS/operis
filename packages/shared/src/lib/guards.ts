/**
 * Runtime type guards shared across packages.
 *
 * `isRecord` is the one "is this a JSON-style object" check: not null, an
 * object, not an array. About fifty modules each carried a private copy, spelled
 * several ways (`!!value && …`, `value !== null && …`, `Boolean(value) && …`)
 * with identical behaviour. A check that must also reject a `Date`, or anything
 * whose prototype is not `Object.prototype`, answers a different question and
 * keeps its own guard.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** The value when it is a record, otherwise an empty one, for reading optional fields off untyped input. */
export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/** The value when it is a record, otherwise `null`, for callers that must tell "no object" apart from an empty one. */
export function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}
