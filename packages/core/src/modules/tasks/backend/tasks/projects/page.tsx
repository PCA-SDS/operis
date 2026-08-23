"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ProjectsListView } from '@open-mercato/core/modules/tasks/components/ProjectsListView'
import { TasksShell } from '@open-mercato/core/modules/tasks/components/TasksShell'

export default function TasksProjectsPage() {
  return (
    <Page fill>
      <PageBody fill>
        <TasksShell>
          <ProjectsListView />
        </TasksShell>
      </PageBody>
    </Page>
  )
}
