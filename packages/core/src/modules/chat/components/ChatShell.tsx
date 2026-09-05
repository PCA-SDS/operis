"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare, MessageSquarePlus } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { ConversationList, CREATE_TRIGGER_TESTID } from './ConversationList'
import { ConversationView } from './ConversationView'
import { CreateSpaceDialog } from './CreateSpaceDialog'
import { StartConversationDialog } from './StartConversationDialog'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useCanSendChat, useChatLiveRefresh, useConversations } from './hooks'

export type ChatShellProps = {
  currentUserId: string
  /** Set on `/backend/chat/[id]`; absent on the list route. */
  conversationId?: string
  /**
   * The organization this page was rendered under, from the session on the
   * server. It is the baseline the client scope is compared against — see the
   * redirect effect.
   */
  organizationId: string | null
}

/**
 * The module's layout.
 *
 * Desktop shows both panes; below `lg:` the list and the conversation are
 * separate screens, and which one you see is decided by the URL rather than by
 * component state — so browser back moves between them and a refresh keeps you
 * where you were.
 */
export function ChatShell({ currentUserId, conversationId, organizationId }: ChatShellProps) {
  const t = useT()
  const router = useRouter()
  const [startOpen, setStartOpen] = React.useState(false)
  const [createSpaceOpen, setCreateSpaceOpen] = React.useState(false)

  /**
   * Hand focus back to the control that opened the dialog.
   *
   * Both dialogs are reached through a dropdown, and choosing an item unmounts
   * the menu — so the element Radix would restore to is already gone by the time
   * the dialog closes, and a keyboard user was dropped on `<body>` at the top of
   * the document. Restoring to the trigger itself is what the menu would have
   * done had it still been there.
   */
  const restoreFocusToCreateTrigger = React.useCallback(() => {
    const trigger = document.querySelector<HTMLElement>(`[data-testid="${CREATE_TRIGGER_TESTID}"]`)
    trigger?.focus()
  }, [])

  const closeStart = React.useCallback(() => {
    setStartOpen(false)
    restoreFocusToCreateTrigger()
  }, [restoreFocusToCreateTrigger])

  const closeCreateSpace = React.useCallback(() => {
    setCreateSpaceOpen(false)
    restoreFocusToCreateTrigger()
  }, [restoreFocusToCreateTrigger])
  const canSend = useCanSendChat()
  const scope = useOrganizationScopeDetail()

  useChatLiveRefresh()

  /**
   * An open conversation belongs to the organization it was opened in. Switching
   * organization while one is on screen leaves the URL pointing at a
   * conversation the new scope cannot read, so the user lands on "Couldn't open
   * this conversation" for no reason they can see. Send them back to the list,
   * which is valid in every scope.
   *
   * Compared against the organization the *server* rendered this page under,
   * not against a previous client render. The chrome publishes the active scope
   * once after hydration, and the scope version counter treats that first
   * publish as a change — so keying off it redirected on every fresh load, and
   * a deep link to a conversation could never be opened at all. The server value
   * cannot race: it is already correct on first paint.
   */
  const activeOrganizationId = scope.organizationId
  React.useEffect(() => {
    if (!conversationId) return
    // `null` is the pre-hydration default and the super-admin "all organizations"
    // selection; neither is a switch away from what the server rendered.
    if (activeOrganizationId === null || activeOrganizationId === organizationId) return
    router.replace('/backend/chat')
  }, [activeOrganizationId, conversationId, organizationId, router])

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
      {/* Two surfaces with air between them, not one card split by a rule — the
          same shape `TasksShell` uses for its rail and content. The rail is a
          panel in its own right, so it reads as navigation belonging to the
          module rather than a column inside the transcript. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
        <aside
          aria-label={t('chat.nav.title', 'Chat')}
          className={cn(
            'min-h-0 flex-col lg:flex',
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
            onCreateSpace={() => setCreateSpaceOpen(true)}
          />
        </aside>

        {/* The transcript carries the card now that the wrapper does not.
            `overflow-hidden` so the message list is clipped by the rounded
            corners instead of squaring them off.

            No border: the fill already separates it. `bg-surface` on the page's
            `bg-background` is its own edge, and the rail beside it is defined the
            same way — a rule around only one of the two panels made them look
            like different kinds of thing. */}
        <section
          className={cn(
            'min-h-0 flex-col overflow-hidden rounded-xl bg-surface lg:flex',
            conversationId ? 'flex' : 'hidden lg:flex',
          )}
        >
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
                          'Use New chat to message a colleague or create a space.',
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
        </section>
      </div>

      {/* Always mounted, driven by `open`. Unmounting on close tore the Radix
          dialog down before it could restore focus, so Escape left a keyboard
          user at the top of the document instead of back on the control they
          opened it from. */}
      <StartConversationDialog open={startOpen} onClose={closeStart} />
      <CreateSpaceDialog open={createSpaceOpen} onClose={closeCreateSpace} />
    </>
  )
}
