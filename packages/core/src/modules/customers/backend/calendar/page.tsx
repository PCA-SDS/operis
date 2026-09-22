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
          // The OLD task integration stays off. The current one is separate:
          // `useCalendarTaskItems` reads tasks due in the window and draws them
          // in the all-day lane, and a grid click opens the Quick Add composer
          // through the `calendar:task-quick-add` injection spot. Neither is
          // gated here — the endpoint and the spot are both permission-checked
          // on their own. This flag only governs the dormant older path.
          tasksEnabled={false}
        />
      </PageBody>
    </Page>
  )
}
