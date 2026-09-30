import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import type { ChatConversation } from '../data/entities'
import { notificationTypes } from '../notifications'
import { loadChatMessages } from './messages'
import { loadExternalConversationSummaries } from './people'
import { loadOrganizationMember, type ChatScope } from './scope'

const logger = createLogger('chat').child({ component: 'assignment' })

/**
 * Tell colleagues they were just put into a client conversation — handed it
 * over, or asked to help. One notification per person per conversation,
 * replaced rather than stacked.
 *
 * Failure is logged and swallowed: they are already in the conversation, and
 * its unread count will tell them as soon as the customer writes.
 */
export async function notifyAssigned(
  container: unknown,
  scope: ChatScope,
  input: {
    conversation: Pick<ChatConversation, 'id' | 'title'>
    assignedUserIds: readonly string[]
    actorUserId: string | null
  },
): Promise<void> {
  const typeDef = notificationTypes.find((type) => type.type === 'chat.external.assigned')
  if (!typeDef || input.assignedUserIds.length === 0) return
  const resolver = container as { resolve: (name: string) => unknown }
  try {
    const em = (resolver.resolve('em') as EntityManager).fork()
    const messages = await loadChatMessages()
    const summaries = await loadExternalConversationSummaries(
      em,
      scope,
      [{ id: input.conversation.id, title: input.conversation.title ?? null }],
      messages.unknownContact,
    )
    const conversationName = summaries.get(input.conversation.id)?.title ?? messages.unknownContact
    const actor = input.actorUserId ? await loadOrganizationMember(em, scope, input.actorUserId) : null
    const service = resolveNotificationService(resolver)
    for (const recipientUserId of input.assignedUserIds) {
      if (recipientUserId === input.actorUserId) continue
      await service.create(
        buildNotificationFromType(typeDef, {
          recipientUserId,
          bodyVariables: { conversation: conversationName, actor: actor?.name ?? conversationName },
          sourceEntityType: 'chat:chat_conversation',
          sourceEntityId: input.conversation.id,
          linkHref: `/backend/chat/${input.conversation.id}`,
          groupKey: `chat.external.assigned:${input.conversation.id}:${recipientUserId}`,
        }),
        scope,
      )
    }
  } catch (error) {
    logger.warn('could not notify colleagues added to a client conversation', {
      conversationId: input.conversation.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
