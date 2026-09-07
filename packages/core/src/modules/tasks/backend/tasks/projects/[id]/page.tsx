"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ProjectDetailView } from '@open-mercato/core/modules/tasks/components/ProjectDetailView'
import { TasksShell } from '@open-mercato/core/modules/tasks/components/TasksShell'

export default function TasksProjectDetailPage({ params }: { params?: { id?: string } }) {
  const projectId = params?.id ?? ''

  return (
    <Page fill>
      <PageBody fill>
        <TasksShell>{projectId ? <ProjectDetailView projectId={projectId} /> : null}</TasksShell>
      </PageBody>
    </Page>
  )
}
