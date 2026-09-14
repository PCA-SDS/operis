import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ChatTaskCardWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'chat_tasks.injection.task-card',
    title: 'Task card',
    description: 'A linked task, rendered inside a chat conversation',
    /**
     * `chat.view` only.
     *
     * Deliberately NOT `tasks.view`: a colleague without task access must still see
     * the card row's "you do not have access to this" state, and gating the widget
     * on the task grant would leave chat rendering its own fallback instead —
     * indistinguishable from the module being absent. The task itself is gated
     * server-side, per card, which is where a real boundary belongs.
     */
    features: ['chat.view'],
    requiredModules: ['chat', 'tasks'],
    priority: 100,
  },
  Widget: ChatTaskCardWidget,
}

export default widget
