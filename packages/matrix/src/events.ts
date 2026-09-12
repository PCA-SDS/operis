import { z } from 'zod'

/**
 * Matrix event shapes, narrowed to what a chat transport actually consumes.
 *
 * Deliberately not a full model of the Matrix event schema. Events arrive from
 * outside the trust boundary, so the envelope is validated; content is read
 * through accessors that return `null` for anything they do not recognise
 * rather than asserting a shape the homeserver never promised. An unknown
 * event type is a normal occurrence — a room carries state, receipts and, later,
 * whatever a bridge decides to send — and must never throw.
 */

export const MATRIX_EVENT_TYPES = {
  message: 'm.room.message',
  reaction: 'm.reaction',
  redaction: 'm.room.redaction',
  member: 'm.room.member',
  name: 'm.room.name',
  topic: 'm.room.topic',
  powerLevels: 'm.room.power_levels',
  encrypted: 'm.room.encrypted',
} as const

export const RELATION_TYPES = {
  annotation: 'm.annotation',
  replace: 'm.replace',
  thread: 'm.thread',
  reference: 'm.reference',
} as const

/**
 * `looseObject`, because the homeserver adds fields we do not model and
 * stripping them would discard information a later phase needs — `unsigned`
 * carries the redaction marker and the transaction id of our own echo.
 */
export const matrixEventSchema = z.looseObject({
  type: z.string().min(1),
  event_id: z.string().min(1),
  sender: z.string().min(1),
  origin_server_ts: z.number().int().nonnegative(),
  content: z.looseObject({}).default({}),
  room_id: z.string().optional(),
  state_key: z.string().optional(),
  redacts: z.string().optional(),
  unsigned: z.looseObject({}).optional(),
})

export type MatrixEvent = z.infer<typeof matrixEventSchema>

export type MatrixContent = Record<string, unknown>

/**
 * Parse one event from a `/sync` or `/messages` payload.
 *
 * Returns `null` instead of throwing: a single malformed event in a batch must
 * not abort the batch, or one bad row from a future homeserver version stalls
 * ingestion permanently.
 */
export function parseMatrixEvent(raw: unknown): MatrixEvent | null {
  const result = matrixEventSchema.safeParse(raw)
  return result.success ? result.data : null
}

const asRecord = (value: unknown): MatrixContent | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as MatrixContent)
    : null

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

export const isRoomMessage = (event: MatrixEvent): boolean =>
  event.type === MATRIX_EVENT_TYPES.message
export const isReaction = (event: MatrixEvent): boolean =>
  event.type === MATRIX_EVENT_TYPES.reaction
export const isRedaction = (event: MatrixEvent): boolean =>
  event.type === MATRIX_EVENT_TYPES.redaction
export const isMembership = (event: MatrixEvent): boolean =>
  event.type === MATRIX_EVENT_TYPES.member
export const isEncrypted = (event: MatrixEvent): boolean =>
  event.type === MATRIX_EVENT_TYPES.encrypted

/**
 * A redacted event keeps its place in the timeline but loses its content.
 *
 * Detected by the empty content object rather than by looking for a redaction
 * event, because the timeline hands you the tombstone directly and the
 * corresponding `m.room.redaction` may be far away — or, on a backfilled page,
 * absent entirely.
 */
export function isRedacted(event: MatrixEvent): boolean {
  if (event.unsigned && 'redacted_because' in event.unsigned) return true
  return Object.keys(event.content ?? {}).length === 0 && event.type === MATRIX_EVENT_TYPES.message
}

/** The plain-text body of a message event, or `null` if it carries none. */
export function messageBody(event: MatrixEvent): string | null {
  if (!isRoomMessage(event)) return null
  return asString(event.content.body)
}

export function messageMsgtype(event: MatrixEvent): string | null {
  if (!isRoomMessage(event)) return null
  return asString(event.content.msgtype)
}

function relatesTo(event: MatrixEvent): MatrixContent | null {
  return asRecord(event.content['m.relates_to'])
}

/**
 * Whether this event edits another one.
 *
 * An `m.replace` is an EDIT of an existing message, not a new one — but its
 * event type is `m.room.message` and its fallback body reads `* corrected
 * text`, so anything that projects room messages without asking this question
 * turns every edit into a duplicate message carrying an asterisk.
 *
 * A predicate rather than {@link replacement}, which is the accessor for the
 * new content and returns `null` for a malformed edit. A malformed edit is
 * still an edit and must still not be projected as a message.
 *
 * Only `m.replace` qualifies. `m.annotation` arrives as an `m.reaction` and is
 * filtered by type; `m.in_reply_to` carries no `rel_type` at all and is a real
 * message; so is a thread relation, in a concept Operis does not model.
 */
export function isReplacement(event: MatrixEvent): boolean {
  const relation = relatesTo(event)
  return Boolean(relation) && asString(relation!.rel_type) === RELATION_TYPES.replace
}

/**
 * The event this one is a rich reply to.
 *
 * Only `m.in_reply_to` counts. A thread relation is a different concept that
 * Operis does not model, and treating it as a reply would silently reparent
 * messages.
 */
export function replyTarget(event: MatrixEvent): string | null {
  const relation = relatesTo(event)
  if (!relation) return null
  const inReplyTo = asRecord(relation['m.in_reply_to'])
  if (!inReplyTo) return null
  return asString(inReplyTo.event_id)
}

export type Annotation = { targetEventId: string; key: string }

/** A reaction: `rel_type: 'm.annotation'` plus the emoji in `key`. */
export function annotation(event: MatrixEvent): Annotation | null {
  if (!isReaction(event)) return null
  const relation = relatesTo(event)
  if (!relation || relation.rel_type !== RELATION_TYPES.annotation) return null
  const targetEventId = asString(relation.event_id)
  const key = asString(relation.key)
  if (!targetEventId || !key) return null
  return { targetEventId, key }
}

export type Replacement = { targetEventId: string; newBody: string }

/**
 * An edit. The replacement body lives in `m.new_content`, not in `body` —
 * `body` holds the `* edited text` fallback that unaware clients display, and
 * projecting that would put a literal asterisk in front of every edited message.
 */
export function replacement(event: MatrixEvent): Replacement | null {
  if (!isRoomMessage(event)) return null
  const relation = relatesTo(event)
  if (!relation || relation.rel_type !== RELATION_TYPES.replace) return null
  const targetEventId = asString(relation.event_id)
  const newContent = asRecord(event.content['m.new_content'])
  const newBody = newContent ? asString(newContent.body) : null
  if (!targetEventId || !newBody) return null
  return { targetEventId, newBody }
}

export type MembershipChange = {
  userId: string
  membership: 'invite' | 'join' | 'leave' | 'ban' | 'knock'
  displayName: string | null
}

const MEMBERSHIPS = new Set(['invite', 'join', 'leave', 'ban', 'knock'])

export function membershipChange(event: MatrixEvent): MembershipChange | null {
  if (!isMembership(event)) return null
  const userId = asString(event.state_key)
  const membership = asString(event.content.membership)
  if (!userId || !membership || !MEMBERSHIPS.has(membership)) return null
  return {
    userId,
    membership: membership as MembershipChange['membership'],
    displayName: asString(event.content.displayname),
  }
}

/**
 * The transaction id of our own echo, when the homeserver is telling us this
 * event is one we sent.
 *
 * This is how the sync loop recognises an event it already projected inline on
 * the send path, without a database round trip per event.
 */
export function ownTransactionId(event: MatrixEvent): string | null {
  if (!event.unsigned) return null
  return asString(event.unsigned.transaction_id)
}

/** `mxc://server/mediaId` → its parts, or `null` if it is not an mxc URI. */
export function parseMxcUri(uri: string): { serverName: string; mediaId: string } | null {
  if (!uri.startsWith('mxc://')) return null
  const [serverName, mediaId] = uri.slice('mxc://'.length).split('/')
  if (!serverName || !mediaId) return null
  return { serverName, mediaId }
}
