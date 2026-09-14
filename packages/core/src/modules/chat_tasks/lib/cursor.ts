/**
 * Keyset cursors over link rows.
 *
 * The same shape chat uses for its transcript, and for the same reason: links are
 * added to a conversation while somebody is reading its Tasks panel, so an offset
 * page would repeat a row or skip one the moment a new link lands above it.
 *
 * `createdAt` alone is not a key — two links created in the same millisecond are
 * possible — so the id is the tiebreaker and both are compared together.
 */
export type ChatTaskLinkCursor = {
  createdAt: Date
  id: string
}

export function encodeLinkCursor(cursor: ChatTaskLinkCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString('base64url')
}

/** Malformed input starts from the beginning rather than throwing: a stale
 *  bookmark should show the first page, not an error. */
export function decodeLinkCursor(raw: string | undefined | null): ChatTaskLinkCursor | null {
  if (!raw) return null
  let decoded: string
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const separator = decoded.indexOf('|')
  if (separator <= 0) return null
  const createdAt = new Date(decoded.slice(0, separator))
  const id = decoded.slice(separator + 1)
  if (Number.isNaN(createdAt.getTime()) || !id) return null
  return { createdAt, id }
}
