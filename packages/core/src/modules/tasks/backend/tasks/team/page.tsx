"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { TasksShell } from '@open-mercato/core/modules/tasks/components/TasksShell'
import { TeamView } from '@open-mercato/core/modules/tasks/components/TeamView'

export default function TasksTeamPage() {
  return (
    <Page fill>
      <PageBody fill>
        <TasksShell>
          <TeamView />
        </TasksShell>
      </PageBody>
    </Page>
  )
}
