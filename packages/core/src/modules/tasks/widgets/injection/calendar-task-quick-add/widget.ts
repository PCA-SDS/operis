import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CalendarTaskQuickAddWidget, {
  type CalendarTaskQuickAddContext,
} from '../calendar-task-quick-add'

const widget: InjectionWidgetModule<CalendarTaskQuickAddContext, unknown> = {
  metadata: {
    id: 'tasks.injection.calendar-task-quick-add',
    title: 'Task quick add',
    description: 'The Task Manager quick-add composer, opened from a calendar grid cell',
    // Creating needs more than reading, so this spot asks for the write grant.
    // Without it the spot stays empty and the calendar cannot become a way
    // around the module's own access rules.
    features: ['tasks.create'],
    priority: 100,
    enabled: true,
  },
  Widget: CalendarTaskQuickAddWidget,
}

export default widget
