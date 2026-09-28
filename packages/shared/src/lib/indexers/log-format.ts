/** Shared payload shaping for the indexer error and status logs. */

export function truncate(input: string | null | undefined, limit: number): string | null {
  if (!input) return null
  return input.length > limit ? `${input.slice(0, limit - 3)}...` : input
}

export function safeJson(value: unknown): unknown {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    if (value == null) return null
    if (typeof value === 'object') {
      return { note: 'unserializable', asString: String(value) }
    }
    return value
  }
}
