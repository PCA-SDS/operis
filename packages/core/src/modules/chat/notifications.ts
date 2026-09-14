import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * Two types, and the split between them is the whole notification policy.
 *
 * A direct message is addressed to one person, so it notifies. A space message
 * is addressed to a room, and notifying everyone in it on every message is
 * exactly the noise the read-cursor unread model exists to avoid — so a space
 * notifies only the people it **names**. That is what Slack and Teams do, and
 * it is the reason a busy channel is usable at all.
 *
 * They are separate types rather than one with a variable, because the point of
 * separating them is that a person can turn one off and keep the other. A single
 * `chat.message.received` would make "stop telling me about every mention" and
 * "stop telling me about direct messages" the same switch.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'chat.direct.received',
    module: 'chat',
    titleKey: 'chat.notifications.direct.title',
    bodyKey: 'chat.notifications.direct.body',
    labelKey: 'chat.notifications.direct.label',
    descriptionKey: 'chat.notifications.direct.description',
    icon: 'message-circle',
    severity: 'info',
    category: 'chat',
    actions: [
      {
        id: 'open',
        labelKey: 'chat.notifications.open',
        variant: 'outline',
        href: '/backend/chat/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/chat/{sourceEntityId}',
    /**
     * A week. A chat notification is about being told promptly, and one still
     * sitting in the bell a month later is telling you about a conversation you
     * have long since read — the unread count is the durable record, not this.
     */
    expiresAfterHours: 168,
  },
  {
    type: 'chat.mention.received',
    module: 'chat',
    titleKey: 'chat.notifications.mention.title',
    bodyKey: 'chat.notifications.mention.body',
    labelKey: 'chat.notifications.mention.label',
    descriptionKey: 'chat.notifications.mention.description',
    icon: 'at-sign',
    severity: 'info',
    category: 'chat',
    actions: [
      {
        id: 'open',
        labelKey: 'chat.notifications.open',
        variant: 'outline',
        href: '/backend/chat/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/chat/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
