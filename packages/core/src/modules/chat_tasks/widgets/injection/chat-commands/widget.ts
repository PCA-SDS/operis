import type {
  InjectionRowActionWidget,
  InjectionRowActionDefinition,
} from '@open-mercato/shared/modules/widgets/injection'
import { publishChatTaskIntent } from '../../../components/overlayBridge'

/**
 * The commands the chat composer offers when a line begins with `/`.
 *
 * Row actions rather than menu items because each one needs the conversation it was
 * invoked in, and `onSelect(row, context)` is the only injected shape that receives
 * one. Chat derives the typed name from the last segment of the id, so the writer
 * types `/task` while the module keeps its namespace.
 *
 * Every one of these only *opens* something. None of them writes: the composer and
 * the picker they raise do that, through endpoints that check the caller's grants
 * and their membership again. A command is an affordance, never an authorization.
 */

type CommandRow = { argument?: string }
type CommandContext = { conversationId?: string; onConsumed?: () => void }

function rowArgument(row: unknown): string {
  if (!row || typeof row !== 'object') return ''
  const value = (row as CommandRow).argument
  return typeof value === 'string' ? value : ''
}

function commandContext(context: unknown): CommandContext {
  return context && typeof context === 'object' ? (context as CommandContext) : {}
}

const actions: InjectionRowActionDefinition[] = [
  {
    // The last segment is what the writer types: `/task`.
    id: 'chat_tasks.command.task',
    label: 'Create task',
    icon: 'check-square',
    onSelect: (row, context) => {
      const { conversationId, onConsumed } = commandContext(context)
      if (!conversationId) return
      publishChatTaskIntent({
        kind: 'create',
        conversationId,
        // Passed through verbatim, so the tasks module's own quick-add grammar is
        // the only thing that interprets it.
        argument: rowArgument(row),
        source: null,
        onConsumed,
      })
    },
  },
  {
    id: 'chat_tasks.command.mytasks',
    label: 'My tasks',
    icon: 'user-check',
    onSelect: (_row, context) => {
      const { onConsumed } = commandContext(context)
      publishChatTaskIntent({ kind: 'my-tasks' })
      // The line is consumed: opening a list is a completed action, unlike opening a
      // composer that can still be cancelled.
      onConsumed?.()
    },
  },
  {
    id: 'chat_tasks.command.tasks',
    label: 'Tasks in this conversation',
    icon: 'list-checks',
    onSelect: (_row, context) => {
      const { conversationId, onConsumed } = commandContext(context)
      if (!conversationId) return
      publishChatTaskIntent({ kind: 'panel', conversationId })
      onConsumed?.()
    },
  },
]

const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'chat_tasks.injection.chat-commands',
    title: 'Chat task commands',
    /**
     * `chat.view` and `tasks.view`, not `chat.send`.
     *
     * `/mytasks` and `/tasks` are private reads and must not require permission to
     * post in the conversation. `/task` does end in a write, and the endpoint behind
     * it requires `tasks.create` and `chat.send` — which is the right place for that
     * check, because a menu entry is a suggestion and the server is the boundary.
     */
    features: ['chat.view', 'tasks.view'],
    requiredModules: ['chat', 'tasks'],
    priority: 100,
  },
  rowActions: actions,
}

export default widget
