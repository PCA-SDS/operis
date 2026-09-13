/**
 * Structural copy of a JSON-serializable value, used by command handlers to
 * snapshot `metadata` / `customFields` blobs before mutating them so undo and
 * audit logs keep the pre-mutation shape.
 *
 * `null` and `undefined` pass through unchanged rather than becoming `null`,
 * because callers distinguish "field absent" from "field set to null".
 * Serialization is deliberate: the values are plain JSON columns, so anything
 * `JSON.stringify` drops (functions, `undefined` members, symbols) is not part
 * of the persisted shape either.
 */
export function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
