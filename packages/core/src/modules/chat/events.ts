import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Chat events are `clientBroadcast: true` so the DOM Event Bridge carries them
 * to open browsers — that is what makes a message land in the other person's
 * window without a poll.
 *
 * Every emit MUST pass trusted `{ tenantId, organizationId }` in `EmitOptions`
 * and a `recipientUserIds` array in the payload. The SSE endpoint reads trusted
 * scope from the options (ignoring any payload tenant/org) and the recipient
 * list from the payload, then drops the frame for every connection that is not
 * one of those users — before the write. Omit `recipientUserIds` and a private
 * message becomes an organization-wide broadcast.
 *
 * `chat.conversation.updated` covers renames and membership changes. Its
 * recipient list is the current members PLUS anyone just removed — the removed
 * client needs the nudge to refetch, get a 404 from the membership check, and
 * drop the space without waiting for a refresh. It is the last frame they
 * receive: every later emit recomputes the audience from the participant rows
 * they are no longer in.
 *
 * The payload is a pointer, never the content: the bridge truncates anything
 * over 4KB into an unusable stub and the cross-process bridge caps at 7KB, so
 * clients are told *that* something changed and refetch it over the authorized
 * REST route.
 */
const events = [
  {
    id: 'chat.conversation.created',
    label: 'Chat Conversation Created',
    entity: 'conversation',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'chat.message.sent',
    label: 'Chat Message Sent',
    entity: 'message',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'chat.conversation.updated',
    label: 'Chat Conversation Updated',
    entity: 'conversation',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'chat.message.reacted',
    label: 'Chat Message Reacted',
    entity: 'message',
    category: 'crud',
    clientBroadcast: true,
    // Reacting is not something another module should hang a workflow off.
    excludeFromTriggers: true,
  },
  {
    id: 'chat.conversation.pinned',
    label: 'Chat Conversation Pin Changed',
    entity: 'conversation',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'chat.conversation.read',
    label: 'Chat Conversation Read',
    entity: 'conversation',
    category: 'lifecycle',
    clientBroadcast: true,
    // Reading is per-person bookkeeping, not something another module should be
    // able to hang a workflow off.
    excludeFromTriggers: true,
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'chat', events })

export const emitChatEvent = eventsConfig.emit

export type ChatEventId = (typeof events)[number]['id']

export default eventsConfig
