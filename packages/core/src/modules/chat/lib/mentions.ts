/**
 * Mentions are stored as tokens, not as names.
 *
 * A message body carries `<@{userId}>` where a person was named, and the
 * transcript resolves that id to their CURRENT display name when it renders.
 * Storing `@Alice Tan` instead would freeze a label that changes the moment she
 * is renamed, and would leave the mention as prose rather than a relationship —
 * there would be nothing to notify, and nothing to validate.
 *
 * `<@everyone>` is the one reserved token that resolves to a word rather than to
 * a person. It is deliberately the same shape as a user token so one parser
 * handles both and no second syntax has to be escaped, matched or explained.
 *
 * The body stays plain text throughout. Rendering splits it into segments and
 * emits each as a text node, so a mention is not a route to inject markup.
 */

/** The token a mention takes inside a stored message body. */
export const EVERYONE_TOKEN = '<@everyone>'

/**
 * Matches a mention token. Deliberately strict about the id shape: anything that
 * is not a UUID or the literal `everyone` is left alone as ordinary text, so a
 * message that merely contains `<@` reads as what the person typed.
 */
const MENTION_TOKEN =
  /<@(everyone|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g

export function userToken(userId: string): string {
  return `<@${userId}>`
}

/** The user ids a body names, de-duplicated, in the order they first appear. */
export function extractMentionedUserIds(body: string): string[] {
  const found: string[] = []
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const id = match[1]!
    if (id === 'everyone' || found.includes(id)) continue
    found.push(id)
  }
  return found
}

/** Whether a body addresses the whole space. */
export function mentionsEveryone(body: string): boolean {
  return body.includes(EVERYONE_TOKEN)
}

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; userId: string; label: string }
  | { kind: 'everyone'; label: string }

/**
 * Split a body into what the transcript should render.
 *
 * Names are looked up per segment rather than substituted into the string, so a
 * person whose name is not resolvable — they left the organization, or the row
 * is older than they are — still renders as a mention chip with a fallback label
 * instead of leaking a raw id at the reader.
 */
export function parseMessageBody(
  body: string,
  names: ReadonlyMap<string, string>,
  labels: { everyone: string; unknownPerson: string },
): MessageSegment[] {
  const segments: MessageSegment[] = []
  let cursor = 0

  for (const match of body.matchAll(MENTION_TOKEN)) {
    const start = match.index ?? 0
    if (start > cursor) segments.push({ kind: 'text', text: body.slice(cursor, start) })

    const id = match[1]!
    if (id === 'everyone') segments.push({ kind: 'everyone', label: labels.everyone })
    else segments.push({ kind: 'mention', userId: id, label: names.get(id) ?? labels.unknownPerson })

    cursor = start + match[0].length
  }

  if (cursor < body.length) segments.push({ kind: 'text', text: body.slice(cursor) })
  return segments
}

/**
 * The body as a human would read it, with tokens replaced by names.
 *
 * For places that cannot render segments: the conversation-list preview, a reply
 * quote, a pinned entry, a notification. Without it those surfaces would show
 * `<@8f3c…>` where a colleague's name belongs.
 */
export function renderMentionsAsText(
  body: string,
  names: ReadonlyMap<string, string>,
  labels: { everyone: string; unknownPerson: string },
): string {
  return parseMessageBody(body, names, labels)
    .map((segment) => (segment.kind === 'text' ? segment.text : `@${segment.label}`))
    .join('')
}
