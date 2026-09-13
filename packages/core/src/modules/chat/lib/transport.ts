import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ChatScope } from './scope'

/**
 * Where a chat message goes, besides the database.
 *
 * The chat module owns its tables and always will: search, the translation
 * cache, attachments, reactions, mentions, pins and the unread predicate are all
 * anchored to `chat_messages` rows, and several of those anchors are database
 * constraints rather than application checks. A transport does not replace any
 * of that — it publishes the same message to a messaging system alongside, so
 * that later a WhatsApp bridge can deliver into the same conversation without
 * chat learning anything about WhatsApp.
 *
 * The default is `local`, which does nothing at all. That is not a placeholder:
 * with no external messaging system there is nothing to publish to, and the
 * database write that already happened *is* the delivery.
 *
 * This is a delegate, not a second send path. `chat.messages.send` remains the
 * only way a message is created — see the chat module's AGENTS.md.
 */

const logger = createLogger('chat').child({ component: 'transport' })

export type ChatTransportId = 'local' | 'matrix'

/**
 * Who owns the message stream.
 *
 * - **`shadow`** — Postgres is the source of truth. The message is committed
 *   first and published afterwards, and a publish failure is logged rather than
 *   surfaced. Chat keeps working when the homeserver does not.
 * - **`authoritative`** — the messaging system is the source of truth. The
 *   message is published FIRST and only recorded once the homeserver has
 *   accepted it, so a row can never exist for a message Matrix does not have.
 *   A publish failure fails the send.
 *
 * The second is a real behaviour change and the point of the whole exercise:
 * chat now depends on the homeserver being reachable. It is a separate flag
 * from the transport itself precisely so the flip is one variable, and so
 * rolling back is flipping it rather than redeploying.
 */
export type ChatTransportMode = 'shadow' | 'authoritative'

/**
 * What the transport is told about a message that has already been committed.
 *
 * Deliberately a flat, primitive payload rather than the entity: a transport
 * must not be able to mutate chat state, and passing the ORM object would let it.
 */
export type PublishMessageInput = {
  conversationId: string
  conversationKind: 'direct' | 'space'
  messageId: string
  senderUserId: string
  /**
   * The sender's display name, carried through rather than looked up.
   *
   * A transport that needed names would otherwise have to import chat's member
   * loader, which is a cross-module code dependency the architecture does not
   * allow. Passing it through the interface keeps the coupling to data.
   */
  senderName: string
  body: string
  createdAt: Date
  replyToMessageId: string | null
  /** Present when the caller supplied one; the stable key for idempotent republish. */
  clientMessageId: string | null
  attachmentIds: string[]
  /** Everyone entitled to see the message — a transport must not widen this. */
  recipientUserIds: string[]
}

export type PublishedMessage = {
  /**
   * The external system's identifier for the message, or `null` when there is no
   * external system. Recorded by the caller so a republish can be recognised
   * rather than duplicated.
   */
  externalId: string | null
}

export type EnsureConversationInput = {
  conversationId: string
  kind: 'direct' | 'space'
  title: string | null
  memberUserIds: string[]
  ownerUserIds: string[]
}

/**
 * What a transport is given to do its work.
 *
 * The `EntityManager` is deliberately a fresh fork, not the one the send
 * transaction used: by the time a transport runs, that transaction has
 * committed, and reusing its manager would attach the transport's own writes to
 * a unit of work that is already closed.
 */
export type ChatTransportContext = {
  em: EntityManager
}

export interface ChatTransport {
  readonly id: ChatTransportId
  readonly mode: ChatTransportMode

  /**
   * Make the conversation exist in the external system, if it does not already.
   *
   * Called before the first publish for a conversation. Must be idempotent: it
   * runs again after a failure, and creating a second room for one conversation
   * is the failure it exists to prevent.
   */
  ensureConversation(
    ctx: ChatTransportContext,
    scope: ChatScope,
    input: EnsureConversationInput,
  ): Promise<void>

  /**
   * Hand the message to the messaging system.
   *
   * **Never inside the database transaction** — a network call there holds
   * locks for the duration of somebody else's outage. Which side of the
   * transaction it runs on depends on the mode: after it in `shadow`, before it
   * in `authoritative`, where the homeserver accepting the message is what
   * earns the right to record it.
   */
  publishMessage(
    ctx: ChatTransportContext,
    scope: ChatScope,
    input: PublishMessageInput,
  ): Promise<PublishedMessage>

  /**
   * Record that a message and an external event are the same thing.
   *
   * Split from {@link publishMessage} because the two happen at different
   * moments once the messaging system is authoritative: the publish comes
   * before the database transaction, and the record has to go **inside** it, so
   * the message row and its mapping commit together. Without that atomicity a
   * crash between them leaves a message the projector cannot recognise as
   * already-handled, and it re-projects a duplicate.
   *
   * Called with the transactional EntityManager in `authoritative` mode and a
   * plain fork in `shadow`.
   */
  recordPublication(
    ctx: ChatTransportContext,
    scope: ChatScope,
    input: RecordPublicationInput,
  ): Promise<void>

  /**
   * Mirror a reaction outward, or take it back.
   *
   * Called after the toggle has committed. Adding sends an `m.reaction`
   * annotation; removing redacts the event the addition produced, which is why
   * the mapping is keyed on a tuple that survives the Operis row being deleted.
   */
  publishReaction(
    ctx: ChatTransportContext,
    scope: ChatScope,
    input: PublishReactionInput,
  ): Promise<void>

  /**
   * Mirror a rewritten body outward.
   *
   * Called after the edit has committed, and best-effort in **both** modes —
   * unlike a send. The distinction is which system can lose something: a send
   * that Matrix refuses in authoritative mode must not be committed, because a
   * row would then exist for a message the stream has never carried. An edit has
   * no such hole. The body lives in `chat_messages` whichever system owns the
   * stream, the message is already published, and nothing inbound turns a
   * Matrix edit back into an Operis one — so a failed mirror leaves the room
   * showing older words, not Operis showing wrong ones.
   */
  publishEdit(
    ctx: ChatTransportContext,
    scope: ChatScope,
    input: PublishEditInput,
  ): Promise<void>

  /**
   * Take a message back out of the external system.
   *
   * Called after the soft delete has committed, and best-effort for the same
   * reason an edit is. The one asymmetry worth stating plainly: a failed mirror
   * here leaves the messaging system holding something Operis has deleted, which
   * is a retention question rather than a consistency one. The mapping row is
   * left in place so a later reconciliation can still find the event.
   */
  publishDeletion(
    ctx: ChatTransportContext,
    scope: ChatScope,
    input: PublishDeletionInput,
  ): Promise<void>
}

/**
 * A body that has already been rewritten in the Operis tables.
 *
 * The old text is deliberately absent: the row no longer holds it, and a
 * transport that received it would be the only place it still existed.
 */
export type PublishEditInput = {
  conversationId: string
  messageId: string
  /** The author. Only they may rewrite a body, so this is also the editor. */
  senderUserId: string
  senderName: string
  /** The new text, already normalised and validated. */
  body: string
  editedAt: Date
}

/**
 * A message that has already been soft-deleted in the Operis tables.
 *
 * `actorUserId` is not necessarily the author — a space owner may remove
 * somebody else's message — and it is the actor, not the author, whose identity
 * performs the removal in the external system, so the room records who did it.
 */
export type PublishDeletionInput = {
  conversationId: string
  messageId: string
  actorUserId: string
  actorName: string
}

/**
 * A reaction that has already been applied to the Operis tables.
 *
 * Mirroring is best-effort in **both** modes, unlike a message. Reactions live in
 * `chat_message_reactions` whichever system owns the message stream, so pushing
 * them outward is for the benefit of anything else reading the room — a native
 * client, or later a bridge — and never something a user's action depends on.
 */
export type PublishReactionInput = {
  conversationId: string
  messageId: string
  userId: string
  emoji: string
  /** `true` when it was just added, `false` when it was just removed. */
  added: boolean
}

export type RecordPublicationInput = {
  conversationId: string
  messageId: string
  externalId: string
  createdAt: Date
}

/**
 * The transport for a deployment with no external messaging system.
 *
 * Every method is a no-op, and that is the correct behaviour rather than a
 * stub: the message is already durable, already searchable and already on its
 * way to the recipients over SSE. There is nowhere else for it to go.
 */
export function createLocalChatTransport(): ChatTransport {
  return {
    id: 'local',
    // Postgres is the source of truth and always will be for this transport;
    // there is no external system for it to be authoritative over.
    mode: 'shadow',
    async ensureConversation() {
      // Nothing to provision. The conversation row is the conversation.
    },
    async publishMessage() {
      return { externalId: null }
    },
    async recordPublication() {
      // Nothing was published, so there is nothing to correlate.
    },
    async publishReaction() {
      // The reaction row is the reaction. There is nowhere else to mirror it to.
    },
    async publishEdit() {
      // The row already carries the new body. There is nowhere else to send it.
    },
    async publishDeletion() {
      // `deleted_at` is the deletion. Nothing else is holding a copy.
    },
  }
}

/**
 * Whether the messaging system owns the message stream.
 *
 * `shadow` unless `OM_CHAT_MATRIX_MODE` says otherwise, because the safe
 * default is the one where a homeserver outage cannot stop people talking. An
 * unrecognised value refuses to start rather than quietly choosing for the
 * operator — this flag decides whether a failed publish loses a message.
 */
export function resolveChatTransportMode(env: NodeJS.ProcessEnv = process.env): ChatTransportMode {
  const raw = (env.OM_CHAT_MATRIX_MODE ?? 'shadow').trim().toLowerCase()
  if (raw === 'shadow' || raw === 'authoritative') return raw
  throw new Error(
    `[internal] OM_CHAT_MATRIX_MODE is "${raw}", which is not a known chat transport mode. Use "shadow" or "authoritative".`,
  )
}

/**
 * Which transport a deployment runs.
 *
 * `local` unless `OM_CHAT_TRANSPORT` says otherwise. An unrecognised value is a
 * misconfiguration that must not silently fall back to a different messaging
 * topology than the operator asked for, so it refuses to start — the same
 * reasoning as the translation fake-provider guard in `di.ts`.
 */
export function resolveChatTransportId(env: NodeJS.ProcessEnv = process.env): ChatTransportId {
  const raw = (env.OM_CHAT_TRANSPORT ?? 'local').trim().toLowerCase()
  if (raw === 'local' || raw === 'matrix') return raw
  throw new Error(
    `[internal] OM_CHAT_TRANSPORT is "${raw}", which is not a known chat transport. Use "local" or "matrix".`,
  )
}

/**
 * A transport failure must never lose a message.
 *
 * By the time this runs the message is committed and the recipients have been
 * notified; the publish is a downstream copy. Throwing here would fail a send
 * that already succeeded, and the caller would retry a message the reader can
 * already see. The failure is logged and left for reconciliation instead.
 */
export async function publishMessageSafely(
  transport: ChatTransport,
  ctx: ChatTransportContext,
  scope: ChatScope,
  input: PublishMessageInput,
): Promise<PublishedMessage> {
  try {
    return await transport.publishMessage(ctx, scope, input)
  } catch (error) {
    logger.error('chat transport failed to publish a committed message', {
      transport: transport.id,
      conversationId: input.conversationId,
      messageId: input.messageId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { externalId: null }
  }
}

/**
 * A reaction that fails to mirror must not fail the toggle.
 *
 * The reaction is already committed and the readers already notified. Throwing
 * would report a failure for something the user can see worked, and would leave
 * the two systems disagreeing anyway. Logged and left instead.
 */
export async function publishReactionSafely(
  transport: ChatTransport,
  ctx: ChatTransportContext,
  scope: ChatScope,
  input: PublishReactionInput,
): Promise<void> {
  try {
    await transport.publishReaction(ctx, scope, input)
  } catch (error) {
    logger.error('chat transport failed to mirror a reaction', {
      transport: transport.id,
      conversationId: input.conversationId,
      messageId: input.messageId,
      added: input.added,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * An edit that fails to mirror must not fail the edit.
 *
 * The new body is already committed and the readers already notified. Throwing
 * would report a failure for a change the author can see worked, and would not
 * make the two systems agree — it would only add a second, identical edit the
 * next time they tried.
 */
export async function publishEditSafely(
  transport: ChatTransport,
  ctx: ChatTransportContext,
  scope: ChatScope,
  input: PublishEditInput,
): Promise<void> {
  try {
    await transport.publishEdit(ctx, scope, input)
  } catch (error) {
    logger.error('chat transport failed to mirror an edit', {
      transport: transport.id,
      conversationId: input.conversationId,
      messageId: input.messageId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * A deletion that fails to mirror must not fail the deletion.
 *
 * Refusing here would be the worse outcome in both directions: the message the
 * person wanted gone would stay visible in Operis, and it would still be in the
 * external system either way. Logged so an operator can see the room is holding
 * something Operis is not.
 */
export async function publishDeletionSafely(
  transport: ChatTransport,
  ctx: ChatTransportContext,
  scope: ChatScope,
  input: PublishDeletionInput,
): Promise<void> {
  try {
    await transport.publishDeletion(ctx, scope, input)
  } catch (error) {
    logger.error('chat transport failed to mirror a deletion', {
      transport: transport.id,
      conversationId: input.conversationId,
      messageId: input.messageId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
