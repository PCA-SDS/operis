"use client"

import * as React from 'react'
import Link from 'next/link'
import { CirclePlus, MessageSquarePlus, Users } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Dropdown } from '@open-mercato/ui/primitives/dropdown'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { tCount } from './plurals'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatConversationDto } from '../data/types'
import { MAX_CONVERSATION_PAGE_SIZE } from '../data/validators'

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
  onCreateSpace: () => void
}

/**
 * One row shape for everything in this panel, borrowed from `TasksSidebar` so the
 * two module rails read as the same product. Row height, radius, gap and the
 * focus ring all come from here rather than being restated per row.
 */
const PANEL_ROW =
  'flex w-full shrink-0 items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors outline-none focus-visible:shadow-focus'

/** The section labels, matching the Tasks rail's uppercase caption. */
const PANEL_LABEL =
  'px-2 text-overline font-semibold uppercase tracking-widest text-muted-foreground'

/**
 * Identifies the rail's create control so a dialog it opened can hand focus
 * back to it. Exported rather than repeated as a string in two files.
 */
export const CREATE_TRIGGER_TESTID = 'chat-create-conversation'

/** Enough conversations that narrowing them is worth a control. */
const FILTER_THRESHOLD = 5

function ConversationSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-2">
      <Skeleton shape="circle" className="size-7" />
      <Skeleton className="h-3 w-2/3" />
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
  // The title is resolved server-side for both kinds, so the row does not have
  // to know whether it is naming a person or a space.
  const name = conversation.title
  const unread = conversation.unreadCount
  const isSpace = conversation.kind === 'space'

  return (
    <Link
      href={`/backend/chat/${conversation.id}`}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        PANEL_ROW,
        isActive
          ? 'bg-primary-soft font-medium text-primary'
          : unread > 0
            ? 'font-semibold text-foreground hover:bg-surface-strong'
            : 'text-muted-foreground hover:bg-surface-strong hover:text-foreground',
      )}
    >
      {/* One quiet glyph for a space, a person's initials for a direct.
          A stack of member avatars was tried here and had to go: Operis has no
          avatar images, so the stack was two or three sets of INITIALS overlapping
          inside 20px, which read as smudged letters rather than as people. The
          same slot either way, so both kinds of row are exactly as tall and their
          labels line up. */}
      <Avatar
        label={name}
        size="sm"
        variant={unread > 0 ? 'default' : 'monochrome'}
        icon={isSpace ? <Users className="size-4" aria-hidden="true" /> : undefined}
      />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {/* A dot, not a number: the panel is a place to notice something is waiting,
          and the count is on the section header above. Weight carries it too, so
          the state is never colour or shape alone — and the exact number is still
          announced, since neither weight nor a dot reaches a screen reader. */}
      {unread > 0 ? (
        <>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
          <span className="sr-only">
            {tCount(t, 'chat.list.unreadLabel', unread, '{count} unread messages')}
          </span>
        </>
      ) : null}
    </Link>
  )
}

/**
 * One labelled group of conversations.
 *
 * Renders nothing at all when it is empty, so a person with no spaces sees the
 * rail they have always seen rather than a caption over blank space.
 */
function ConversationSection({
  label,
  conversations,
  unread,
  activeConversationId,
}: {
  label: string
  conversations: ChatConversationDto[]
  unread: number
  activeConversationId?: string
}) {
  const t = useT()
  if (conversations.length === 0) return null

  return (
    <section className="pb-1">
      <div className="flex shrink-0 items-center gap-2 pb-1 pt-2">
        <h2 className={cn(PANEL_LABEL, 'flex-1')}>{label}</h2>
        {unread > 0 ? (
          <span className="px-2 text-xs font-semibold tabular-nums text-primary">
            {unread > 99 ? t('chat.list.unreadOverflow', '99+') : unread}
          </span>
        ) : null}
      </div>
      <nav aria-label={label} className="flex flex-col gap-0.5">
        {conversations.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            isActive={conversation.id === activeConversationId}
          />
        ))}
      </nav>
    </section>
  )
}

/**
 * The conversation rail.
 *
 * Structured like the Tasks sidebar — a muted panel with a primary create action,
 * uppercase section captions and one row shape — and populated like a chat
 * roster: single-line rows carrying a person rather than a record, with unread
 * shown as weight plus a dot instead of a number badge.
 *
 * Rows are links, so a conversation has a real URL that can be opened in a new
 * tab, bookmarked and reached with browser back.
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
  onCreateSpace,
}: ConversationListProps) {
  const t = useT()
  const [filter, setFilter] = React.useState('')

  /**
   * Narrows the conversations already on screen; it is not a directory search.
   * "New chat" is what reaches someone you have never messaged, and the
   * `reachedLimit` note below says so when the bounded list is full — otherwise
   * an empty filter result would read as "this person does not exist".
   */
  const needle = filter.trim().toLowerCase()
  const visible = React.useMemo(() => {
    if (!needle) return conversations
    return conversations.filter((conversation) => {
      // Matches the resolved title for both kinds, so typing a space's name
      // finds it exactly as typing a colleague's finds them. A space the caller
      // is not a member of is not in this array at all — the list comes from
      // their own participant rows — so this cannot surface a private space.
      const email = conversation.counterpart?.email ?? ''
      return (
        conversation.title.toLowerCase().includes(needle) || email.toLowerCase().includes(needle)
      )
    })
  }, [conversations, needle])

  /**
   * Two sections, not one mixed list.
   *
   * A direct is a person and a space is a room; sorting them into one stream by
   * recency means the answer to "where is the Finance Team space?" changes every
   * time somebody sends a DM. Splitting them keeps each list short enough to
   * scan and matches how the rail already labels things.
   */
  const directs = React.useMemo(
    () => visible.filter((conversation) => conversation.kind === 'direct'),
    [visible],
  )
  const spaces = React.useMemo(
    () => visible.filter((conversation) => conversation.kind === 'space'),
    [visible],
  )

  const unreadIn = React.useCallback(
    (items: ChatConversationDto[]) =>
      items.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    [],
  )

  return (
    // `flex-1` so the rail's ground runs the full height of the column. It used
    // to stop at the last row, which was invisible while the pane was plain but
    // obvious the moment it carried its own background.
    <div className="flex min-h-0 flex-1 flex-col gap-1 rounded-xl bg-surface-muted p-2">
      {/* One create control, not two. The rail is 16rem wide and a second
          primary row would compete with the first for the same glance — so the
          two things you can start live behind one action, which is also how a
          user thinks about it: "new conversation", then what kind.

          `Dropdown` in `menu` mode owns the portal, the placement flip, the
          roving focus and the `role="menu"` semantics. Only its trigger box is
          restated, so a command row here is exactly as tall as the conversation
          rows under it instead of the primitive's fixed 36px control. */}
      {canStartConversation ? (
        <Dropdown
          menu
          align="start"
          variant="ghost"
          // A stable handle for focus restoration. The menu unmounts when an
          // item is chosen, so by the time the dialog it opened is dismissed
          // there is nothing left for Radix to hand focus back to — see
          // `ChatShell`.
          data-testid={CREATE_TRIGGER_TESTID}
          placeholder={t('chat.list.start', 'New chat')}
          triggerLeading={
            <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden="true">
              <CirclePlus className="size-5" />
            </span>
          }
          triggerLabel={t('chat.list.start', 'New chat')}
          triggerClassName={cn(
            PANEL_ROW,
            'h-auto justify-start px-2 py-2 font-semibold text-primary hover:bg-primary-soft',
          )}
          actions={[
            {
              id: 'direct',
              label: t('chat.list.startDirect', 'Direct message'),
              leading: <MessageSquarePlus className="size-4" aria-hidden="true" />,
              onSelect: onStartConversation,
            },
            {
              id: 'space',
              label: t('chat.list.startSpace', 'New space'),
              leading: <Users className="size-4" aria-hidden="true" />,
              onSelect: onCreateSpace,
            },
          ]}
        />
      ) : null}

      {conversations.length > FILTER_THRESHOLD ? (
        <div className="shrink-0 px-1 py-1">
          <SearchInput
            value={filter}
            onChange={setFilter}
            size="sm"
            placeholder={t('chat.list.filterPlaceholder', 'Filter conversations')}
            aria-label={t('chat.list.filterLabel', 'Filter conversations')}
          />
        </div>
      ) : null}

      {/* Section captions carry their own unread total, the way the Tasks rail
          puts a count beside a view. Not collapsible: Google Chat's carets exist
          because it has four sections to triage between, and hiding one of two
          here would leave a mostly empty panel. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
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
          <div className="p-1">
            <ErrorMessage
              label={t('chat.list.error', "Couldn't load your conversations")}
              action={
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                  {t('chat.actions.retry', 'Try again')}
                </Button>
              }
            />
          </div>
        ) : visible.length === 0 && needle ? (
          <div className="p-1">
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('chat.list.noMatchesTitle', 'No matches')}
              description={t(
                'chat.list.noMatchesDescription',
                'No conversation matches "{query}". Use New chat to reach someone else.',
                { query: filter.trim() },
              )}
            />
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-1">
            {/* No action here. "New chat" is persistent chrome at the top of this
                panel, and repeating it inside the empty state put two identical
                primary controls in one narrow column. */}
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
          <>
            {/* A section with nothing in it is not rendered. An empty "Spaces"
                caption above blank space would be a heading that promises a list
                and delivers none. */}
            <ConversationSection
              label={t('chat.list.directMessages', 'Direct messages')}
              conversations={directs}
              unread={unreadIn(directs)}
              activeConversationId={activeConversationId}
            />
            <ConversationSection
              label={t('chat.list.spaces', 'Spaces')}
              conversations={spaces}
              unread={unreadIn(spaces)}
              activeConversationId={activeConversationId}
            />

            {hasMore && !needle ? (
              <div className="space-y-1 p-1">
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
            {reachedLimit && !needle ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {t(
                  'chat.list.reachedLimit',
                  'Showing your {count} most recent conversations. Search for a colleague to reach an older one.',
                  { count: MAX_CONVERSATION_PAGE_SIZE },
                )}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
