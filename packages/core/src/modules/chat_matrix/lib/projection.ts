import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  annotation,
  isReaction,
  isRedacted,
  isRedaction,
  isReplacement,
  isRoomMessage,
  messageBody,
  messageMsgtype,
  operisUserIdFromMxid,
  parseMxcUri,
  parseReadReceipts,
  replacement,
  replyTarget,
  type MatrixClient,
  type MatrixConfig,
  type MatrixEvent,
} from '@open-mercato/matrix'
import type { ChatScope } from '@open-mercato/core/modules/chat/lib/scope'
import { ChatMatrixEvent, ChatMatrixRoom } from '../data/entities'
import { reactionSubjectKey } from './subjectKey'
import { ingestMatrixMedia } from './media'
import { resolveChatAttachmentLimits } from '@open-mercato/core/modules/chat/lib/attachmentPolicy'

const logger = createLogger('chat_matrix').child({ component: 'projection' })

/**
 * Turning a Matrix event back into an Operis message.
 *
 * The load-bearing decision here is that this **replays the event through
 * `chat.messages.send`** rather than writing `chat_messages` rows itself.
 * Writing rows directly would be shorter and would silently skip mention
 * validation, attachment linking, the search document, the link index and the
 * conversation preview — every invariant the chat module enforces in exactly one
 * place. Going through the command keeps that one place, and keeps the module's
 * own rule that there is a single send path.
 *
 * The command is told the event is the origin, so it does not publish the
 * message straight back to the homeserver it came from.
 */

export type ProjectionDeps = {
  em: EntityManager
  commandBus: CommandBus
  config: MatrixConfig
  container: CommandRuntimeContext['container']
  /**
   * Needed to fetch the bytes of a file posted in a Matrix client.
   *
   * Required rather than optional on purpose: without it an `m.image` would
   * quietly become a message whose text is a filename, which is exactly the
   * kind of silent degradation this module has been bitten by before.
   */
  client: MatrixClient
}

export type ProjectionOutcome =
  | { kind: 'projected'; messageId: string }
  | { kind: 'skipped'; reason: ProjectionSkipReason }

export type ProjectionSkipReason =
  | 'already-known'
  | 'not-a-message'
  | 'redacted'
  | 'unmapped-room'
  | 'external-sender'
  | 'empty-body'
  | 'operis-orphan'
  /** The relation points at an event Operis has no mapping for. */
  | 'unmapped-target'
  /** The command refused: Operis' own rule, applied to a Matrix actor. */
  | 'not-permitted'

/**
 * Project one event, or explain why not.
 *
 * Every non-message outcome is a `skipped`, never a throw. A room legitimately
 * carries state events, receipts and — once a bridge is attached — senders that
 * are not Operis users at all. Throwing on any of those would stall the loop on
 * ordinary traffic.
 */
export async function projectEvent(
  deps: ProjectionDeps,
  event: MatrixEvent,
  roomId: string,
): Promise<ProjectionOutcome> {
  // The idempotency gate, and the echo suppressor in one.
  //
  // A message Operis sent already has a mapping row, written inside the same
  // transaction that created it — so our own echo is recognised here without a
  // second heuristic, and a redelivered event is too.
  const known = await deps.em.findOne(ChatMatrixEvent, { eventId: event.event_id })
  if (known) return { kind: 'skipped', reason: 'already-known' }

  // The three relations, before the plain-message path. Each one changes a
  // message that already exists rather than adding one, so each resolves its
  // target through the mapping table and replays the change through the command
  // that owns the rule — never by writing `chat_*` rows here.
  if (isReaction(event)) return projectAnnotation(deps, event, roomId)
  if (isRedaction(event)) return projectRedaction(deps, event, roomId)

  if (!isRoomMessage(event)) return { kind: 'skipped', reason: 'not-a-message' }
  if (isRedacted(event)) return { kind: 'skipped', reason: 'redacted' }
  if (isReplacement(event)) return projectReplacement(deps, event, roomId)

  /**
   * Our own message, published but never committed. Do not resurrect it.
   *
   * In authoritative mode the publish precedes the transaction, so a failed
   * commit leaves an event here with no mapping. Projecting it would create a
   * message the user was told had failed — alongside the one their retry
   * already succeeded in sending. A duplicate is worse than a gap, and the gap
   * is what the user already saw and acted on.
   *
   * The trade is that Matrix keeps an event Operis does not. For internal chat
   * nothing else reads those rooms; when something does, the honest repair is
   * to redact the orphan rather than to project it.
   */
  if (event.content['om.origin'] === 'operis') {
    logger.info('skipping an Operis-originated event with no mapping: its send did not commit', {
      eventId: event.event_id,
      roomId,
    })
    return { kind: 'skipped', reason: 'operis-orphan' }
  }

  const room = await deps.em.findOne(ChatMatrixRoom, { roomId })
  if (!room) {
    // A room the appservice can see but Operis never created. Not an error —
    // the bot may have been invited to something, and reading it into a
    // conversation nobody authorized would be the actual bug.
    return { kind: 'skipped', reason: 'unmapped-room' }
  }

  const senderUserId = operisUserIdFromMxid(deps.config, event.sender)
  if (!senderUserId) {
    // Not an Operis identity: the appservice bot, or — once a bridge is
    // attached — somebody on WhatsApp. The second case is real work, not a
    // skip, and it needs an external-participant model the chat schema does not
    // have yet. Refusing to guess is the honest behaviour until it does.
    logger.debug('skipping an event from a non-Operis sender', {
      sender: event.sender,
      roomId,
    })
    return { kind: 'skipped', reason: 'external-sender' }
  }

  const body = messageBody(event)
  if (!body) return { kind: 'skipped', reason: 'empty-body' }

  const replyToEventId = replyTarget(event)
  const replyToMessageId = replyToEventId
    ? (await deps.em.findOne(ChatMatrixEvent, { eventId: replyToEventId }))?.messageId ?? undefined
    : undefined

  const scope = { tenantId: room.tenantId, organizationId: room.organizationId }

  /**
   * A file posted in a Matrix client, brought across as a real attachment.
   *
   * Matrix sends a file as a message of its own whose `body` is the filename,
   * so without this an image arrives as a chat message reading `holiday.png`
   * and the `mxc://` is dropped on the floor. `ingestMatrixMedia` copies the
   * bytes into Operis' own store — never links Synapse's — so the file is
   * scanned and served exactly like one a colleague uploaded.
   *
   * A failure degrades to that same plain message rather than skipping the
   * event: a transcript missing a picture is recoverable, a transcript missing
   * the fact that somebody sent something is not.
   */
  const attachmentIds = await ingestEventMedia(deps, event, scope, room.conversationId, senderUserId)

  const result = await deps.commandBus.execute<
    Record<string, unknown>,
    { message: { id: string }; deduplicated: boolean }
  >('chat.messages.send', {
    input: {
      ...scope,
      conversationId: room.conversationId,
      body,
      replyToMessageId,
      attachmentIds,
      externalOrigin: {
        eventId: event.event_id,
        // The Operis id is minted here rather than derived from the event id:
        // `chat_messages.id` is a uuid column and a Matrix event id is not one.
        // The mapping row is what ties them together.
        messageId: randomUUID(),
        // The homeserver's own timestamp. This is the one place a Matrix clock
        // is allowed to set an Operis timestamp, because for an event Operis did
        // not send there is no better answer — and the alternative, stamping it
        // with the moment the loop happened to read it, would order a backlog by
        // when it was drained rather than when it was said.
        createdAt: new Date(event.origin_server_ts),
      },
    },
    ctx: projectionContext(deps, scope, senderUserId),
  })

  const messageId = result.result?.message?.id
  if (!messageId) throw new Error('[internal] chat.messages.send returned no message')
  return { kind: 'projected', messageId }
}

/** The msgtypes that carry a file rather than prose. */
const MEDIA_MSGTYPES = new Set(['m.image', 'm.video', 'm.audio', 'm.file'])

/**
 * Pull the file off a media event, if it has one.
 *
 * Returns the attachment ids to hand the send command — empty for an ordinary
 * text message, and empty again whenever the copy could not be made, which the
 * caller treats as "project it as text".
 */
async function ingestEventMedia(
  deps: ProjectionDeps,
  event: MatrixEvent,
  scope: ChatScope,
  conversationId: string,
  senderUserId: string,
): Promise<string[]> {
  const msgtype = messageMsgtype(event)
  if (!msgtype || !MEDIA_MSGTYPES.has(msgtype)) return []

  const uri = typeof event.content.url === 'string' ? event.content.url : null
  const mxc = uri ? parseMxcUri(uri) : null
  if (!mxc) {
    // An encrypted attachment carries `file` instead of `url`, and Operis holds
    // no keys. Nothing to fetch.
    logger.debug('a media event carried no plain mxc:// url', { eventId: event.event_id, msgtype })
    return []
  }

  const info = (event.content.info ?? {}) as Record<string, unknown>
  const fileName =
    (typeof event.content.filename === 'string' && event.content.filename) ||
    messageBody(event) ||
    'attachment'
  const mimeType = typeof info.mimetype === 'string' ? info.mimetype : null

  let buffer: Buffer
  try {
    const response = await deps.client.downloadMedia(mxc.serverName, mxc.mediaId)
    buffer = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    logger.error('could not download a file posted over Matrix', {
      eventId: event.event_id,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }

  const attachmentId = await ingestMatrixMedia({
    em: deps.em,
    container: deps.container as never,
    scope,
    conversationId,
    senderUserId,
    fileName,
    mimeType,
    buffer,
    maxBytes: resolveChatAttachmentLimits().maxBytes,
  })
  return attachmentId ? [attachmentId] : []
}

/**
 * Where an inbound change is allowed to land: a room Operis owns, and a sender
 * it can name.
 *
 * Every relation branch needs the same two answers before it can do anything,
 * and gets them in the same order the message path does.
 */
async function resolveTarget(
  deps: ProjectionDeps,
  event: MatrixEvent,
  roomId: string,
): Promise<
  | { ok: true; room: ChatMatrixRoom; senderUserId: string; scope: ChatScope }
  | { ok: false; outcome: ProjectionOutcome }
> {
  const room = await deps.em.findOne(ChatMatrixRoom, { roomId })
  if (!room) return { ok: false, outcome: { kind: 'skipped', reason: 'unmapped-room' } }

  const senderUserId = operisUserIdFromMxid(deps.config, event.sender)
  if (!senderUserId) {
    logger.debug('skipping a relation from a non-Operis sender', { sender: event.sender, roomId })
    return { ok: false, outcome: { kind: 'skipped', reason: 'external-sender' } }
  }

  return {
    ok: true,
    room,
    senderUserId,
    scope: { tenantId: room.tenantId, organizationId: room.organizationId },
  }
}

/**
 * Record that this event has been dealt with.
 *
 * Written for its own sake, not as a side effect of a publish: without it the
 * `already-known` gate cannot recognise a redelivery, and the whole reason the
 * sync cursor can be re-read safely is that every event it hands over is
 * idempotent.
 */
async function recordProjectedEvent(
  deps: ProjectionDeps,
  scope: ChatScope,
  room: ChatMatrixRoom,
  event: MatrixEvent,
  extra: { messageId?: string | null; subjectKey?: string | null } = {},
): Promise<void> {
  const now = new Date()
  deps.em.persist(
    deps.em.create(ChatMatrixEvent, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      messageId: extra.messageId ?? null,
      subjectKey: extra.subjectKey ?? null,
      conversationId: room.conversationId,
      roomId: room.roomId,
      eventId: event.event_id,
      eventType: event.type,
      originServerTs: new Date(event.origin_server_ts),
      projectedAt: now,
      createdAt: now,
    }),
  )
  await deps.em.flush()
}

/**
 * Run a command on behalf of a Matrix actor, and treat its refusal as a skip.
 *
 * Operis' own rules decide what an actor may do — only the author edits, author
 * or space owner deletes — and the projector deliberately does not
 * re-implement them. But one refused event must never stall the stream: the
 * cursor would stop advancing and every later event behind it would be stuck
 * too, over a permission decision that will never change.
 */
async function replay(
  deps: ProjectionDeps,
  scope: ChatScope,
  senderUserId: string,
  commandId: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; error?: unknown }> {
  try {
    await deps.commandBus.execute<Record<string, unknown>, unknown>(commandId, {
      input: { ...scope, ...input },
      ctx: projectionContext(deps, scope, senderUserId),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

/** `reaction:<messageId>:<userId>:<emoji>` — the emoji may itself contain a colon. */
function parseReactionSubjectKey(
  key: string,
): { messageId: string; userId: string; emoji: string } | null {
  const parts = key.split(':')
  if (parts.length < 4 || parts[0] !== 'reaction') return null
  return { messageId: parts[1], userId: parts[2], emoji: parts.slice(3).join(':') }
}

/**
 * A reaction added in a Matrix client.
 *
 * The mapping row is written BEFORE the command runs, and both halves of that
 * ordering matter. It is what makes the outbound mirror recognise this reaction
 * as already represented and decline to send it straight back — `publishReaction`
 * returns early when a row exists for the subject key. And it is what makes a
 * redelivery a no-op: a reaction replayed through a toggle is a reaction taken
 * away.
 */
async function projectAnnotation(
  deps: ProjectionDeps,
  event: MatrixEvent,
  roomId: string,
): Promise<ProjectionOutcome> {
  const relation = annotation(event)
  if (!relation) return { kind: 'skipped', reason: 'not-a-message' }

  const resolved = await resolveTarget(deps, event, roomId)
  if (!resolved.ok) return resolved.outcome
  const { room, senderUserId, scope } = resolved

  const target = await deps.em.findOne(ChatMatrixEvent, { eventId: relation.targetEventId })
  if (!target?.messageId) return { kind: 'skipped', reason: 'unmapped-target' }

  const subjectKey = reactionSubjectKey({
    messageId: target.messageId,
    userId: senderUserId,
    emoji: relation.key,
  })

  // Already represented — this person's reaction with this emoji on this
  // message is mirrored, whichever side put it there.
  const existing = await deps.em.findOne(ChatMatrixEvent, { subjectKey })
  if (existing) return { kind: 'skipped', reason: 'already-known' }

  await recordProjectedEvent(deps, scope, room, event, { subjectKey })

  const outcome = await replay(deps, scope, senderUserId, 'chat.messages.toggleReaction', {
    conversationId: room.conversationId,
    messageId: target.messageId,
    emoji: relation.key,
    externalOrigin: { eventId: event.event_id, reacted: true },
  })

  if (!outcome.ok) {
    // Take the claim back. Leaving it would tell the mirror a reaction exists
    // that Operis refused to store, and the annotation could never be redacted.
    const written = await deps.em.findOne(ChatMatrixEvent, { eventId: event.event_id })
    if (written) {
      deps.em.remove(written)
      await deps.em.flush()
    }
    logger.info('inbound reaction refused by the chat module', {
      eventId: event.event_id,
      messageId: target.messageId,
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    })
    return { kind: 'skipped', reason: 'not-permitted' }
  }

  return { kind: 'projected', messageId: target.messageId }
}

/**
 * A redaction, which is two different things wearing one event type.
 *
 * Matrix has no "un-react": taking a reaction back is redacting the annotation.
 * So what this means depends entirely on what the redacted event was mapped to
 * — a message, or a reaction — and the mapping table is the only thing that
 * knows.
 */
async function projectRedaction(
  deps: ProjectionDeps,
  event: MatrixEvent,
  roomId: string,
): Promise<ProjectionOutcome> {
  const redacts = event.redacts
  if (!redacts) return { kind: 'skipped', reason: 'not-a-message' }

  const resolved = await resolveTarget(deps, event, roomId)
  if (!resolved.ok) return resolved.outcome
  const { room, senderUserId, scope } = resolved

  const target = await deps.em.findOne(ChatMatrixEvent, { eventId: redacts })
  if (!target) {
    // Includes our own un-react echo: `publishReaction` deletes the mapping as
    // it redacts, so by the time the loop reads the redaction there is nothing
    // left to point at, which is the correct outcome rather than a miss.
    return { kind: 'skipped', reason: 'unmapped-target' }
  }

  if (target.messageId) {
    /**
     * A message deleted in a Matrix client.
     *
     * This also catches Operis' own deletion echo, because a redaction carries
     * no content and so cannot be marked `om.origin`. Replaying it is harmless:
     * `chat.messages.delete` converges on an already-deleted message and
     * reports no change, so nothing is emitted twice.
     */
    const outcome = await replay(deps, scope, senderUserId, 'chat.messages.delete', {
      conversationId: room.conversationId,
      messageId: target.messageId,
      externalOrigin: { eventId: event.event_id },
    })
    if (!outcome.ok) {
      logger.info('inbound deletion refused by the chat module', {
        eventId: event.event_id,
        messageId: target.messageId,
        error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      })
      return { kind: 'skipped', reason: 'not-permitted' }
    }
    await recordProjectedEvent(deps, scope, room, event)
    return { kind: 'projected', messageId: target.messageId }
  }

  const reaction = target.subjectKey ? parseReactionSubjectKey(target.subjectKey) : null
  if (!reaction) return { kind: 'skipped', reason: 'unmapped-target' }

  /**
   * Only the person who reacted may take it back.
   *
   * A room moderator can redact anyone's annotation, and Operis has no such
   * concept — `chat_message_reactions` rows belong to one person and the toggle
   * is always the caller's own. Removing someone else's reaction on their behalf
   * would be inventing a permission, so it is refused instead.
   */
  if (reaction.userId !== senderUserId) {
    logger.info('ignoring a redaction of somebody else reaction', {
      eventId: event.event_id,
      sender: event.sender,
    })
    return { kind: 'skipped', reason: 'not-permitted' }
  }

  const outcome = await replay(deps, scope, senderUserId, 'chat.messages.toggleReaction', {
    conversationId: room.conversationId,
    messageId: reaction.messageId,
    emoji: reaction.emoji,
    externalOrigin: { eventId: event.event_id, reacted: false },
  })
  if (!outcome.ok) {
    logger.info('inbound un-react refused by the chat module', {
      eventId: event.event_id,
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    })
    return { kind: 'skipped', reason: 'not-permitted' }
  }

  // The annotation is gone, so its mapping must go with it — a later re-react
  // has to be able to claim the same subject key afresh.
  deps.em.remove(target)
  await deps.em.flush()
  await recordProjectedEvent(deps, scope, room, event)
  return { kind: 'projected', messageId: reaction.messageId }
}

/**
 * An edit made in a Matrix client.
 *
 * The new text comes from `m.new_content`, never from `body` — that one holds
 * the `* corrected text` fallback for clients that do not understand edits, and
 * projecting it would put a literal asterisk in front of every edited message.
 */
async function projectReplacement(
  deps: ProjectionDeps,
  event: MatrixEvent,
  roomId: string,
): Promise<ProjectionOutcome> {
  /**
   * Our own edit, echoed back with no mapping of its own.
   *
   * `publishEdit` records nothing — the mapping belongs to the message, not to
   * each revision of it — so unlike a reaction this cannot be recognised by the
   * `already-known` gate. Re-applying it would be harmless in effect and wrong
   * in principle: it would rewrite the row from an event rather than from the
   * person, and it would do it after every restart that re-reads the stream.
   */
  if (event.content['om.origin'] === 'operis') {
    return { kind: 'skipped', reason: 'operis-orphan' }
  }

  const edit = replacement(event)
  if (!edit) return { kind: 'skipped', reason: 'not-a-message' }

  const resolved = await resolveTarget(deps, event, roomId)
  if (!resolved.ok) return resolved.outcome
  const { room, senderUserId, scope } = resolved

  const target = await deps.em.findOne(ChatMatrixEvent, { eventId: edit.targetEventId })
  if (!target?.messageId) return { kind: 'skipped', reason: 'unmapped-target' }

  const outcome = await replay(deps, scope, senderUserId, 'chat.messages.edit', {
    conversationId: room.conversationId,
    messageId: target.messageId,
    body: edit.newBody,
    externalOrigin: { eventId: event.event_id },
  })
  if (!outcome.ok) {
    // The commonest refusal here is the right one: somebody who is not the
    // author edited the message in Element, and Operis does not allow that.
    logger.info('inbound edit refused by the chat module', {
      eventId: event.event_id,
      messageId: target.messageId,
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    })
    return { kind: 'skipped', reason: 'not-permitted' }
  }

  await recordProjectedEvent(deps, scope, room, event)
  return { kind: 'projected', messageId: target.messageId }
}

/**
 * A runtime context for a message nobody is logged in to send.
 *
 * `auth.sub` is the sender resolved from the event's own `sender` field, which
 * only the appservice can mint inside its exclusive namespace — so authorship is
 * still decided by the server from a trusted signal, exactly as it is on the
 * HTTP path. It is emphatically NOT taken from anything a client supplied.
 */
function projectionContext(
  deps: ProjectionDeps,
  scope: { tenantId: string; organizationId: string },
  senderUserId: string,
): CommandRuntimeContext {
  return {
    container: deps.container,
    auth: {
      sub: senderUserId,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

/**
 * A read receipt that arrived from a Matrix client.
 *
 * Its use is one case and it is a real one: an Operis colleague reading the
 * conversation in Element should not still see it unread in Operis. So the
 * receipt is resolved to the message it points at and replayed through
 * `chat.conversations.markRead`, whose UPDATE is clamped and monotonic — which
 * is what makes a redelivered receipt free rather than harmful.
 *
 * **Typing is deliberately NOT read back.** Every Operis user's keystrokes are
 * already announced directly by `chat.conversations.setTyping`, so projecting
 * them would duplicate an SSE frame the recipients already have; and a typist
 * who is not an Operis identity cannot be attributed to anybody until the
 * external-participant model exists. Requesting `m.typing` on the filter would
 * therefore buy nothing and cost a poll per keystroke in every joined room.
 */
export async function projectReceipts(
  deps: ProjectionDeps,
  raw: unknown,
  roomId: string,
): Promise<number> {
  const receipts = parseReadReceipts(raw)
  if (receipts.length === 0) return 0

  const room = await deps.em.findOne(ChatMatrixRoom, { roomId })
  if (!room) return 0
  const scope: ChatScope = { tenantId: room.tenantId, organizationId: room.organizationId }

  let applied = 0
  for (const receipt of receipts) {
    const readerUserId = operisUserIdFromMxid(deps.config, receipt.userId)
    if (!readerUserId) continue

    const target = await deps.em.findOne(ChatMatrixEvent, { eventId: receipt.eventId })
    if (!target?.messageId) continue

    /**
     * The homeserver's own timestamp for the receipt, when it gave one.
     *
     * `markRead` clamps to the database clock anyway, so a client with a fast
     * clock cannot use this to suppress its own unread count — and falling back
     * to "now" for a receipt with no `ts` is the same thing the reader would
     * have got by opening the conversation in Operis instead.
     */
    const readAt = receipt.ts ? new Date(receipt.ts).toISOString() : undefined

    const outcome = await replay(deps, scope, readerUserId, 'chat.conversations.markRead', {
      conversationId: room.conversationId,
      readAt,
      externalOrigin: { eventId: receipt.eventId },
    })
    if (outcome.ok) applied += 1
  }
  return applied
}
