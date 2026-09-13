/**
 * The leaf helpers every module `search.ts` builds its presenters from.
 *
 * These were copy-pasted into fourteen modules and had drifted into up to nine
 * variants of the same function — `warranty_claims`'s `appendLine`, for example,
 * returns early for any non-string, so the first caller there to pass a number
 * or an array would silently drop it from the index.
 *
 * Only the helpers with no cross-dependencies live here. `buildIndexSource` and
 * `appendCustomFieldLines` deliberately stay module-local: the former calls the
 * latter, and the latter genuinely differs between modules, so hoisting them
 * would change what gets indexed.
 */

/** First non-blank string among the candidates, else `null`. */
export function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

/** Trimmed excerpt for a search result subtitle, ellipsised at `max`. */
export function snippet(value: unknown, max = 140): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 3)}...`
}

/**
 * Append a `label: value` line to the indexed text.
 *
 * Arrays are joined, objects are JSON-encoded and scalars stringified, so a
 * numeric or multi-valued field still reaches the index.
 */
export function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => (item === null || item === undefined ? '' : String(item))).filter(Boolean).join(', ')
    : (typeof value === 'object' ? JSON.stringify(value) : String(value))
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

/** Join the non-blank parts of a result subtitle with a middle dot. */
export function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .map((part) => part.trim())
    .filter(Boolean)
  if (text.length === 0) return undefined
  return text.join(' · ')
}

/** Coerce a scalar/Date to indexable text, or `null` when there is nothing to index. */
export function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}
