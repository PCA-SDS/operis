import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CalendarTaskEditorWidget, {
  type CalendarTaskEditorContext,
} from '../calendar-task-editor'

const widget: InjectionWidgetModule<CalendarTaskEditorContext, unknown> = {
  metadata: {
    id: 'tasks.injection.calendar-task-editor',
    title: 'Task editor',
    description: 'The Task Manager task panel, opened from a calendar entry',
    // Without `tasks.view` the spot stays empty, so the calendar cannot become
    // a way around the module's own access rules.
    features: ['tasks.view'],
    priority: 100,
    enabled: true,
  },
  Widget: CalendarTaskEditorWidget,
}

export default widget
