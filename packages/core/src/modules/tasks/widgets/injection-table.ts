import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Where this module contributes UI to other modules' screens.
 *
 * The calendar spot is what lets a CRM calendar edit a task without importing
 * the tasks module: it renders the spot, this table fills it, and disabling
 * tasks simply empties it.
 */
export const injectionTable: ModuleInjectionTable = {
  'calendar:task-editor': [
    {
      widgetId: 'tasks.injection.calendar-task-editor',
      priority: 100,
    },
  ],
}

export default injectionTable
