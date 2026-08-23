"use client"

import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ProjectDetailView } from '@open-mercato/core/modules/tasks/components/ProjectDetailView'
import { TasksShell } from '@open-mercato/core/modules/tasks/components/TasksShell'

export default function TasksProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const projectId = typeof params?.id === 'string' ? params.id : ''

  return (
    <Page fill>
      <PageBody fill>
        <TasksShell>{projectId ? <ProjectDetailView projectId={projectId} /> : null}</TasksShell>
      </PageBody>
    </Page>
  )
}
