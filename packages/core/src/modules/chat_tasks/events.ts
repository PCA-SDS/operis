import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Two events, both recipient-scoped, both pointers.
 *
 * They exist because a card has to refresh on everyone's screen when a task
 * changes, and the task module's own events cannot do that job: `tasks.*` is
 * broadcast to the whole organization, and attaching a conversation id or a
 * message id to one would put "these people are talking about this" on a feed
 * anyone with `tasks.view` receives. Even an identifier reveals a relationship.
 *
 * So the task module keeps its events exactly as they are, and this module emits
 * its own with an explicit `recipientUserIds` list computed from the
 * conversation's live participant rows — the same discipline chat uses. The
 * payload names the conversation and the link and nothing about the task, and the
 * client refetches over the authorized route, per viewer.
 */
const events = [
  {
    id: 'chat_tasks.link.created',
    label: 'Task Linked To Conversation',
    entity: 'link',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'chat_tasks.link.removed',
    label: 'Task Unlinked From Conversation',
    entity: 'link',
    category: 'crud',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'chat_tasks', events })

export const emitChatTasksEvent = eventsConfig.emit

export type ChatTasksEventId = (typeof events)[number]['id']

export default eventsConfig
