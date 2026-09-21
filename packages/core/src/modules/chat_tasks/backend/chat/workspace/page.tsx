import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { WorkspaceView } from '../../../components/WorkspaceView'

export default function ChatTasksWorkspacePage() {
  return (
    <Page fill>
      <PageBody fill>
        <WorkspaceView />
      </PageBody>
    </Page>
  )
}
