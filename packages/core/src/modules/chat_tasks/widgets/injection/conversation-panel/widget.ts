import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ChatTasksPanelWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'chat_tasks.injection.conversation-panel',
    title: 'Conversation tasks',
    description: 'Tasks linked to the open conversation',
    // Both, because the panel is a task-reading surface inside a conversation. A
    // viewer with only one of the two sees no toggle at all rather than a section
    // that can never fill.
    features: ['chat.view', 'tasks.view'],
    requiredModules: ['chat', 'tasks'],
    priority: 100,
  },
  Widget: ChatTasksPanelWidget,
}

export default widget
