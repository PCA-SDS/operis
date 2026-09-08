/**
 * Pull a human-readable message out of an API error payload.
 *
 * Servers in this repo report failures under several keys depending on the
 * layer — `error`, `message`, `detail`, `details` — and nest them inside arrays
 * or objects. This walks all of those in a fixed order so a caller gets the
 * first real message rather than rendering `[object Object]` or nothing.
 *
 * Lives in `shared` because both `@open-mercato/ui` and `@open-mercato/core`
 * need it and `ui` cannot depend on `core`. Copies had already drifted: one was
 * missing the `details` branch, so `{ details: '…' }` rendered blank.
 */
export function toErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = toErrorMessage(item)
      if (nested) return nested
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      toErrorMessage(record.error)
      ?? toErrorMessage(record.message)
      ?? toErrorMessage(record.detail)
      ?? toErrorMessage(record.details)
      ?? null
    )
  }
  return null
}
