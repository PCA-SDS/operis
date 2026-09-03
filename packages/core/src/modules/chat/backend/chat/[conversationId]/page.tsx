import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ChatShell } from '@open-mercato/core/modules/chat/components/ChatShell'

/**
 * `/backend/chat/<id>` — one conversation, with the list still beside it on wide
 * screens. Giving a conversation its own route is what makes deep links,
 * refresh and browser back behave the way people expect.
 */
export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }> | { conversationId: string }
}) {
  const [auth, resolved] = await Promise.all([getAuthFromCookies(), Promise.resolve(params)])
  return (
    <Page fill>
      <PageBody fill>
        <ChatShell currentUserId={auth?.sub ?? ''} conversationId={resolved.conversationId} />
      </PageBody>
    </Page>
  )
}
