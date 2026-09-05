'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Hash, MessageSquare, Search } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatSearchHitDto } from '../data/types'
import { formatFullTimestamp } from './format'
import { HighlightedText } from './HighlightedText'
import { useChatSearch } from './hooks'

/**
 * Search every conversation the reader belongs to.
 *
 * A results list rather than a find bar, because the answer to "where was that
 * said" is the conversation as much as the message -- so each row leads with
 * where it came from. Selecting one opens that conversation and scrolls to the
 * message, however far back it is.
 *
 * Scope is the active organization and the reader's own memberships, decided
 * entirely server-side. Nothing here can widen it.
 */
export function GlobalChatSearch() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [term, setTerm] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const {
    results,
    total,
    totalIsCapped,
    activeQuery,
    isSearching,
    error,
    retry,
    fuzzyAvailable,
    hasMore,
    loadMore,
    isLoadingMore,
  } = useChatSearch({ query: term })

  // The page exists to be typed into, and it holds exactly one field. Making
  // the reader click it first would be a step with no decision in it.
  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const open = React.useCallback(
    (hit: ChatSearchHitDto) => {
      // The message id travels in the URL so the conversation view can anchor
      // to it on mount. Routing rather than local state is what keeps the
      // browser's back button working on narrow screens, where the list and
      // the conversation are separate screens.
      router.push(`/backend/chat/${hit.conversationId}?message=${hit.messageId}`)
    },
    [router],
  )

  // Results grouped by conversation, in the order the conversations first
  // appear — so the ranking still decides what is near the top, while a reader
  // scanning the list can see at a glance which thread each match came from.
  const groups = React.useMemo(() => {
    const byConversation = new Map<string, ChatSearchHitDto[]>()
    for (const hit of results) {
      const existing = byConversation.get(hit.conversationId)
      if (existing) existing.push(hit)
      else byConversation.set(hit.conversationId, [hit])
    }
    return [...byConversation.entries()]
  }, [results])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <SearchInput
        ref={inputRef}
        value={term}
        onChange={setTerm}
        // Distinct from the in-conversation box, in wording and in accessible
        // name: the two scopes must never be mistaken for each other.
        placeholder={t('chat.search.allChats', 'Search all chats')}
        tone="raised"
        loading={isSearching}
      />

      {activeQuery.length === 0 ? (
        <EmptyState
          variant="subtle"
          icon={<Search className="size-5" aria-hidden="true" />}
          title={t('chat.search.allChats', 'Search all chats')}
          description={t('chat.search.prompt', 'Type to search your conversations.')}
        />
      ) : error ? (
        <ErrorMessage
          label={t('chat.search.error', "Couldn't run that search")}
          action={
            <Button variant="outline" size="sm" onClick={() => void retry()}>
              {t('chat.search.retry', 'Try again')}
            </Button>
          }
        />
      ) : isSearching && results.length === 0 ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <EmptyState
          variant="subtle"
          size="sm"
          icon={<Search className="size-5" aria-hidden="true" />}
          title={t('chat.search.noResults', 'No messages found')}
          description={t('chat.search.noResultsHint', 'Check the spelling, or remove a filter.')}
        />
      ) : (
        <>
          {/* Outside the scroll area: the count describes the whole result set,
              so scrolling it away would take the only statement of how much
              there is with it. */}
          <p className="shrink-0 text-xs text-muted-foreground" role="status" aria-live="polite">
            {totalIsCapped
              ? t('chat.search.countCapped', '{position} of {total}+', {
                  position: results.length,
                  total,
                })
              : t('chat.search.count', '{position} of {total}', {
                  position: results.length,
                  total,
                })}
            {fuzzyAvailable
              ? ''
              : ` · ${t('chat.search.fuzzyUnavailable', 'Typo tolerance is unavailable on this deployment.')}`}
          </p>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {groups.map(([conversationId, hits]) => (
              <section key={conversationId} className="flex flex-col gap-1.5">
                {/* `px-3` puts the heading's leading edge on the same vertical
                    as the text inside the cards below it. At `px-1` the icon
                    aligned with nothing and the label hung eleven pixels to the
                    right of every line it introduced. */}
                <h3 className="flex items-center gap-1.5 px-3 text-xs font-semibold text-muted-foreground">
                  {hits[0]!.conversationKind === 'space' ? (
                    <Hash className="size-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">
                    {hits[0]!.conversationTitle ?? hits[0]!.senderName}
                  </span>
                </h3>

                {hits.map((hit) => (
                  <button
                    key={hit.messageId}
                    type="button"
                    onClick={() => open(hit)}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-left',
                      'outline-none transition-colors hover:bg-surface-muted focus-visible:shadow-focus',
                    )}
                  >
                    <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="truncate font-medium text-foreground">{hit.senderName}</span>
                      <time dateTime={hit.createdAt}>
                        {formatFullTimestamp(locale, new Date(hit.createdAt))}
                      </time>
                    </span>
                    <span className="text-sm text-foreground">
                      {hit.truncatedStart ? '…' : ''}
                      <HighlightedText text={hit.snippet} ranges={hit.highlights} />
                      {hit.truncatedEnd ? '…' : ''}
                    </span>
                  </button>
                ))}
              </section>
            ))}

            {hasMore ? (
              <div className="flex justify-center pb-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isLoadingMore}
                  onClick={() => void loadMore()}
                >
                  {isLoadingMore
                    ? t('chat.search.loadingMore', 'Loading…')
                    : t('chat.search.loadMore', 'Load more results')}
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
