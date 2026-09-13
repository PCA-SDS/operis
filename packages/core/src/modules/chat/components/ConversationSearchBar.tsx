'use client'

import * as React from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useTCount } from './plurals'
import { useChatSearch } from './hooks'

export type ConversationSearchBarProps = {
  conversationId: string
  /** Bring a message into view; the same call pin navigation makes. */
  onJumpToMessage: (messageId: string, options?: { focus?: boolean; flash?: boolean }) => void
  /**
   * What the transcript should mark, and which match is current.
   *
   * Reported from the debounced query rather than the field, so the marks
   * settle with the results instead of flickering on every keystroke.
   */
  onSearchStateChange?: (state: { query: string; currentMessageId: string | null }) => void
  onClose: () => void
}

/**
 * Find something in the conversation you are reading.
 *
 * Deliberately not a results list. Within one conversation the useful shape is
 * the browser's own find bar -- a count and a way to step through matches --
 * because the reader wants the message in its context, not a summary of it
 * somewhere else. Stepping reuses the pin-navigation jump, so a match from
 * years back loads its window and scrolls to itself with no new machinery.
 *
 * Distinct from the cross-conversation search in placement, wording and scope:
 * this one lives in the conversation header and says so.
 */
export function ConversationSearchBar({
  conversationId,
  onJumpToMessage,
  onSearchStateChange,
  onClose,
}: ConversationSearchBarProps) {
  const t = useT()
  const tc = useTCount()
  const [term, setTerm] = React.useState('')
  /**
   * Which match the reader is on, or -1 for "not yet anywhere".
   *
   * Typing reports how many matches there are and moves nothing. Every chat
   * client works this way — Telegram counts and waits for an arrow, WhatsApp,
   * Messenger and Google Chat show a list and wait for a tap — because the
   * transcript is what you are reading, and hauling it somewhere new on each
   * keystroke of a half-typed word takes the conversation away from you. The
   * scroll-as-you-type habit belongs to browser find bars, where the page is not
   * also the thing you are composing into.
   */
  const [index, setIndex] = React.useState(-1)
  /**
   * Bumped by every explicit step, and read by the jump effect.
   *
   * Without it, asking to go somewhere the selection already is does nothing at
   * all: `setIndex` to the value it already holds is a no-op, React does not
   * re-render, and an effect that only watches the index never runs. That is
   * exactly the single-match case — stepping wraps to the one match there is —
   * so a lone result was reachable once and then never again.
   */
  const [navigations, setNavigations] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const { results, total, totalIsCapped, activeQuery, isSearching, hasMore, loadMore } =
    useChatSearch({ query: term, conversationId })

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const lastJumped = React.useRef<string | null>(null)

  // A new query starts at the first match rather than holding a position that
  // meant something in the previous result set.
  React.useEffect(() => {
    setIndex(-1)
    lastJumped.current = null
  }, [activeQuery])

  /**
   * Move the selection; the jump itself is the effect below.
   *
   * The first press lands on the first match rather than stepping past it, so
   * "3 matches" followed by one press means match one, not match two. Stepping
   * past the last loaded match fetches the next page rather than wrapping — the
   * count spans every match, so wrapping early would strand the reader partway
   * through a total the bar had told them existed.
   */
  const step = React.useCallback(
    (delta: number) => {
      if (results.length === 0) return
      // Cleared, and the tick bumped, so the jump re-fires even when the
      // selection lands back on the message it was already on.
      lastJumped.current = null
      setNavigations((count) => count + 1)
      if (index < 0) {
        // Entering from either end: forward starts at the first match, back
        // starts at the last, so "previous" from a standing start does not
        // quietly mean the same thing as "next".
        setIndex(delta < 0 ? results.length - 1 : 0)
        return
      }
      const next = index + delta
      if (next < 0) {
        setIndex(results.length - 1)
        return
      }
      if (next >= results.length) {
        if (hasMore) {
          void loadMore()
          // Selected now, jumped to when the page arrives.
          setIndex(next)
          return
        }
        setIndex(0)
        return
      }
      setIndex(next)
    },
    [index, results.length, hasMore, loadMore],
  )

  /**
   * Bring the selected match into view.
   *
   * Driven from the selection rather than from the click, so a match that only
   * became available once a further page loaded is landed on exactly the same
   * way as one that was already there.
   *
   * Never takes focus: the reader is typing, and moving the caret into the
   * transcript sends the rest of the word there too.
   */
  React.useEffect(() => {
    if (index < 0) return
    const match = results[index]
    if (!match || lastJumped.current === match.messageId) return
    lastJumped.current = match.messageId
    // No flash either: the matched words are marked in place, and the one being
    // stood on is marked more strongly, so a ring around the whole bubble would
    // be a second answer to a question already answered inside the text.
    onJumpToMessage(match.messageId, { focus: false, flash: false })
  }, [index, navigations, results, onJumpToMessage])

  const currentMessageId = index >= 0 ? (results[index]?.messageId ?? null) : null
  React.useEffect(() => {
    onSearchStateChange?.({ query: activeQuery, currentMessageId })
  }, [activeQuery, currentMessageId, onSearchStateChange])

  // Closing the bar clears the marks; leaving them behind would leave the
  // transcript wearing the answer to a question nobody is asking any more.
  React.useEffect(
    () => () => onSearchStateChange?.({ query: '', currentMessageId: null }),
    [onSearchStateChange],
  )

  const hasQuery = activeQuery.length > 0
  // Clamped: while a further page is in flight the selection can briefly sit
  // past what is loaded, and a counter reading past its own total looks broken.
  const position = Math.min(index + 1, total)
  const countLabel =
    index < 0
      ? // Before navigating, how many there are — not a position the reader has
        // not travelled to. The cap is reported as such rather than as an exact
        // number the search never actually counted to.
        totalIsCapped
        ? t('chat.search.matchCountCapped', '{count}+ matches', { count: total })
        : tc('chat.search.matchCount', total, '{count} matches')
      : totalIsCapped
        ? t('chat.search.countCapped', '{position} of {total}+', { position, total })
        : t('chat.search.count', '{position} of {total}', { position, total })

  return (
    // A band of its own between the header and the transcript. No `border-t`:
    // the header already draws a rule along that edge, and a second one under it
    // read as a single thick line. The bottom rule is what separates the bar
    // from the messages it is searching.
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
      <SearchInput
        ref={inputRef}
        value={term}
        onChange={setTerm}
        // A distinct accessible name. A second box named "Search" would collide
        // with the global one for anyone navigating by role.
        placeholder={t('chat.search.inConversation', 'Search this conversation')}
        size="sm"
        // Boxed, and only as wide as a query needs. Stretched across the pane it
        // left the caret at one end and the controls at the other with a stretch
        // of nothing between them, and nothing said where the field ended.
        //
        // `min-w-0` so it is the part that gives: it is the only flexible thing
        // in the row, and at a phone's width a field that refuses to shrink
        // pushes the close button off the screen.
        className="min-w-0 flex-1 max-w-xs"
        loading={isSearching}
        onKeyDown={(event) => {
          // Enter steps forward, Shift+Enter back — the find-bar convention,
          // and the one people already have in their fingers.
          if (event.key === 'Enter') {
            event.preventDefault()
            step(event.shiftKey ? -1 : 1)
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      />

      {hasQuery ? (
        <span
          // Beside the field rather than adrift between the two groups: the
          // count belongs to what was typed, so it reads as part of it.
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
          // Announced politely so a screen-reader user learns the result count
          // without the focus leaving the field they are typing in.
          role="status"
          aria-live="polite"
        >
          {isSearching && results.length === 0
            ? t('chat.search.searching', 'Searching…')
            : countLabel}
        </span>
      ) : null}

      {/* Stepping is one control in two halves, so the pair sits tight together
          and apart from dismissal — which belongs at the far edge, where a
          reader already looks to close something. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          variant="ghost"
          size="sm"
          disabled={results.length === 0}
          onClick={() => step(-1)}
          aria-label={t('chat.search.previous', 'Previous match')}
        >
          <ChevronUp className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          disabled={results.length === 0}
          onClick={() => step(1)}
          aria-label={t('chat.search.next', 'Next match')}
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </IconButton>
      </div>

      <IconButton
        variant="ghost"
        size="sm"
        className="ml-auto shrink-0"
        onClick={onClose}
        aria-label={t('chat.search.close', 'Close search')}
      >
        <X className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}
