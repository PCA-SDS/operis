import { randomUUID } from 'node:crypto'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  deriveRelatedTransactionId,
  deriveTransactionId,
  MatrixClient,
  MatrixError,
  type MatrixConfig,
} from '@open-mercato/matrix'
import type {
  ChatTransport,
  ChatTransportContext,
  ChatTransportMode,
  EnsureConversationInput,
  PublishDeletionInput,
  PublishedMessage,
  PublishEditInput,
  PublishMessageInput,
  PublishReactionInput,
  PublishReadReceiptInput,
  PublishTypingInput,
  RecordPublicationInput,
} from '@open-mercato/core/modules/chat/lib/transport'
import type { ChatScope } from '@open-mercato/core/modules/chat/lib/scope'
import { ChatMatrixEvent, ChatMatrixRoom } from '../data/entities'
import { ensureIdentity } from './identities'
import {
  attachmentSubjectKey,
  editSubjectKey,
  reactionSubjectKey,
  redactionSubjectKey,
} from './subjectKey'
import { loadAttachmentBytes, matrixMsgtypeFor } from './media'
import { resolveChatAttachmentLimits } from '@open-mercato/core/modules/chat/lib/attachmentPolicy'
import { ensureRoom, redactAsRoomMember, sendAsRoomMember, type RoomDeps } from './rooms'

const logger = createLogger('chat_matrix').child({ component: 'transport' })

/**
 * How long the homeserver keeps someone marked as typing without a refresh.
 *
 * Long enough that a normal pause between words does not clear it, short enough
 * that a client which crashes mid-sentence stops looking like it is still
 * typing a few seconds later.
 */
const TYPING_TIMEOUT_MS = 8_000

/**
 * The shadow writer.
 *
 * Postgres remains the source of truth. Every message that has already been
 * committed to `chat_messages` is published to the homeserver as well, and the
 * correspondence is recorded in `chat_matrix_events` so drift can be measured
 * rather than assumed. Nothing reads from Matrix yet.
 *
 * That ordering is the whole safety argument for this phase: if the homeserver
 * is down, wrong, or slow, the only consequence is a message that exists in
 * Operis and not in Matrix — which the drift check finds and the backfill
 * repairs. No user-visible behaviour depends on any of it.
 */
export function createMatrixChatTransport(
  config: MatrixConfig,
  mode: ChatTransportMode = 'shadow',
): ChatTransport {
  const client = new MatrixClient(config)

  const deps = (ctx: ChatTransportContext): RoomDeps => ({ em: ctx.em, client, config })

  return {
    id: 'matrix',
    mode,

    async ensureConversation(ctx, scope: ChatScope, input: EnsureConversationInput) {
      await ensureRoom(deps(ctx), scope, {
        conversationId: input.conversationId,
        kind: input.kind,
        title: input.title,
        memberUserIds: input.memberUserIds,
        ownerUserIds: input.ownerUserIds,
      })
    },

    async publishMessage(
      ctx,
      scope: ChatScope,
      input: PublishMessageInput,
    ): Promise<PublishedMessage> {
      // Already published? Then say so and stop.
      //
      // The Matrix transaction id would make a republish harmless at the
      // homeserver — it returns the original event rather than posting a second
      // copy — but only after a network round trip, and the mapping insert that
      // followed would then be rejected by `chat_matrix_events_event_uq`. Both
      // are wasted work on a path the backfill walks in bulk. Checking first
      // makes the transport idempotent in its own right, and leaves the
      // constraint as the backstop for a genuine concurrent publish.
      const alreadyPublished = await ctx.em.findOne(ChatMatrixEvent, {
        messageId: input.messageId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (alreadyPublished) {
        logger.debug('message already published; returning the recorded event', {
          messageId: input.messageId,
          eventId: alreadyPublished.eventId,
        })
        return { externalId: alreadyPublished.eventId }
      }

      const room = await ctx.em.findOne(ChatMatrixRoom, {
        conversationId: input.conversationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      // `ensureConversation` runs first and raises anything that went wrong, so
      // reaching here without a ready room means provisioning failed and was
      // swallowed upstream. Publishing into a half-built room would put the
      // message somewhere half the conversation cannot read.
      if (!room || room.state !== 'ready') {
        throw new Error(
          `[internal] no ready Matrix room for conversation ${input.conversationId} (state: ${room?.state ?? 'absent'})`,
        )
      }

      const senderMxid = await ensureIdentity(
        { em: ctx.em, client, config },
        scope.tenantId,
        input.senderUserId,
        input.senderName,
      )

      const content: Record<string, unknown> = {
        msgtype: 'm.text',
        /**
         * A marker saying "Operis sent this".
         *
         * In authoritative mode the publish happens BEFORE the database
         * transaction, so a commit that fails leaves this event orphaned in the
         * room with no mapping row. The projector would then see an unmapped
         * message and faithfully turn it into a chat message — while the user,
         * having been shown an error, has already retried and produced another.
         * The marker is how the projector tells "somebody else wrote this" from
         * "this is our own failed attempt", which it must not resurrect.
         *
         * A custom key, not `msgtype`, so ordinary Matrix clients render the
         * message normally and ignore it.
         */
        'om.origin': 'operis',
        // Sent verbatim, mention tokens included.
        //
        // The body carries `<@uuid>` markers the composer wrote, and rendering
        // them to display names here would need chat's member loader — a
        // cross-module code dependency the architecture does not allow. Nobody
        // reads this room but an engineer in Element while the transport is a
        // shadow. It becomes a real problem in the phase where a bridge relays
        // the room outward, and is solved there by carrying resolved names
        // through the transport payload, as `senderName` already is.
        body: input.body,
      }

      const replyToEventId = input.replyToMessageId
        ? await resolveEventId(ctx, scope, input.replyToMessageId)
        : null
      if (replyToEventId) {
        content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyToEventId } }
      }

      const sent = await sendAsRoomMember(deps(ctx), scope.tenantId, {
        roomId: room.roomId,
        eventType: 'm.room.message',
        // Derived from the Operis message id, so a retried publish returns the
        // original event instead of posting a second copy.
        transactionId: deriveTransactionId(input.messageId),
        content,
        userId: input.senderUserId,
        asUser: senderMxid,
      })

      /**
       * The files, each as its own event — best-effort, in both modes.
       *
       * Matrix models a file as a message of its own, so a message carrying two
       * pictures is three events in the room. They go after the text so a client
       * renders them in the order the composer staged them.
       *
       * Never fatal, even in authoritative mode, and the asymmetry with the text
       * message is the same one edits and reactions have: a send that Matrix
       * refuses must not commit, because a row would then exist for a message
       * the stream never carried. A file has no such hole — it lives in Operis'
       * own store whichever system owns the stream — so a failed copy leaves the
       * room missing a picture rather than Operis missing a message.
       */
      try {
        await publishAttachments(ctx, scope, input, room.roomId, senderMxid, client)
      } catch (error) {
        logger.error('failed to copy attachments into the room', {
          conversationId: input.conversationId,
          messageId: input.messageId,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      // Recording is deliberately NOT done here. In authoritative mode this runs
      // before the message row exists, so there is nothing to correlate yet;
      // the caller records inside the transaction that creates it.
      return { externalId: sent.event_id }
    },

    async publishReaction(ctx, scope: ChatScope, input: PublishReactionInput) {
      const room = await ctx.em.findOne(ChatMatrixRoom, {
        conversationId: input.conversationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (!room || room.state !== 'ready') {
        // Nothing to mirror into. Not worth failing a toggle over — the message
        // this reacts to is not in the room either.
        logger.debug('skipping reaction mirror: no ready room', {
          conversationId: input.conversationId,
        })
        return
      }

      const key = reactionSubjectKey(input)
      const existing = await ctx.em.findOne(ChatMatrixEvent, {
        subjectKey: key,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      if (!input.added) {
        // Taking it back. Redact the annotation the addition produced; without
        // the mapping there is nothing to redact, which is the correct outcome
        // for a reaction that never made it out.
        if (!existing) {
          logger.debug('no mirrored reaction to redact', { subjectKey: key })
          return
        }
        const reactorMxid = await ensureIdentity(
          { em: ctx.em, client, config },
          scope.tenantId,
          input.userId,
        )
        await client.redact({
          roomId: room.roomId,
          eventId: existing.eventId,
          transactionId: deriveRelatedTransactionId(existing.eventId, 'unreact'),
          asUser: reactorMxid,
        })
        ctx.em.remove(existing)
        await ctx.em.flush()
        return
      }

      // Already mirrored — a second add is a no-op rather than a second
      // annotation, which the homeserver would happily accept and then show
      // twice.
      if (existing) return

      const target = await ctx.em.findOne(ChatMatrixEvent, {
        messageId: input.messageId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (!target) {
        // The message predates the transport, or its publish failed. Reacting to
        // an event the room does not have is not possible; the backfill will
        // bring the message across, and the reaction can be re-applied then.
        logger.debug('skipping reaction mirror: target message is unmapped', {
          messageId: input.messageId,
        })
        return
      }

      const reactorMxid = await ensureIdentity(
        { em: ctx.em, client, config },
        scope.tenantId,
        input.userId,
      )

      const sent = await client.sendEvent({
        roomId: room.roomId,
        eventType: 'm.reaction',
        /**
         * Random, unlike a message's — and that is deliberate.
         *
         * Deriving it from the reaction tuple looked right and is actively
         * wrong: the tuple does not change when a reaction is taken back and
         * re-applied, so the second `m.reaction` would carry the transaction id
         * of the first and the homeserver would hand back the **redacted**
         * event. Re-reacting became a permanent no-op. Found by the end-to-end
         * check against a real homeserver.
         *
         * Idempotency for a reaction lives in the database instead — the
         * `chat_matrix_events_subject_uq` mapping, checked above — which is a
         * stronger guard than a transaction id anyway because it survives the
         * process restarting.
         */
        transactionId: deriveRelatedTransactionId(`${key}:${randomUUID()}`, 'reaction'),
        content: {
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: target.eventId,
            key: input.emoji,
          },
        },
        asUser: reactorMxid,
      })

      await recordEvent(ctx, scope, {
        // Null: a reaction is not a message, and the drift check counts messages.
        messageId: null,
        subjectKey: key,
        conversationId: input.conversationId,
        roomId: room.roomId,
        eventId: sent.event_id,
        eventType: 'm.reaction',
        originServerTs: new Date(),
      })
    },

    async publishEdit(ctx, scope: ChatScope, input: PublishEditInput) {
      const target = await requireMirroredMessage(ctx, scope, input)
      if (!target) return

      const editorMxid = await ensureIdentity(
        { em: ctx.em, client, config },
        scope.tenantId,
        input.senderUserId,
        input.senderName,
      )

      const sentEdit = await sendAsRoomMember(deps(ctx), scope.tenantId, {
        roomId: target.roomId,
        eventType: 'm.room.message',
        /**
         * Keyed on the message AND the moment it was rewritten, not on the
         * message alone.
         *
         * This is the reaction bug in a different costume. A transaction id
         * derived from `messageId` would be identical for a second edit of the
         * same message, so the homeserver would hand back the FIRST edit's event
         * and the second edit would silently never appear — a permanent no-op
         * that looks like a success. `editedAt` changes with every edit and is
         * stable across a retry of the same one, which is exactly the property a
         * transaction id needs.
         */
        transactionId: deriveRelatedTransactionId(
          `${input.messageId}:${input.editedAt.toISOString()}`,
          'edit',
        ),
        content: {
          msgtype: 'm.text',
          'om.origin': 'operis',
          // The asterisk is the convention for clients that do not understand
          // `m.replace`: they show the edit as a new message reading
          // "* corrected text" rather than dropping it. Clients that do
          // understand it render `m.new_content` in place and ignore this.
          body: `* ${input.body}`,
          'm.new_content': { msgtype: 'm.text', body: input.body },
          'm.relates_to': { rel_type: 'm.replace', event_id: target.eventId },
        },
        userId: input.senderUserId,
        asUser: editorMxid,
      })

      // So the reader recognises our own edit coming back, instead of applying
      // it a second time from the event.
      await recordEvent(ctx, scope, {
        messageId: null,
        subjectKey: editSubjectKey(input.messageId, input.editedAt),
        conversationId: input.conversationId,
        roomId: target.roomId,
        eventId: sentEdit.event_id,
        eventType: 'm.room.message',
        originServerTs: new Date(),
      })
    },

    async publishDeletion(ctx, scope: ChatScope, input: PublishDeletionInput) {
      const target = await requireMirroredMessage(ctx, scope, input)
      if (!target) return

      const actorMxid = await ensureIdentity(
        { em: ctx.em, client, config },
        scope.tenantId,
        input.actorUserId,
        input.actorName,
      )

      const sentRedaction = await redactAsRoomMember(deps(ctx), scope.tenantId, {
        roomId: target.roomId,
        eventId: target.eventId,
        // A message is deleted once — `deleted_at` is set and never unset — so
        // the event id alone identifies this redaction for all time, and a
        // retry after a timeout redacts nothing twice.
        transactionId: deriveRelatedTransactionId(target.eventId, 'redact'),
        userId: input.actorUserId,
        asUser: actorMxid,
      })

      // The mapping row stays. It is what a reconciliation would use to check
      // that the redaction really landed, and deleting it would leave the
      // backfill treating the message as never published — which, for a
      // soft-deleted message, it would then correctly skip, losing the trail.

      // The redaction gets a mapping of its own, so the reader recognises it as
      // ours. A redaction carries no content and so cannot be marked
      // `om.origin` the way a message is; this is the only way to tell.
      await recordEvent(ctx, scope, {
        messageId: null,
        subjectKey: redactionSubjectKey(input.messageId),
        conversationId: input.conversationId,
        roomId: target.roomId,
        eventId: sentRedaction.event_id,
        eventType: 'm.room.redaction',
        originServerTs: new Date(),
      })
    },

    /**
     * `m.typing` — a room-level ephemeral, not an event.
     *
     * The homeserver holds it for `timeoutMs` and then forgets, which is why
     * the stop signal is a courtesy rather than a requirement: a client that
     * closes its laptop mid-sentence stops typing on its own. The call is
     * marked non-retryable at the client for the same reason — a typing
     * notification that arrives late is worse than one that never arrives.
     */
    async publishTyping(ctx, scope: ChatScope, input: PublishTypingInput) {
      const room = await ctx.em.findOne(ChatMatrixRoom, {
        conversationId: input.conversationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (!room || room.state !== 'ready') return

      const mxid = await ensureIdentity({ em: ctx.em, client, config }, scope.tenantId, input.userId)
      await client.setTyping(room.roomId, mxid, input.typing, TYPING_TIMEOUT_MS)
    },

    /**
     * `m.read` — the public receipt, which is the point of sending it.
     *
     * `m.read.private` exists for advancing your own marker without telling the
     * room; Operis already has `last_read_at` for that, so the only reason to
     * reach the homeserver at all is to let everyone else see it.
     */
    async publishReadReceipt(ctx, scope: ChatScope, input: PublishReadReceiptInput) {
      const room = await ctx.em.findOne(ChatMatrixRoom, {
        conversationId: input.conversationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (!room || room.state !== 'ready') return

      const target = await ctx.em.findOne(ChatMatrixEvent, {
        messageId: input.messageId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      // A message that predates the transport has no event to point at. The
      // next read of a mirrored message carries the marker forward.
      if (!target) return

      const mxid = await ensureIdentity({ em: ctx.em, client, config }, scope.tenantId, input.userId)
      await client.sendReceipt(room.roomId, target.eventId, mxid)
    },

    async recordPublication(ctx, scope: ChatScope, input: RecordPublicationInput) {
      const room = await ctx.em.findOne(ChatMatrixRoom, {
        conversationId: input.conversationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      await recordEvent(ctx, scope, {
        messageId: input.messageId,
        conversationId: input.conversationId,
        roomId: room?.roomId ?? '',
        eventId: input.externalId,
        eventType: 'm.room.message',
        originServerTs: input.createdAt,
      })
    },
  }
}

/**
 * The room and event a message was mirrored to, or `null` when it was not.
 *
 * Both the edit and the deletion paths need exactly this pair, and both must
 * degrade quietly rather than throw: a message that predates the transport, or
 * whose publish failed, has nothing in the room to amend. Neither is a reason to
 * fail an operation that has already been applied to the Operis tables.
 */
async function requireMirroredMessage(
  ctx: ChatTransportContext,
  scope: ChatScope,
  input: { conversationId: string; messageId: string },
): Promise<{ roomId: string; eventId: string } | null> {
  const room = await ctx.em.findOne(ChatMatrixRoom, {
    conversationId: input.conversationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!room || room.state !== 'ready') {
    logger.debug('skipping mirror: no ready room', { conversationId: input.conversationId })
    return null
  }

  const mapped = await ctx.em.findOne(ChatMatrixEvent, {
    messageId: input.messageId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!mapped) {
    logger.debug('skipping mirror: message is unmapped', { messageId: input.messageId })
    return null
  }

  return { roomId: room.roomId, eventId: mapped.eventId }
}

async function resolveEventId(
  ctx: ChatTransportContext,
  scope: ChatScope,
  messageId: string,
): Promise<string | null> {
  const mapped = await ctx.em.findOne(ChatMatrixEvent, {
    messageId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!mapped) {
    // The parent was sent before the transport was switched on, or its publish
    // failed. The reply still goes out — as a plain message rather than a
    // threaded one. Losing the reply because its parent is unmapped would be a
    // worse outcome than losing the threading.
    logger.debug('reply target has no Matrix event; sending unthreaded', { messageId })
    return null
  }
  return mapped.eventId
}

type RecordEventInput = {
  messageId: string | null
  subjectKey?: string | null
  conversationId: string
  roomId: string
  eventId: string
  eventType: string
  originServerTs: Date
}

/**
 * Record the correspondence between an Operis row and a Matrix event.
 *
 * `projected_at` is set immediately: in the shadow phase the Operis row already
 * exists — it is what was published *from* — so there is nothing left to project.
 * It stays null only for events that arrive from the homeserver first, which is
 * the phase after this one.
 */
/**
 * Copy each of a message's attachments into the media repo and announce it.
 *
 * Idempotent on `chat_matrix_events.subject_key`: a retried publish finds the
 * copy it already made and neither re-uploads the bytes nor puts a second
 * `m.image` in the room. That matters more here than anywhere else in the
 * transport — re-uploading is the one operation whose cost is measured in
 * megabytes rather than milliseconds.
 */
async function publishAttachments(
  ctx: ChatTransportContext,
  scope: ChatScope,
  input: PublishMessageInput,
  roomId: string,
  senderMxid: string,
  client: MatrixClient,
): Promise<void> {
  if (input.attachmentIds.length === 0) return

  const limits = resolveChatAttachmentLimits()
  const files = await loadAttachmentBytes({
    em: ctx.em,
    container: ctx.container,
    scope,
    attachmentIds: input.attachmentIds,
    maxBytes: limits.maxBytes,
  })

  for (const file of files) {
    const subjectKey = attachmentSubjectKey(file.id)
    const existing = await ctx.em.findOne(ChatMatrixEvent, {
      subjectKey,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (existing) continue

    const uploaded = await client.uploadMedia({
      body: file.buffer,
      contentType: file.mimeType,
      fileName: file.fileName,
      asUser: senderMxid,
    })

    const sent = await client.sendEvent({
      roomId,
      eventType: 'm.room.message',
      // Keyed on the message AND the file, so a message with two attachments
      // does not send the second under the first one's transaction id — which
      // the homeserver would answer by handing back the first file's event.
      transactionId: deriveRelatedTransactionId(`${input.messageId}:${file.id}`, 'attachment'),
      content: {
        msgtype: matrixMsgtypeFor(file.mimeType),
        'om.origin': 'operis',
        // The filename is the body by Matrix convention: it is what a client
        // that cannot render the file shows, and what a screen reader reads.
        body: file.fileName,
        filename: file.fileName,
        url: uploaded.content_uri,
        info: { mimetype: file.mimeType, size: file.size },
      },
      asUser: senderMxid,
    })

    await recordEvent(ctx, scope, {
      // Null: an attachment is not a message, and the drift check counts
      // messages. The subject key is what makes it findable again.
      messageId: null,
      subjectKey,
      conversationId: input.conversationId,
      roomId,
      eventId: sent.event_id,
      eventType: 'm.room.message',
      originServerTs: new Date(),
    })
  }
}

async function recordEvent(
  ctx: ChatTransportContext,
  scope: ChatScope,
  input: RecordEventInput,
): Promise<void> {
  const now = new Date()
  ctx.em.persist(
    ctx.em.create(ChatMatrixEvent, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      messageId: input.messageId,
      subjectKey: input.subjectKey ?? null,
      conversationId: input.conversationId,
      roomId: input.roomId,
      eventId: input.eventId,
      eventType: input.eventType,
      originServerTs: input.originServerTs,
      projectedAt: now,
      createdAt: now,
    }),
  )
  try {
    await ctx.em.flush()
  } catch (error) {
    // The homeserver already has the message; only the bookkeeping raced. A
    // unique violation here means a concurrent publish of the same message won,
    // and its row says the same thing ours would have.
    if (!isUniqueViolation(error)) throw error
    logger.debug('event mapping already recorded by a concurrent publish', {
      eventId: input.eventId,
      messageId: input.messageId,
    })
  }
}
