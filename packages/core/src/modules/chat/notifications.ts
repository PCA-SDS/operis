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
 *
 * A third type for external conversations, for the same reason: somebody outside
 * the organization writing in is a message waiting on a colleague's answer —
 * every colleague in the conversation is told — and it is worth being able to
 * silence separately from colleagues' direct messages. A colleague's reply there
 * notifies nobody: mentions are refused in external conversations, and telling
 * the other handlers about every reply is the noise the unread count covers.
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
  {
    type: 'chat.external.received',
    module: 'chat',
    titleKey: 'chat.notifications.external.title',
    bodyKey: 'chat.notifications.external.body',
    labelKey: 'chat.notifications.external.label',
    descriptionKey: 'chat.notifications.external.description',
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
    expiresAfterHours: 168,
  },
  {
    /**
     * Someone put you into a client chat — handed it over, or asked you to
     * help. Addressed to one person, like a direct message, so it notifies.
     */
    type: 'chat.external.assigned',
    module: 'chat',
    titleKey: 'chat.notifications.assigned.title',
    bodyKey: 'chat.notifications.assigned.body',
    labelKey: 'chat.notifications.assigned.label',
    descriptionKey: 'chat.notifications.assigned.description',
    icon: 'user-plus',
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
  {
    /**
     * A connected account dropped — the phone was offline too long or the link
     * was removed on the phone. Nothing arrives until someone reconnects, so the
     * people who can are told, once per drop.
     */
    type: 'chat.account.disconnected',
    module: 'chat',
    titleKey: 'chat.notifications.accountDisconnected.title',
    bodyKey: 'chat.notifications.accountDisconnected.body',
    labelKey: 'chat.notifications.accountDisconnected.label',
    descriptionKey: 'chat.notifications.accountDisconnected.description',
    icon: 'unplug',
    severity: 'warning',
    category: 'chat',
    actions: [
      {
        id: 'reconnect',
        labelKey: 'chat.notifications.accountDisconnected.reconnect',
        variant: 'outline',
        href: '/backend/chat/accounts',
        icon: 'plug',
      },
    ],
    linkHref: '/backend/chat/accounts',
    expiresAfterHours: 336,
  },
]

export default notificationTypes
