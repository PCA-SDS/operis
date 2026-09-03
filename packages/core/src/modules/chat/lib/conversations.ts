/**
 * The canonical identity of a direct conversation.
 *
 * A 1:1 conversation is defined by its unordered pair of people, so the key
 * sorts the two ids before joining them. "Alice → Bob" and "Bob → Alice"
 * therefore produce the same string, and the unique index over
 * `(tenant_id, organization_id, direct_key)` turns that into a database
 * guarantee rather than a convention the next writer has to remember.
 */
export function buildDirectKey(userIdA: string, userIdB: string): string {
  const [first, second] = [userIdA, userIdB].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return `${first}:${second}`
}

/** The two people a direct key was built from, in sorted order. */
export function parseDirectKey(directKey: string): [string, string] | null {
  const parts = directKey.split(':')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return [parts[0], parts[1]]
}

/** How much of a message the conversation list shows. */
export const MESSAGE_PREVIEW_LENGTH = 200

/**
 * The list preview for a message body: one line, bounded length.
 *
 * Newlines are collapsed because a preview that contains them renders as a
 * one-line row with invisible gaps, and the row would grow if the body were
 * multi-paragraph.
 */
export function buildMessagePreview(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim()
  return collapsed.length > MESSAGE_PREVIEW_LENGTH
    ? `${collapsed.slice(0, MESSAGE_PREVIEW_LENGTH - 1)}…`
    : collapsed
}
