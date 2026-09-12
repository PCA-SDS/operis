import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  isRedacted,
  isReplacement,
  isRoomMessage,
  messageBody,
  operisUserIdFromMxid,
  replyTarget,
  type MatrixConfig,
  type MatrixEvent,
} from '@open-mercato/matrix'
import { ChatMatrixEvent, ChatMatrixRoom } from '../data/entities'

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
}

export type ProjectionOutcome =
  | { kind: 'projected'; messageId: string }
  | { kind: 'skipped'; reason: ProjectionSkipReason }

export type ProjectionSkipReason =
  | 'already-known'
  | 'not-a-message'
  | 'redacted'
  | 'edit'
  | 'unmapped-room'
  | 'external-sender'
  | 'empty-body'
  | 'operis-orphan'

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

  if (!isRoomMessage(event)) return { kind: 'skipped', reason: 'not-a-message' }
  if (isRedacted(event)) return { kind: 'skipped', reason: 'redacted' }

  /**
   * An edit of an existing message, not a new one.
   *
   * `m.replace` arrives as an ordinary `m.room.message` whose fallback body
   * reads `* corrected text`, so without this check every edit — Operis' own,
   * an engineer's in Element, a bridge's later — becomes a duplicate message in
   * the transcript carrying an asterisk.
   *
   * Skipped rather than applied: applying an inbound edit means deciding who is
   * allowed to rewrite whose words from a Matrix identity, and Operis' answer
   * ("only the author") has no meaning for a sender the chat schema cannot
   * model. Ahead of the orphan check below so an Operis edit is reported as what
   * it is instead of as a send that failed to commit.
   */
  if (isReplacement(event)) return { kind: 'skipped', reason: 'edit' }

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

  const result = await deps.commandBus.execute<
    Record<string, unknown>,
    { message: { id: string }; deduplicated: boolean }
  >('chat.messages.send', {
    input: {
      ...scope,
      conversationId: room.conversationId,
      body,
      replyToMessageId,
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
