import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ChatShell } from '@open-mercato/core/modules/chat/components/ChatShell'

/**
 * `/backend/chat` — the conversation list, with the reading pane empty until one
 * is chosen. Resolved on the server so the shell knows whose messages are
 * "mine" without a round-trip on first paint.
 */
export default async function ChatPage() {
  const auth = await getAuthFromCookies()
  return (
    <Page fill>
      <PageBody fill>
        <ChatShell currentUserId={auth?.sub ?? ''} />
      </PageBody>
    </Page>
  )
}
