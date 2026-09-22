import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { CalendarScreen } from '../../components/calendar/CalendarScreen'

export default function CustomersCalendarPage() {
  // Optional-module flags resolved server-side: the editor offers resource
  // assignment / staff lookups only when those modules are loaded (#3552).
  const moduleIds = new Set(getModules().map((module) => module.id))
  return (
    // `fill` from `md` up hands the leftover viewport height to the grid, so the
    // shell scrolls and the calendar does not — the model a calendar needs, and
    // what lets the timed region drop its old `min(13h, 65vh)` cap. Narrow
    // viewports keep natural document scrolling.
    <Page fill="md">
      <PageBody fill="md">
        <CalendarScreen
          resourcesEnabled={moduleIds.has('resources')}
          staffEnabled={moduleIds.has('staff')}
          // Tasks are held off the calendar for now. Flipping this one flag
          // is the whole switch: `useCalendarTasks` returns before it fetches
          // and yields no items, `onNewTask` goes undefined so the header drops
          // the button, and the create path returns early. The task-aware code
          // downstream (the `isTaskItem` guard, the agenda's category colour,
          // the editor's task labels) stays in place and simply never sees a
          // task item — restoring this is `moduleIds.has('tasks')` again, not a
          // re-integration.
          tasksEnabled={false}
        />
      </PageBody>
    </Page>
  )
}
