import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  badRequest,
  forbidden,
  isUniqueViolation,
  notFound,
} from '@open-mercato/shared/lib/crud/errors'
import {
  ChatConversation,
  ChatMessage,
  ChatMessageLink,
  ChatMessageMention,
  ChatParticipant,
  ChatPinnedMessage,
} from '../data/entities'
import type { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import type { ChatAttachmentDto, ChatMessageDto, ChatReplyTargetDto } from '../data/types'
import { buildMessagePreview } from '../lib/conversations'
import { extractMentionedUserIds, mentionsEveryone } from '../lib/mentions'
import { extractLinks } from '../lib/links'
import { resolveReplyTarget } from '../lib/replies'
import { loadChatMessages } from '../lib/messages'
import { dbNow } from '../lib/clock'
import { buildSearchDocument } from '../lib/searchText'
import { ChatAttachmentError, linkDraftAttachmentsToMessage } from '../lib/attachments'
import { checkAttachmentCounts } from '../lib/attachmentPolicy'
import { toChatAttachmentDto } from '../lib/attachmentDto'
import { getAttachmentsForMessages } from '../lib/attachments'
import { loadOrganizationMember, loadOrganizationMembers, type ChatScope } from '../lib/scope'
import {
  actingUserId,
  chatTransportFrom,
  conversationAudience,
  emitConversationEvent,
  ensureOrganizationScope,
  ensureTenantScope,
  forkEm,
  requireMessageInConversation,
} from './shared'
import {
  publishDeletionSafely,
  publishEditSafely,
  publishMessageSafely,
} from '../lib/transport'

export type SendChatMessageInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  body: string
  clientMessageId?: string
  replyToMessageId?: string
  /** Drafts to carry on this message; validated against the server's own rows. */
  attachmentIds?: string[]
  /**
   * Set only by the transport's projector, never by an HTTP caller.
   *
   * Marks a message that already exists in the messaging system and is being
   * replayed into Operis. It suppresses the publish — the event is the reason
   * this call is happening — and pins the id and timestamp to the ones the
   * event already carries, so the projection is a faithful copy rather than a
   * new message that happens to look similar.
   *
   * Routing it through this command rather than writing rows directly is what
   * keeps mention validation, attachment linking, the search document and the
   * conversation preview applied by the code that owns them. There is still one
   * send path.
   */
  externalOrigin?: {
    eventId: string
    messageId: string
    createdAt: Date
  }
}

export type SendChatMessageResult = {
  message: ChatMessageDto
  deduplicated: boolean
}

function toDto(
  message: ChatMessage,
  replyTo: ChatReplyTargetDto | null,
  senderName: string,
  mentionNames: Record<string, string> = {},
  attachments: ChatAttachmentDto[] = [],
): ChatMessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderUserId: message.senderUserId,
    senderName,
    kind: message.kind,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    // A message cannot have been edited before it exists. A resend that
    // deduplicates onto an edited message reports the truth, hence the read.
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    clientMessageId: message.clientMessageId ?? null,
    replyTo,
    systemEvent: message.systemEvent ?? null,
    systemTargetUserId: message.systemTargetUserId ?? null,
    // A send is always a user message, so there is never a membership target to
    // name here.
    systemTargetName: null,
    // A message cannot be reacted to or pinned before it exists, so the sender's
    // optimistic copy starts empty and picks the rest up on the next read.
    reactions: [],
    mentionNames,
    mentionsEveryone: message.mentionsEveryone,
    pinned: false,
    attachments,
  }
}

async function findByClientId(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  clientMessageId: string,
): Promise<ChatMessage | null> {
  return em.findOne(ChatMessage, {
    conversationId,
    clientMessageId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
}

/**
 * Append a message to a conversation the caller is part of.
 *
 * Three things this is careful about:
 *
 * - **Authorship** comes from the session, never the payload.
 * - **Idempotency**: a `clientMessageId` is checked before the write and again
 *   after a unique violation, so a composer that retries a timed-out request
 *   gets the message it already sent rather than posting it twice.
 * - **Membership is re-checked on every send.** A conversation the caller was
 *   part of yesterday is not authorization for today — if they have since left
 *   the organization, the participant row is still there but the membership
 *   check is not satisfied.
 */
const sendChatMessageCommand: CommandHandler<SendChatMessageInput, SendChatMessageResult> = {
  id: 'chat.messages.send',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const senderUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    const sender = await loadOrganizationMember(em, scope, senderUserId)
    if (!sender) throw badRequest(messages.notOrganizationMember)

    const participant = await em.findOne(ChatParticipant, {
      conversationId: input.conversationId,
      userId: senderUserId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!participant) throw notFound(messages.conversationNotFound)

    const conversation = await em.findOne(ChatConversation, {
      id: input.conversationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!conversation) throw notFound(messages.conversationNotFound)

    if (input.clientMessageId) {
      const existing = await findByClientId(em, scope, conversation.id, input.clientMessageId)
      if (existing) {
        return {
          message: toDto(
            existing,
            await resolveReplyTarget(em, scope, existing),
            sender.name,
            {},
            // Read back rather than assumed: a retry may carry no attachment
            // ids at all, and the answer has to describe the message that
            // exists, not the request that asked about it.
            (await getAttachmentsForMessages({ em, scope, messageIds: [existing.id] })
              .then((byMessage) => byMessage.get(existing.id) ?? [])).map(toChatAttachmentDto),
          ),
          deduplicated: true,
        }
      }
    }

    // The reply target must be a live message in THIS conversation. The composite
    // foreign key would refuse a cross-conversation id anyway, but a 23503 is a
    // 500 to the caller — checking here turns a forged or stale id into the 404
    // it actually is, and catches the soft-deleted case the constraint cannot see.
    if (input.replyToMessageId) {
      const target = await em.findOne(ChatMessage, {
        id: input.replyToMessageId,
        conversationId: conversation.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!target) throw notFound(messages.replyTargetNotFound)
    }

    /**
     * Mentions are validated against the conversation, never trusted from the
     * client.
     *
     * The body arrives carrying `<@id>` tokens the composer wrote. Each one must
     * name somebody who is actually in this conversation: a forged id belonging
     * to another space, another organization, or nobody at all is refused rather
     * than stored — otherwise the mention table would become a way to make a
     * stranger's client fetch a conversation, and `@everyone` a way to reach
     * outside the room.
     *
     * `@everyone` is refused in a direct conversation, where it would mean the
     * one person already reading it.
     */
    const participantIds = await conversationAudience(em, scope, conversation.id)
    const mentionedUserIds = extractMentionedUserIds(input.body)
    const everyone = mentionsEveryone(input.body)

    if (everyone && conversation.kind !== 'space') throw badRequest(messages.everyoneNotAllowed)
    if (mentionedUserIds.length > 0) {
      const inConversation = new Set(participantIds)
      const outsiders = mentionedUserIds.filter((userId) => !inConversation.has(userId))
      if (outsiders.length > 0) throw badRequest(messages.mentionNotAllowed)
      // And they must still be active people, not stale participant rows.
      const mentioned = await loadOrganizationMembers(em, scope, mentionedUserIds)
      if (mentioned.size !== mentionedUserIds.length) throw badRequest(messages.mentionNotAllowed)
    }

    // Re-check the OTHER side too, not just the sender.
    //
    // A participant row outlives the membership that created it, so a colleague
    // who has left the organization still looks like a valid recipient.
    //
    // What happens next depends on the kind, because the same fact means
    // different things:
    //
    // - In a DIRECT conversation the departed person is the only counterpart, so
    //   the conversation has quietly become one-way. Refusing is what stops
    //   someone typing sensitive material into it.
    // - In a SPACE they are one of many. Refusing would let a single departed
    //   colleague silently break the space for everyone still in it, which is a
    //   far worse failure than not delivering to someone who cannot sign in
    //   anyway. They are dropped from the audience instead.
    //
    // One batched lookup either way, never one per recipient.
    const counterpartIds = participantIds.filter((userId) => userId !== senderUserId)
    const counterparts = await loadOrganizationMembers(em, scope, counterpartIds)
    if (conversation.kind === 'direct' && counterparts.size !== counterpartIds.length) {
      throw notFound(messages.recipientNotFound)
    }
    const recipients = [senderUserId, ...counterpartIds.filter((userId) => counterparts.has(userId))]

    const transport = chatTransportFrom(ctx)

    /**
     * The message id is allocated here rather than by the database.
     *
     * When the messaging system is authoritative the message must be published
     * before the row exists — the homeserver accepting it is what earns the
     * right to record it — and the publish has to name the message. Allocating
     * up front means both sides use one id in both modes.
     */
    const messageId = input.externalOrigin?.messageId ?? randomUUID()

    /**
     * Publish first, when the messaging system owns the stream.
     *
     * Deliberately NOT wrapped in `publishMessageSafely`: in this mode a failed
     * publish must fail the send. Committing a row for a message the homeserver
     * never accepted is exactly the split-brain this ordering exists to prevent,
     * and the caller would have no idea their message is invisible to every
     * other client of the stream.
     *
     * The cost is real and is the point of the flag: chat now depends on the
     * homeserver being reachable.
     */
    let publishedEventId: string | null = null
    let preCommitNow: Date | null = null
    if (transport.mode === 'authoritative' && !input.externalOrigin) {
      preCommitNow = await dbNow(em)
      const publishEm = forkEm(ctx)
      await transport.ensureConversation({ em: publishEm }, scope, {
        conversationId: conversation.id,
        kind: conversation.kind,
        title: conversation.title ?? null,
        memberUserIds: recipients,
        ownerUserIds: [],
      })
      const published = await transport.publishMessage({ em: publishEm }, scope, {
        conversationId: conversation.id,
        conversationKind: conversation.kind,
        messageId,
        senderUserId,
        senderName: sender.name,
        body: input.body,
        createdAt: preCommitNow,
        replyToMessageId: input.replyToMessageId ?? null,
        clientMessageId: input.clientMessageId ?? null,
        attachmentIds: input.attachmentIds ?? [],
        recipientUserIds: recipients,
      })
      publishedEventId = published.externalId
    }

    /**
     * An event that arrived from the messaging system instead of from a person.
     *
     * The projector replays it through this same command so every invariant —
     * mention validation, attachment linking, the search document, the
     * conversation preview — is applied exactly once, by the code that owns
     * them. There is still only one send path.
     */
    const externalEventId = input.externalOrigin?.eventId ?? publishedEventId

    let stored: { message: ChatMessage; attachments: Attachment[] }
    try {
      // The message and the conversation's denormalized "latest" columns move
      // together; a preview that disagrees with the transcript is worse than no
      // preview at all.
      stored = await em.transactional(async (tx) => {
        // The database's clock, not this instance's. Every chat timestamp is
        // compared against one written by some other process, so a local
        // `new Date()` would make each instance's wall clock the authority.
        // Inside the transaction this is the transaction start time, so the
        // message and the conversation's denormalized copy share one instant.
        // Reuse the instant the publish already used, so the event and the row
        // it maps to carry the same timestamp rather than two a network round
        // trip apart.
        const now = preCommitNow ?? input.externalOrigin?.createdAt ?? (await dbNow(tx))

        // Read first, then write, then flush once: a query issued after a
        // pending change on the same EntityManager can discard it.
        //
        // Re-read under the full scope rather than by bare id: the row was
        // validated outside the transaction, and re-checking here is what stops
        // a conversation deleted in between from having its preview updated.
        const target = await tx.findOne(ChatConversation, {
          id: conversation.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        })
        // The message and the conversation's "latest" columns are one unit. If
        // the conversation went away, abort rather than committing a message
        // into a conversation whose preview can never mention it.
        if (!target) throw notFound(messages.conversationNotFound)

        const message = tx.create(ChatMessage, {
          id: messageId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          conversationId: conversation.id,
          senderUserId,
          body: input.body,
          // Written in the same transaction as the body, so a message is
          // searchable the moment it is visible. Deriving it later would leave
          // a window in which a message exists and cannot be found — short,
          // but exactly when someone is looking for what was just said.
          searchBody: buildSearchDocument(input.body),
          clientMessageId: input.clientMessageId ?? null,
          replyToMessageId: input.replyToMessageId ?? null,
          mentionsEveryone: everyone,
          createdAt: now,
          updatedAt: now,
        })
        tx.persist(message)

        // The mention rows land in the same transaction as the message, so a
        // half-written send can never leave a message that names nobody or a
        // mention pointing at nothing.
        await tx.flush()
        for (const mentionedUserId of mentionedUserIds) {
          tx.persist(
            tx.create(ChatMessageMention, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              messageId: message.id,
              conversationId: conversation.id,
              mentionedUserId,
              createdAt: now,
            }),
          )
        }

        // Inside the same transaction as the message. An attachment that
        // failed a check throws here, so the message never commits — there is
        // no state where a message exists with its files still parked as
        // drafts, and no half-attached message for anyone to see.
        let attachments: Awaited<ReturnType<typeof linkDraftAttachmentsToMessage>>
        try {
          attachments = await linkDraftAttachmentsToMessage({
            em: tx,
            scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
            uploaderUserId: senderUserId,
            conversationId: conversation.id,
            messageId: message.id,
            attachmentIds: input.attachmentIds ?? [],
          })
        } catch (error) {
          if (!(error instanceof ChatAttachmentError)) throw error
          // Translated at the boundary rather than inside the linker: the
          // linker's job is to decide, and a decision phrased for a person is
          // a different concern from the rule that produced it.
          throw badRequest(
            error.code === 'rejected'
              ? messages.attachmentRejected
              : error.code === 'not_ready'
                ? messages.attachmentNotReady
                : messages.attachmentNotAvailable,
          )
        }

        // Counted from the rows rather than from what the client sent, because
        // the true media/file split is the stored MIME type and nothing else.
        const counts = checkAttachmentCounts(attachments.map((one) => one.mimeType))
        if (!counts.ok) {
          throw badRequest(
            counts.reason === 'too_many_media'
              ? messages.tooManyMediaAttachments
              : messages.tooManyFileAttachments,
          )
        }

        // Indexed in the same transaction as the message, exactly as mentions
        // are: a half-written send can never leave a link pointing at a message
        // that does not exist, or a message whose links were never recorded.
        for (const link of extractLinks(input.body)) {
          tx.persist(
            tx.create(ChatMessageLink, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              messageId: message.id,
              conversationId: conversation.id,
              url: link.url,
              host: link.host,
              createdAt: now,
            }),
          )
        }

        target.lastMessageAt = now
        target.lastMessagePreview = buildMessagePreview(input.body)
        target.lastMessageSenderUserId = senderUserId
        // `updatedAt` is deliberately not set here: its `onUpdate` hook fires
        // unconditionally on flush and would overwrite anything assigned. That
        // is fine — `updated_at` is audit metadata and is never compared across
        // rows, unlike `last_message_at` above, which orders the list and so
        // must come from the shared clock.

        // Inside the transaction on purpose: the message row and the record of
        // which external event it is must commit together. A crash between them
        // leaves a message the projector cannot recognise as already handled,
        // and it re-projects a duplicate.
        if (externalEventId) {
          await transport.recordPublication({ em: tx }, scope, {
            conversationId: conversation.id,
            messageId,
            externalId: externalEventId,
            createdAt: now,
          })
        }

        await tx.flush()
        return { message, attachments }
      })
    } catch (error) {
      // A retry that raced its own first attempt: the idempotency index rejected
      // the duplicate, so return the message that won.
      if (isUniqueViolation(error) && input.clientMessageId) {
        const retryEm = forkEm(ctx)
        const existing = await findByClientId(retryEm, scope, conversation.id, input.clientMessageId)
        if (existing) {
          return {
            message: toDto(
              existing,
              await resolveReplyTarget(retryEm, scope, existing),
              sender.name,
              {},
              (await getAttachmentsForMessages({ em: retryEm, scope, messageIds: [existing.id] })
                .then((byMessage) => byMessage.get(existing.id) ?? [])).map(toChatAttachmentDto),
            ),
            deduplicated: true,
          }
        }
      }
      throw error
    }

    // Shadow mode: publish AFTER the commit, and never let it fail the send.
    //
    // Postgres is the source of truth here, so the message is already durable,
    // already searchable and already on its way to the recipients. A transport
    // failure leaves Matrix behind, which the drift check finds and the backfill
    // repairs — a far better outcome than failing a send that succeeded.
    //
    // With the default `local` transport this is three no-ops. In authoritative
    // mode the publish already happened, before the transaction.
    if (transport.mode === 'shadow' && !input.externalOrigin) {
      // A fresh fork: the send transaction has committed, and its manager is a
      // closed unit of work.
      const transportEm = forkEm(ctx)
      await transport.ensureConversation({ em: transportEm }, scope, {
        conversationId: conversation.id,
        kind: conversation.kind,
        title: conversation.title ?? null,
        memberUserIds: recipients,
        ownerUserIds: [],
      })
      const published = await publishMessageSafely(transport, { em: transportEm }, scope, {
        conversationId: conversation.id,
        conversationKind: conversation.kind,
        messageId: stored.message.id,
        senderUserId,
        senderName: sender.name,
        body: input.body,
        createdAt: stored.message.createdAt,
        replyToMessageId: input.replyToMessageId ?? null,
        clientMessageId: input.clientMessageId ?? null,
        attachmentIds: stored.attachments.map((attachment) => attachment.id),
        recipientUserIds: recipients,
      })
      if (published.externalId) {
        await transport.recordPublication({ em: transportEm }, scope, {
          conversationId: conversation.id,
          messageId: stored.message.id,
          externalId: published.externalId,
          createdAt: stored.message.createdAt,
        })
      }
    }

    // Body deliberately absent: the bridge caps frames at 4KB and clients
    // refetch over the authorized route. `recipients` is what keeps this private
    // — the SSE endpoint drops the frame for everyone else.
    await emitConversationEvent('chat.message.sent', scope, recipients, {
      conversationId: conversation.id,
      messageId: stored.message.id,
      senderUserId,
      createdAt: stored.message.createdAt.toISOString(),
      // Enough for a client to know a file is coming without putting anything
      // fetchable in the frame (§82). The bytes are still reached only through
      // the authorized route.
      attachmentCount: stored.attachments.length,
    })

    const mentionNames: Record<string, string> = {}
    if (mentionedUserIds.length > 0) {
      const mentioned = await loadOrganizationMembers(em, scope, mentionedUserIds)
      for (const userId of mentionedUserIds) {
        mentionNames[userId] = mentioned.get(userId)?.name ?? ''
      }
    }

    return {
      message: toDto(
        stored.message,
        await resolveReplyTarget(em, scope, stored.message),
        sender.name,
        mentionNames,
        stored.attachments.map(toChatAttachmentDto),
      ),
      deduplicated: false,
    }
  },
}

registerCommand(sendChatMessageCommand)

export type EditChatMessageInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  messageId: string
  body: string
}

export type EditChatMessageResult = {
  messageId: string
  body: string
  editedAt: string
}

export type DeleteChatMessageInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  messageId: string
}

export type DeleteChatMessageResult = {
  messageId: string
  deletedAt: string
}

/**
 * The newest message still visible in a conversation, or null when none is.
 *
 * Both edit and delete need this to answer one question: does the conversation
 * list still say the right thing? The ordering is the transcript's own
 * (`created_at desc, id desc`), because the row the list previews must be the
 * row a reader sees at the bottom of the conversation — two different orderings
 * would let the two disagree about which message is last.
 *
 * System rows are included. They set the preview when they are written, so
 * excluding them here would make a delete promote a user message that is not
 * actually the latest thing in the conversation.
 */
async function latestVisibleMessage(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
): Promise<ChatMessage | null> {
  return em.findOne(
    ChatMessage,
    {
      conversationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'desc', id: 'desc' } },
  )
}

/**
 * Point the conversation's denormalized "latest" columns at whatever is now
 * newest, or back at its own creation when nothing is left.
 *
 * `lastMessageAt` is rolled back with the rest rather than left alone. It orders
 * the conversation list, and a conversation whose newest visible message is from
 * last week must not keep sitting at the top claiming activity from a minute
 * ago — the list would be advertising a message the reader cannot find.
 */
function repointConversation(conversation: ChatConversation, latest: ChatMessage | null): void {
  if (!latest) {
    conversation.lastMessageAt = conversation.createdAt
    conversation.lastMessagePreview = null
    conversation.lastMessageSenderUserId = null
    return
  }
  conversation.lastMessageAt = latest.createdAt
  conversation.lastMessagePreview = buildMessagePreview(latest.body)
  conversation.lastMessageSenderUserId = latest.senderUserId
}

/**
 * Rewrite the body of a message you wrote.
 *
 * Authorship is the whole permission model here, and deliberately narrower than
 * deletion: a space owner may remove somebody's message as moderation, but
 * nobody may put words in another person's mouth. Not even an owner, and not in
 * a direct conversation either.
 *
 * An edit is not a small update. Four things are derived from a body and all
 * four are rebuilt in the same transaction, because a message whose text says
 * one thing while its search document, its mentions and its links still describe
 * the previous version is worse than one that was never edited:
 *
 * - `search_body`, or the message stays findable by words it no longer contains;
 * - `chat_message_mentions` and `mentions_everyone`, re-validated against the
 *   conversation exactly as a send validates them — otherwise editing would be
 *   the way to mention somebody a send refuses;
 * - `chat_message_links`, so the Shared panel stops listing a URL that has been
 *   taken out and starts listing one that has been put in;
 * - the conversation preview, when this is the message the list is showing.
 *
 * Attachments are deliberately untouched: they are separate rows with their own
 * scan lifecycle, and the validator refuses an empty body precisely so an edit
 * cannot strand them on a message with nothing left to read.
 *
 * The translation cache needs no invalidation. Its rows are keyed by a hash of
 * the source text, so an edited message simply misses and is translated afresh.
 */
const editChatMessageCommand: CommandHandler<EditChatMessageInput, EditChatMessageResult> = {
  id: 'chat.messages.edit',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const editorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    // The same membership re-check every send makes: a participant row outlives
    // the organization membership that created it, so someone who has left must
    // not still be able to rewrite what they said.
    const editor = await loadOrganizationMember(em, scope, editorUserId)
    if (!editor) throw badRequest(messages.notOrganizationMember)

    const { conversation, message } = await requireMessageInConversation(
      em,
      scope,
      input.conversationId,
      input.messageId,
      editorUserId,
    )

    if (message.kind !== 'user') throw badRequest(messages.systemMessageNotEditable)
    if (message.senderUserId !== editorUserId) throw forbidden(messages.notEditPermitted)

    // Mentions are re-validated against the conversation as they are on a send,
    // and for the same reason: a body is client input whichever verb delivered
    // it. Skipping the check here would make editing the way to mention a
    // stranger, address `@everyone` in a direct conversation, or point a
    // mention row at somebody who has since left.
    const participantIds = await conversationAudience(em, scope, conversation.id)
    const mentionedUserIds = extractMentionedUserIds(input.body)
    const everyone = mentionsEveryone(input.body)

    if (everyone && conversation.kind !== 'space') throw badRequest(messages.everyoneNotAllowed)
    if (mentionedUserIds.length > 0) {
      const inConversation = new Set(participantIds)
      const outsiders = mentionedUserIds.filter((userId) => !inConversation.has(userId))
      if (outsiders.length > 0) throw badRequest(messages.mentionNotAllowed)
      const mentioned = await loadOrganizationMembers(em, scope, mentionedUserIds)
      if (mentioned.size !== mentionedUserIds.length) throw badRequest(messages.mentionNotAllowed)
    }

    const editedAt = await em.transactional(async (tx) => {
      const now = await dbNow(tx)

      // Re-read under the full scope inside the transaction, exactly as the send
      // path does: everything above was checked outside it, and a message
      // deleted in between must not be quietly resurrected with new text.
      const target = await tx.findOne(ChatMessage, {
        id: message.id,
        conversationId: conversation.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!target) throw notFound(messages.messageNotFound)

      const wasLatest = (await latestVisibleMessage(tx, scope, conversation.id))?.id === target.id
      const previewTarget = wasLatest
        ? await tx.findOne(ChatConversation, {
            id: conversation.id,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            deletedAt: null,
          })
        : null

      // Derived rows are replaced wholesale rather than diffed. The set is at
      // most a handful of rows, and a diff would have to be right about three
      // things — added, removed, unchanged — to save one statement.
      await tx.nativeDelete(ChatMessageMention, {
        messageId: target.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      await tx.nativeDelete(ChatMessageLink, {
        messageId: target.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      target.body = input.body
      target.searchBody = buildSearchDocument(input.body)
      target.mentionsEveryone = everyone
      target.editedAt = now

      for (const mentionedUserId of mentionedUserIds) {
        tx.persist(
          tx.create(ChatMessageMention, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            messageId: target.id,
            conversationId: conversation.id,
            mentionedUserId,
            // When the mention row was written, which is this edit rather than
            // the message's own creation.
            //
            // It does NOT make an old message ping somebody newly named in it:
            // the unread predicate anchors on `chat_messages.created_at`, so a
            // message the reader has already passed stays read. That is a
            // property of the unread model, not of this column — see the spec's
            // "Known limitation".
            createdAt: now,
          }),
        )
      }

      for (const link of extractLinks(input.body)) {
        tx.persist(
          tx.create(ChatMessageLink, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            messageId: target.id,
            conversationId: conversation.id,
            url: link.url,
            host: link.host,
            createdAt: now,
          }),
        )
      }

      if (previewTarget) {
        // Only the text. An edit does not change when the message was written,
        // so it must not reorder the conversation list.
        previewTarget.lastMessagePreview = buildMessagePreview(input.body)
      }

      await tx.flush()
      return now
    })

    // Mirrored after the commit and never fatally, in both modes. The row
    // already carries the new body, so a homeserver that refuses this leaves the
    // room showing older words — not Operis showing wrong ones.
    await publishEditSafely(chatTransportFrom(ctx), { em: forkEm(ctx) }, scope, {
      conversationId: conversation.id,
      messageId: message.id,
      senderUserId: editorUserId,
      senderName: editor.name,
      body: input.body,
      editedAt,
    })

    // No body in the frame, exactly as a send carries none: clients are told
    // which message changed and refetch it over the authorized route.
    await emitConversationEvent('chat.message.edited', scope, participantIds, {
      conversationId: conversation.id,
      messageId: message.id,
      editedAt: editedAt.toISOString(),
    })

    return { messageId: message.id, body: input.body, editedAt: editedAt.toISOString() }
  },
}

/**
 * Take a message out of the conversation.
 *
 * A soft delete, not a row removal. Everything anchored to a message id —
 * replies quoting it, reactions, attachments, its translations — would either
 * break or have to cascade, and a reply whose parent was hard-deleted loses the
 * context that made it make sense. `deleted_at` is what every read path in the
 * module already filters on, so setting it is the whole removal: the transcript
 * skips it, search skips it, the unread mention predicate skips it, the Shared
 * panel's join drops its links, and `lib/replies.ts` renders a quote of it as
 * "Original message unavailable" rather than as nothing.
 *
 * The permission is wider than editing on purpose. Rewriting somebody's words is
 * never acceptable; removing them is moderation, and a space already has owners
 * who decide what the shared conversation looks like — the same people who may
 * pin, rename and remove members. A direct conversation has no owner, so there
 * only the author may delete.
 *
 * Two pieces of bookkeeping the soft delete cannot do by itself: pins pointing
 * at the message are removed (the pinned panel already hides a deleted message,
 * but the conversation's pin COUNT is a plain count and would go on including
 * it), and the conversation's preview is repointed when the deleted message was
 * the one the list is showing.
 */
const deleteChatMessageCommand: CommandHandler<DeleteChatMessageInput, DeleteChatMessageResult> = {
  id: 'chat.messages.delete',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    const actor = await loadOrganizationMember(em, scope, actorUserId)
    if (!actor) throw badRequest(messages.notOrganizationMember)

    // `includeDeleted`, because deleting something already deleted must converge
    // rather than report a failure for the state the caller asked for. The
    // permission check below still runs on it: converging is not the same as
    // letting anyone press delete on anything.
    const { conversation, participant, message } = await requireMessageInConversation(
      em,
      scope,
      input.conversationId,
      input.messageId,
      actorUserId,
      { includeDeleted: true },
    )

    if (message.kind !== 'user') throw badRequest(messages.systemMessageNotEditable)
    const isAuthor = message.senderUserId === actorUserId
    const isSpaceOwner = conversation.kind === 'space' && participant.role === 'owner'
    if (!isAuthor && !isSpaceOwner) throw forbidden(messages.notDeletePermitted)

    // Already gone before we even opened a transaction — the common shape of a
    // second delete, rather than the narrow race the transaction below also
    // handles. Answered from the row we already have.
    if (message.deletedAt) {
      return { messageId: message.id, deletedAt: message.deletedAt.toISOString() }
    }

    const outcome = await em.transactional(async (tx) => {
      const now = await dbNow(tx)

      const target = await tx.findOne(ChatMessage, {
        id: message.id,
        conversationId: conversation.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      // Deleted in the window between the guard above and this transaction —
      // the genuine race, narrow but real when a space owner and the author
      // press delete at the same instant. Converging is the same choice
      // unpinning makes: the caller asked for it to be gone, and it is.
      if (!target) return { deletedAt: now, changed: false }

      const wasLatest = (await latestVisibleMessage(tx, scope, conversation.id))?.id === target.id
      const previewTarget = wasLatest
        ? await tx.findOne(ChatConversation, {
            id: conversation.id,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            deletedAt: null,
          })
        : null

      await tx.nativeDelete(ChatPinnedMessage, {
        messageId: target.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      target.deletedAt = now

      if (previewTarget) {
        // Flushed first so the row this reads is the deleted one. Without it
        // `latestVisibleMessage` would hand back the message being deleted and
        // the preview would keep pointing at text nobody can see.
        await tx.flush()
        repointConversation(
          previewTarget,
          await latestVisibleMessage(tx, scope, conversation.id),
        )
      }

      await tx.flush()
      return { deletedAt: now, changed: true }
    })

    // A message already deleted needs no second mirror and no second event; the
    // deletion that won did both.
    if (!outcome.changed) {
      return { messageId: message.id, deletedAt: outcome.deletedAt.toISOString() }
    }

    await publishDeletionSafely(chatTransportFrom(ctx), { em: forkEm(ctx) }, scope, {
      conversationId: conversation.id,
      messageId: message.id,
      actorUserId,
      actorName: actor.name,
    })

    const recipients = await conversationAudience(forkEm(ctx), scope, conversation.id)
    await emitConversationEvent('chat.message.deleted', scope, recipients, {
      conversationId: conversation.id,
      messageId: message.id,
    })

    return { messageId: message.id, deletedAt: outcome.deletedAt.toISOString() }
  },
}

registerCommand(editChatMessageCommand)
registerCommand(deleteChatMessageCommand)
