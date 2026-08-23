"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { MyTasksView } from '@open-mercato/core/modules/tasks/components/MyTasksView'
import { TasksShell } from '@open-mercato/core/modules/tasks/components/TasksShell'

export default function AllTasksPage() {
  return (
    <Page fill>
      <PageBody fill>
        <TasksShell>
          <MyTasksView view="all" />
        </TasksShell>
      </PageBody>
    </Page>
  )
}
