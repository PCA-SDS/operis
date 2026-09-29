"use client"

import * as React from 'react'
import { CirclePlus, Globe, MessageSquarePlus, Search, Users } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import {
  ModuleSidebarAction,
  ModuleSidebarDivider,
  ModuleSidebarLink,
  ModuleSidebarNote,
  ModuleSidebarSection,
  ModuleSidebarSkeletonRow,
} from '@open-mercato/ui/backend/module-nav/ModuleSidebar'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useTCount } from './plurals'
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
 * Identifies the rail's create control so a dialog it opened can hand focus
 * back to it. Exported rather than repeated as a string in two files.
 */
export const CREATE_TRIGGER_TESTID = 'chat-create-conversation'

/** Enough conversations that narrowing them is worth a control. */
const FILTER_THRESHOLD = 5

function ConversationRow({
  conversation,
  isActive,
}: {
  conversation: ChatConversationDto
  isActive: boolean
}) {
  const tc = useTCount()
  // The title is resolved server-side for both kinds, so the row does not have
  // to know whether it is naming a person or a space.
  const name = conversation.title
  const unread = conversation.unreadCount
  const isSpace = conversation.kind === 'space'
  const isExternal = conversation.kind === 'external'

  return (
    <ModuleSidebarLink
      href={`/backend/chat/${conversation.id}`}
      active={isActive}
      label={name}
      emphasized={unread > 0 && !isActive}
      /* One quiet glyph for a space, a person's initials for a direct. A stack
         of member avatars read as smudged letters at this size, since Operis
         has no avatar images. The same 20px slot either way, so both kinds of
         row are exactly as tall as every other sidebar row. */
      leading={(
        <Avatar
          label={name}
          size="xs"
          variant={unread > 0 ? 'default' : 'monochrome'}
          icon={
            isSpace ? (
              <Users className="size-3" aria-hidden="true" />
            ) : isExternal ? (
              <Globe className="size-3" aria-hidden="true" />
            ) : undefined
          }
        />
      )}
      /* A dot, not a number: the count is on the section header above. Weight
         carries it too, so the state is never colour or shape alone, and the
         exact number is still announced. */
      trailing={unread > 0 ? (
        <>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
          <span className="sr-only">
            {tc('chat.list.unreadLabel', unread, '{count} unread messages')}
          </span>
        </>
      ) : undefined}
    />
  )
}

/**
 * One labelled group of conversations, named as its own navigation region.
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
    <ModuleSidebarSection
      label={label}
      landmark
      badge={unread > 0 ? (unread > 99 ? t('chat.list.unreadOverflow', '99+') : unread) : undefined}
    >
      {conversations.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          isActive={conversation.id === activeConversationId}
        />
      ))}
    </ModuleSidebarSection>
  )
}

/**
 * The conversation rail.
 *
 * Built from the module sidebar parts every module uses, so it reads as the
 * same product as the Tasks and Customers sidebars: the primary create action,
 * sentence-case section labels, one row, one selection. It keeps its own column
 * because only the list scrolls, under the search and create controls, and it
 * is populated like a chat roster: rows carry a person, with unread shown as
 * weight plus a dot instead of a number badge.
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
      // An external conversation is found by any of its outsiders' names too.
      const contactNames = (conversation.external?.contacts ?? []).map((contact) => contact.name).join(' ')
      return (
        conversation.title.toLowerCase().includes(needle) ||
        email.toLowerCase().includes(needle) ||
        contactNames.toLowerCase().includes(needle)
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
  // People outside the organization get a section of their own, so a
  // conversation that reaches a customer is never mistaken for a colleague's.
  const externals = React.useMemo(
    () => visible.filter((conversation) => conversation.kind === 'external'),
    [visible],
  )

  const unreadIn = React.useCallback(
    (items: ChatConversationDto[]) =>
      items.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    [],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
      {/* Searching every conversation is a peer of starting one: both are ways
          into a thread that is not on screen, so they sit together at the top
          of the rail rather than search hiding inside a conversation. */}
      <ModuleSidebarLink
        href="/backend/chat/search"
        icon={<Search />}
        label={t('chat.search.allChats', 'Search all chats')}
        active={false}
      />

      {/* One create control, not two: the two things you can start live behind
          one action, which is also how a user thinks about it: "new
          conversation", then what kind. */}
      {canStartConversation ? (
        <ModuleSidebarAction
          icon={<CirclePlus aria-hidden="true" />}
          label={t('chat.list.start', 'New chat')}
          // A stable handle for focus restoration. The menu unmounts when an
          // item is chosen, so by the time the dialog it opened is dismissed
          // there is nothing left for Radix to hand focus back to — see
          // `ChatShell`.
          data-testid={CREATE_TRIGGER_TESTID}
          menuItems={[
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
        <div className="shrink-0 py-1">
          <SearchInput
            value={filter}
            onChange={setFilter}
            size="sm"
            placeholder={t('chat.list.filterPlaceholder', 'Filter conversations')}
            aria-label={t('chat.list.filterLabel', 'Filter conversations')}
          />
        </div>
      ) : null}

      {/* Section labels carry their own unread total. Not collapsible: hiding
          one of two sections would leave a mostly empty column. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {isLoading ? (
          <div aria-busy="true" className="flex flex-col gap-1">
            <span className="sr-only">{t('chat.list.loading', 'Loading conversations…')}</span>
            <ModuleSidebarSkeletonRow width="w-32" avatar />
            <ModuleSidebarSkeletonRow width="w-24" avatar />
            <ModuleSidebarSkeletonRow width="w-28" avatar />
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
          <ModuleSidebarNote
            title={t('chat.list.noMatchesTitle', 'No matches')}
            description={t(
              'chat.list.noMatchesDescription',
              'No conversation matches "{query}". Use New chat to reach someone else.',
              { query: filter.trim() },
            )}
          />
        ) : conversations.length === 0 ? (
          /* No action here. "New chat" is persistent chrome at the top of this
             column, and repeating it inside the empty state would put two
             identical primary controls in one narrow column. */
          <ModuleSidebarNote
            title={t('chat.list.emptyTitle', 'No conversations yet')}
            description={
              canStartConversation
                ? t('chat.list.emptyDescription', "They'll appear here once you start one.")
                : t('chat.list.emptyReadOnly', 'Messages your colleagues send you will appear here.')
            }
          />
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
            {directs.length > 0 && spaces.length > 0 ? <ModuleSidebarDivider /> : null}
            <ConversationSection
              label={t('chat.list.spaces', 'Spaces')}
              conversations={spaces}
              unread={unreadIn(spaces)}
              activeConversationId={activeConversationId}
            />
            {(directs.length > 0 || spaces.length > 0) && externals.length > 0 ? <ModuleSidebarDivider /> : null}
            <ConversationSection
              label={t('chat.list.external', 'External')}
              conversations={externals}
              unread={unreadIn(externals)}
              activeConversationId={activeConversationId}
            />

            {hasMore && !needle ? (
              <div className="space-y-1 p-1">
                {/* A failed page-fetch reports itself here rather than replacing
                    the list: the conversations already loaded are still valid,
                    and throwing them away to show an error box loses the user's
                    place for a failure that only affects the next page. */}
                {error ? (
                  <p role="alert" className="px-2 text-xs text-status-error-text">
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
              <p className="px-3 py-2 text-xs text-muted-foreground">
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
