import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ChatConversation, ChatParticipant } from '../data/entities'
import { loadChatMessages } from './messages'
import type { ChatScope } from './scope'

/**
 * The caller's standing in a conversation, resolved once and reused.
 *
 * Every space operation needs the same two rows — the conversation and the
 * caller's participant row — and needs them checked in the same order, so they
 * are loaded here rather than at each call site. Missing either one answers 404
 * rather than 403: telling a non-member that a space exists is exactly what an
 * id-guessing probe is looking for, and it is the rule phase 1 already follows
 * for direct conversations.
 */
export type SpaceContext = {
  conversation: ChatConversation
  participant: ChatParticipant
}

export async function loadSpaceContext(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  userId: string,
): Promise<SpaceContext> {
  const messages = await loadChatMessages()

  const participant = await em.findOne(ChatParticipant, {
    conversationId,
    userId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!participant) throw notFound(messages.conversationNotFound)

  const conversation = await em.findOne(ChatConversation, {
    id: conversationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!conversation) throw notFound(messages.conversationNotFound)

  return { conversation, participant }
}

/**
 * The same, but refusing a direct conversation.
 *
 * A direct has no name to change and no membership to manage, so pointing a
 * space route at one is a client bug rather than an authorization failure — and
 * the caller can already see the conversation, so saying so leaks nothing.
 */
export async function loadSpaceForMember(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  userId: string,
): Promise<SpaceContext> {
  const context = await loadSpaceContext(em, scope, conversationId, userId)
  if (context.conversation.kind !== 'space') {
    throw badRequest((await loadChatMessages()).notASpace)
  }
  return context
}

/** The same again, and the caller must be an owner. */
export async function loadSpaceForOwner(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  userId: string,
): Promise<SpaceContext> {
  const context = await loadSpaceForMember(em, scope, conversationId, userId)
  if (context.participant.role !== 'owner') {
    throw forbidden((await loadChatMessages()).notSpaceOwner)
  }
  return context
}

/**
 * How many owners a space has, counting rows rather than loading them.
 *
 * Asked on every leave and every demotion, and answered from
 * `chat_participants_owner_idx`.
 */
export async function countOwners(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
): Promise<number> {
  return em.count(ChatParticipant, {
    conversationId,
    role: 'owner',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

/**
 * The label a space carries when its members are all that name it.
 *
 * Never used for a stored title — a space always has one — but the conversation
 * list still needs something to render for a direct, and having one function
 * answer "what is this conversation called" keeps the fallback out of four
 * components.
 */
export function conversationTitle(
  conversation: Pick<ChatConversation, 'kind' | 'title'>,
  counterpartName: string | null,
  fallback: string,
): string {
  if (conversation.kind === 'space') return conversation.title ?? fallback
  return counterpartName ?? fallback
}
