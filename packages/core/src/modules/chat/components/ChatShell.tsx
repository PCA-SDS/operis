"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare, MessageSquarePlus } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { ConversationList } from './ConversationList'
import { ConversationView } from './ConversationView'
import { StartConversationDialog } from './StartConversationDialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useCanSendChat, useChatLiveRefresh, useConversations } from './hooks'

export type ChatShellProps = {
  currentUserId: string
  /** Set on `/backend/chat/[id]`; absent on the list route. */
  conversationId?: string
}

/**
 * The module's layout.
 *
 * Desktop shows both panes; below `lg:` the list and the conversation are
 * separate screens, and which one you see is decided by the URL rather than by
 * component state — so browser back moves between them and a refresh keeps you
 * where you were.
 */
export function ChatShell({ currentUserId, conversationId }: ChatShellProps) {
  const t = useT()
  const router = useRouter()
  const [startOpen, setStartOpen] = React.useState(false)
  const canSend = useCanSendChat()
  const scopeVersion = useOrganizationScopeVersion()

  useChatLiveRefresh()

  /**
   * An open conversation belongs to the organization it was opened in. Switching
   * organization while one is on screen leaves the URL pointing at a
   * conversation the new scope cannot read, so the user lands on "Couldn't open
   * this conversation" for no reason they can see. Send them back to the list,
   * which is valid in every scope.
   */
  const previousScope = React.useRef(scopeVersion)
  React.useEffect(() => {
    if (previousScope.current === scopeVersion) return
    previousScope.current = scopeVersion
    if (conversationId) router.replace('/backend/chat')
  }, [conversationId, router, scopeVersion])

  const {
    conversations,
    isLoading,
    error,
    hasMore,
    reachedLimit,
    isLoadingMore,
    loadMore,
    retry,
  } = useConversations()

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-surface lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div
          className={cn(
            'min-h-0 flex-col border-border lg:flex lg:border-r',
            conversationId ? 'hidden' : 'flex',
          )}
        >
          <ConversationList
            conversations={conversations}
            activeConversationId={conversationId}
            isLoading={isLoading}
            error={error}
            hasMore={hasMore}
            reachedLimit={reachedLimit}
            isLoadingMore={isLoadingMore}
            onLoadMore={() => void loadMore()}
            onRetry={() => void retry()}
            canStartConversation={canSend}
            onStartConversation={() => setStartOpen(true)}
          />
        </div>

        <div className={cn('min-h-0 flex-col lg:flex', conversationId ? 'flex' : 'hidden lg:flex')}>
          {conversationId ? (
            <ConversationView
              key={conversationId}
              conversationId={conversationId}
              currentUserId={currentUserId}
              showBackToList
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              {/* Three states, because "Pick a conversation / choose someone on
                  the left" was shown even when the left pane was empty — it
                  pointed at nothing on the one screen a new user always sees.
                  While loading or after a load failure this stays blank: the
                  list pane owns the spinner and the error, and guessing
                  "no conversations" from an empty array would be wrong in both
                  cases. */}
              {isLoading || error ? null : conversations.length > 0 ? (
                <EmptyState
                  variant="subtle"
                  icon={<MessageSquare className="size-5" aria-hidden="true" />}
                  title={t('chat.empty.title', 'Pick a conversation')}
                  description={t('chat.empty.description', 'Choose someone on the left to read and reply.')}
                />
              ) : (
                <EmptyState
                  variant="subtle"
                  icon={<MessageSquarePlus className="size-5" aria-hidden="true" />}
                  title={
                    canSend
                      ? t('chat.empty.firstRunTitle', 'Start your first conversation')
                      : t('chat.list.emptyTitle', 'No conversations yet')
                  }
                  description={
                    canSend
                      ? t(
                          'chat.empty.firstRunDescription',
                          'Use New chat to find a colleague in your organization.',
                        )
                      : t(
                          'chat.list.emptyReadOnly',
                          'Messages your colleagues send you will appear here.',
                        )
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>

      {startOpen ? <StartConversationDialog onClose={() => setStartOpen(false)} /> : null}
    </>
  )
}
