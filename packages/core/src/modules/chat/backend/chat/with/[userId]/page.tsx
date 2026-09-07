import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { OpenConversationWithUser } from '@open-mercato/core/modules/chat/components/OpenConversationWithUser'

/**
 * `/backend/chat/with/<userId>` — the stable "message this person" link.
 *
 * Any module that knows a colleague's user id can send someone here without
 * knowing anything about conversations; the page resolves the canonical one and
 * redirects to it.
 */
export default async function OpenChatWithUserPage({
  params,
}: {
  params: Promise<{ userId: string }> | { userId: string }
}) {
  const resolved = await params
  return (
    <Page fill>
      <PageBody fill>
        <OpenConversationWithUser userId={resolved.userId} />
      </PageBody>
    </Page>
  )
}
