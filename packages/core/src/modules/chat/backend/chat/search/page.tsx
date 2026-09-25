import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { GlobalChatSearch } from '@open-mercato/core/modules/chat/components/GlobalChatSearch'

/**
 * `/backend/chat/search` — searching every conversation the caller belongs to.
 *
 * Its own route rather than a panel toggled by state, for the same reason a
 * conversation has one: below `lg:` the chat list and a conversation are
 * separate screens, and a state-only surface would leave the browser's back
 * button doing the wrong thing on exactly the devices where it matters most.
 */
export default function ChatSearchPage() {
  return (
    <Page fill>
      <PageBody fill>
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <GlobalChatSearch />
        </div>
      </PageBody>
    </Page>
  )
}
