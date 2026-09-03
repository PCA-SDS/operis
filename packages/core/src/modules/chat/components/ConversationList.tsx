"use client"

import Link from 'next/link'
import { MessageSquarePlus } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatConversationDto } from '../data/types'
import { MAX_CONVERSATION_PAGE_SIZE } from '../data/validators'
import { formatListTimestamp } from './format'

type ConversationListProps = {
  conversations: ChatConversationDto[]
  activeConversationId?: string
  isLoading: boolean
  error: unknown
  hasMore: boolean
  /** More conversations exist but the bounded list will not grow further. */
  reachedLimit?: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  /** False for a `chat.view`-only member; the affordance is hidden rather than shown-and-refused. */
  canStartConversation: boolean
  onStartConversation: () => void
}

function ConversationSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton shape="circle" className="size-9" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

function ConversationRow({
  conversation,
  isActive,
}: {
  conversation: ChatConversationDto
  isActive: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const name = conversation.counterpart?.name ?? t('chat.list.unknownPerson', 'Former colleague')
  const unread = conversation.unreadCount
  const timestamp = conversation.lastMessageAt ? new Date(conversation.lastMessageAt) : null

  return (
    <Link
      href={`/backend/chat/${conversation.id}`}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors',
        'outline-none focus-visible:shadow-focus',
        isActive ? 'bg-primary-soft' : 'hover:bg-surface-muted',
      )}
    >
      <Avatar label={name} size="md" variant={unread > 0 ? 'default' : 'monochrome'} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-sm',
              unread > 0 ? 'font-semibold text-foreground' : 'font-medium text-foreground',
            )}
          >
            {name}
          </span>
          {timestamp ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatListTimestamp(locale, timestamp)}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-xs',
              unread > 0 ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {conversation.lastMessagePreview ?? t('chat.list.noMessages', 'No messages yet')}
          </span>
          {/* The count, not only the weight: unread must not be carried by
              colour or boldness alone.

              `size="default"`, not `sm`: the `sm` size class is `text-overline`,
              a custom utility tailwind-merge classifies as a text *colour*, so it
              silently drops the variant's `text-primary-foreground` and the count
              renders near-black on a navy pill. */}
          {unread > 0 ? (
            <Badge variant="default" size="default" className="shrink-0">
              {unread > 99 ? t('chat.list.unreadOverflow', '99+') : unread}
            </Badge>
          ) : null}
        </span>
      </span>
      {unread > 0 ? (
        <span className="sr-only">
          {t(
            `chat.list.unreadLabel${unread === 1 ? '' : '_plural'}`,
            '{count} unread messages',
            { count: unread },
          )}
        </span>
      ) : null}
    </Link>
  )
}

/**
 * The left pane: every conversation the reader is in, most recent first.
 *
 * Rows are links rather than buttons so a conversation has a real URL that can
 * be opened in a new tab, bookmarked and reached with browser back.
 */
export function ConversationList({
  conversations,
  activeConversationId,
  isLoading,
  error,
  hasMore,
  reachedLimit,
  isLoadingMore,
  onLoadMore,
  onRetry,
  canStartConversation,
  onStartConversation,
}: ConversationListProps) {
  const t = useT()

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">
          {t('chat.list.title', 'Conversations')}
        </h2>
        {canStartConversation ? (
          <Button type="button" size="sm" onClick={onStartConversation}>
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            {t('chat.list.start', 'New chat')}
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div aria-busy="true">
            {/* No `aria-live` here: `Skeleton` is already a polite live region,
                so wrapping several of them in another one makes a screen reader
                announce the same thing repeatedly. */}
            <span className="sr-only">{t('chat.list.loading', 'Loading conversations…')}</span>
            <ConversationSkeleton />
            <ConversationSkeleton />
            <ConversationSkeleton />
          </div>
        ) : error && conversations.length === 0 ? (
          <div className="p-3">
            <ErrorMessage
              label={t('chat.list.error', "Couldn't load your conversations")}
              action={
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                  {t('chat.actions.retry', 'Try again')}
                </Button>
              }
            />
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-3">
            {/* No action here. "New chat" is persistent chrome in the header a
                few pixels above, and repeating it inside the empty state put
                two identical primary buttons in one 20rem column. The empty
                state explains the situation and names the control instead. */}
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('chat.list.emptyTitle', 'No conversations yet')}
              description={
                canStartConversation
                  ? t('chat.list.emptyDescription', "They'll appear here once you start one.")
                  : t('chat.list.emptyReadOnly', 'Messages your colleagues send you will appear here.')
              }
            />
          </div>
        ) : (
          <nav aria-label={t('chat.list.title', 'Conversations')} className="flex flex-col gap-0.5">
            {conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                isActive={conversation.id === activeConversationId}
              />
            ))}
            {hasMore ? (
              <div className="space-y-1 p-2">
                {/* A failed page-fetch reports itself here rather than replacing
                    the list: the conversations already loaded are still valid,
                    and throwing them away to show an error box loses the user's
                    place for a failure that only affects the next page. */}
                {error ? (
                  <p role="alert" className="px-1 text-xs text-status-error-text">
                    {t('chat.list.loadMoreFailed', "Couldn't load older conversations.")}
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={isLoadingMore}
                  onClick={onLoadMore}
                >
                  {isLoadingMore
                    ? t('chat.list.loadingMore', 'Loading…')
                    : error
                      ? t('chat.actions.retry', 'Try again')
                      : t('chat.list.loadMore', 'Show older conversations')}
                </Button>
              </div>
            ) : null}
            {reachedLimit ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {t(
                  'chat.list.reachedLimit',
                  'Showing your {count} most recent conversations. Search for a colleague to reach an older one.',
                  { count: MAX_CONVERSATION_PAGE_SIZE },
                )}
              </p>
            ) : null}
          </nav>
        )}
      </div>
    </div>
  )
}
