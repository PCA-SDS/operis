/**
 * Keyset pagination cursors.
 *
 * Offset pagination is wrong for a live list: a row that arrives while someone
 * is scrolling shifts every offset by one, so the next page repeats a row or
 * skips one. A cursor names the exact row the previous page ended on, so
 * inserts at the head cannot disturb it.
 *
 * `createdAt` alone is not a stable key — two rows can share a timestamp — so
 * the id is the tiebreaker, and both are compared together.
 */
export type KeysetCursor = {
  createdAt: Date
  id: string
}

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString('base64url')
}

/**
 * Decode a cursor, or return `null` for anything that is not one.
 *
 * Cursors arrive from the query string, so this treats malformed input as "start
 * from the beginning" rather than throwing — a stale bookmark should show the
 * first page, not an error.
 */
export function decodeKeysetCursor(raw: string | undefined | null): KeysetCursor | null {
  if (!raw) return null
  let decoded: string
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }
  // Split on the FIRST separator, not the last: an ISO-8601 timestamp never
  // contains `|`, but an id conceivably could, and `lastIndexOf` would then take
  // the tail as the id and leave a malformed date behind.
  const separator = decoded.indexOf('|')
  if (separator <= 0) return null
  const createdAt = new Date(decoded.slice(0, separator))
  const id = decoded.slice(separator + 1)
  if (Number.isNaN(createdAt.getTime()) || !id) return null
  return { createdAt, id }
}
