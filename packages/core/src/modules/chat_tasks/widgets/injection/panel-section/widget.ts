import type {
  InjectionRowActionWidget,
  InjectionRowActionDefinition,
} from '@open-mercato/shared/modules/widgets/injection'
import { CHAT_TASKS_PANEL_SECTION_ID } from '../../sectionIds'

/**
 * The Tasks toggle in the conversation header.
 *
 * A row action, but never actually selected: chat reads the id and the label to draw
 * the toggle and drives the region's own state from them, so the handler exists only
 * to satisfy the shape. The section body is the render widget at
 * `chat:conversation-panel:section`, which checks the same id before rendering.
 */
const actions: InjectionRowActionDefinition[] = [
  {
    id: CHAT_TASKS_PANEL_SECTION_ID,
    label: 'Tasks',
    icon: 'list-checks',
    onSelect: () => {
      // Chat opens the region itself; there is nothing for this to do.
    },
  },
]

const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'chat_tasks.injection.panel-section',
    title: 'Conversation tasks toggle',
    features: ['chat.view', 'tasks.view'],
    requiredModules: ['chat', 'tasks'],
    priority: 100,
  },
  rowActions: actions,
}

export default widget
