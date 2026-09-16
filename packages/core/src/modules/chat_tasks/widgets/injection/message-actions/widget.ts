import type {
  InjectionRowActionWidget,
  InjectionRowActionDefinition,
} from '@open-mercato/shared/modules/widgets/injection'
import { publishChatTaskIntent } from '../../../components/overlayBridge'

/**
 * "Create task" in one message's overflow menu.
 *
 * The row chat hands over is the message the menu was opened on — which is the whole
 * reason this is a row action. The body travels no further than the composer's own
 * memory: it is shown for review behind an explicit opt-in and is never sent to the
 * server unless the writer asks for it. What IS sent is the message id, which the
 * server validates against this conversation before recording it.
 */

type MessageRow = {
  conversationId?: string
  messageId?: string
  senderName?: string
  mine?: boolean
}

function messageRow(row: unknown): MessageRow {
  return row && typeof row === 'object' ? (row as MessageRow) : {}
}

const actions: InjectionRowActionDefinition[] = [
  {
    id: 'chat_tasks.message.create-task',
    label: 'Create task',
    icon: 'check-square',
    onSelect: (row) => {
      const message = messageRow(row)
      if (!message.conversationId || !message.messageId) return
      publishChatTaskIntent({
        kind: 'create',
        conversationId: message.conversationId,
        // Empty: a task raised from a message starts blank, and nothing from the
        // message is copied into any field by default.
        argument: '',
        source: {
          messageId: message.messageId,
          authorName: message.senderName ?? '',
          // Read from the transcript the caller is already looking at. Held in memory
          // for the review box, never persisted unless they opt in.
          body: readBody(row),
        },
      })
    },
  },
]

/**
 * The message text, taken from the row chat passed rather than refetched.
 *
 * The caller is already reading it — it is on their screen — so a second authorized
 * read would prove nothing new. The server re-checks the message's membership,
 * conversation and liveness at submission, which is the check that matters.
 */
function readBody(row: unknown): string {
  if (!row || typeof row !== 'object') return ''
  const value = (row as { body?: unknown }).body
  return typeof value === 'string' ? value : ''
}

const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'chat_tasks.injection.message-actions',
    title: 'Create a task from a message',
    // Creating is the only thing this offers, so it is hidden outright from a viewer
    // who cannot create tasks rather than shown and then refused.
    features: ['chat.send', 'tasks.create'],
    requiredModules: ['chat', 'tasks'],
    priority: 100,
  },
  rowActions: actions,
}

export default widget
