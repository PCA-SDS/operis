import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { WorkspaceView } from '@open-mercato/core/modules/chat_tasks/components/WorkspaceView'

export default function ChatTasksWorkspacePage() {
  return (
    <Page fill>
      <PageBody fill>
        <WorkspaceView />
      </PageBody>
    </Page>
  )
}
