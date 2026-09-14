import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ChatTaskOverlaysWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'chat_tasks.injection.conversation-overlays',
    title: 'Chat task overlays',
    description: 'The task composer and task picker a chat command opens',
    // Creating is the point of these surfaces, so a viewer who cannot create tasks
    // gets no host — and the commands that would publish into it are gated the same
    // way, so there is nothing left to open.
    features: ['chat.view', 'tasks.create'],
    requiredModules: ['chat', 'tasks'],
    priority: 100,
  },
  Widget: ChatTaskOverlaysWidget,
}

export default widget
