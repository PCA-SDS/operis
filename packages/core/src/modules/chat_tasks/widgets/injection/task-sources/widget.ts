import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ChatTaskSourcesWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'chat_tasks.injection.task-sources',
    title: 'Raised from',
    description: 'The chat conversations a task was raised from, where the reader may see them',
    // `chat.view` gates the widget loading at all; membership of each individual
    // conversation is checked server-side per link, which is the check that decides
    // what is actually shown.
    features: ['chat.view', 'tasks.view'],
    requiredModules: ['chat', 'tasks'],
    priority: 80,
  },
  Widget: ChatTaskSourcesWidget,
}

export default widget
