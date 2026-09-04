"use client"

import * as React from 'react'
import { ArrowDown, MessageSquare, Quote } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatMessageDto } from '../data/types'
import { formatDateSeparator, formatFullTimestamp, formatTimeOfDay, isSameDay } from './format'

export type PendingMessage = {
  clientMessageId: string
  body: string
  createdAt: string
  failed: boolean
  /** Carried so a retry re-sends the same reply rather than a bare message. */
  replyToMessageId?: string
  /** Enough to draw the quote before the server has echoed the message back. */
  replyToAuthorName?: string
  replyToBody?: string
}

export type ReplyRequest = {
  messageId: string
  authorName: string
  body: string
}

type MessageListProps = {
  messages: ChatMessageDto[]
  pending: PendingMessage[]
  currentUserId: string
  /** The space's name, or the other person's — resolved by the server for both. */
  conversationTitle: string
  /**
   * In a space, a message can be from any of several people, so each turn is
   * labelled with its own author. A direct has exactly two, and the alignment
   * already says which — so the label would be noise.
   */
  isSpace: boolean
  /** Absent for a read-only member: there is no Reply action to offer them. */
  onReply?: (target: ReplyRequest) => void
  isLoading: boolean
  hasOlder: boolean
  isLoadingOlder: boolean
  /** A page-fetch failed; the transcript stays, the load-more button says so. */
  loadOlderFailed?: boolean
  /**
   * The read cursor as it stood when this conversation was opened, not as it
   * stands now. Marking-as-read fires seconds later, so reading it live would
   * erase the "New" divider the moment it became useful.
   */
  unreadSince?: string | null | undefined
  /**
   * How far the other person has read. Everything you sent at or before this is
   * read; anything after it is delivered but unseen. `null` means they have
   * never opened the conversation.
   */
  counterpartLastReadAt?: string | null
  onLoadOlder: () => void
  onRetryPending: (clientMessageId: string) => void
}

/**
 * Messages from one person, close together in time, read as a single turn.
 * Five minutes is the window every major client converged on — long enough that
 * a paused sentence stays one turn, short enough that picking a conversation
 * back up an hour later reads as new.
 */
const GROUPING_WINDOW_MS = 5 * 60 * 1000

/** Far enough from the bottom that new messages could land unseen. */
const FOLLOW_THRESHOLD_PX = 160

/**
 * The transcript's vertical rhythm, in one place.
 *
 * Margins are additive in a flex column — they do not collapse — so spacing has
 * to be owned by exactly one element per boundary. Scattering `mt-*` across rows
 * *and* `my-*` across dividers gave a day separator 16px above it and 28px
 * below: its own margin plus the following row's. Here each row declares only
 * its own top gap, dividers own both of theirs, and a row that follows a divider
 * declares none.
 */
const TOP_GAP = {
  /** First row, or the row directly under a divider that already spaced it. */
  none: '',
  /** Same person, still mid-turn. */
  tight: 'mt-0.5',
  /** A new turn: different sender, or the same one after the grouping window. */
  turn: 'mt-4',
} as const

type TopGap = keyof typeof TOP_GAP

/**
 * Scrolling is driven through the container's own `scrollTop` rather than
 * `scrollIntoView` on a sentinel.
 *
 * `scrollIntoView` aligns to the *padding* edge, so a zero-height marker under a
 * `py-3` scroller stops short of the true bottom — and it walks up the tree,
 * scrolling every scrollable ancestor it finds. `main` became one of those when
 * fill pages were pinned to the viewport, so the page could shift underneath the
 * transcript. Setting `scrollTop` touches this element and nothing else, and the
 * browser clamps it to the real maximum.
 */
function scrollToBottom(container: HTMLElement, behavior: ScrollBehavior = 'auto') {
  container.scrollTo({ top: container.scrollHeight, behavior })
}

/** Bring `target` to the top of `container`, measured between the two. */
function scrollToTopOf(container: HTMLElement, target: HTMLElement) {
  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top
  container.scrollTo({ top: container.scrollTop + offset, behavior: 'auto' })
}

/** Dividers own the space on both sides, so the rows around them add none. */
const DIVIDER_GAP = 'my-4'

type Row =
  | { kind: 'separator'; key: string; label: string; first: boolean }
  | { kind: 'unread'; key: string; first: boolean }
  | { kind: 'system'; key: string; message: ChatMessageDto; topGap: TopGap }
  | {
      kind: 'message'
      key: string
      message: ChatMessageDto
      mine: boolean
      /** First of a run: carries the avatar and the author line. */
      startsGroup: boolean
      topGap: TopGap
    }
  | { kind: 'pending'; key: string; pending: PendingMessage; topGap: TopGap }

function MessageListSkeleton() {
  return (
    <div className="space-y-5 px-4 py-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3">
          <Skeleton shape="circle" className="size-7" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className={cn('h-3', row === 1 ? 'w-2/3' : 'w-1/2')} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The per-message menu.
 *
 * `RowActions` is the product's own overflow menu — it already owns the portal,
 * the outside-click and Escape handling, the flip when there is no room below,
 * and returning focus to the trigger. Rebuilding that here to gain a vertical
 * ellipsis instead of a horizontal one would be a worse trade.
 *
 * Reply is absent rather than disabled for a read-only member: a permanently
 * greyed entry in a two-item menu answers a question nobody asked. The clipboard
 * write can be refused (an insecure origin, a denied permission), so that
 * failure is swallowed rather than left as an entry that silently does nothing
 * on some machines.
 */
function MessageMenu({ body, onReply }: { body: string; onReply?: () => void }) {
  const t = useT()
  return (
    <RowActions
      items={[
        ...(onReply
          ? [{ id: 'reply', label: t('chat.reply.action', 'Reply'), onSelect: onReply }]
          : []),
        {
          id: 'copy',
          label: t('chat.messages.copy', 'Copy message'),
          onSelect: () => navigator.clipboard?.writeText(body).catch(() => undefined),
        },
      ]}
    />
  )
}

/**
 * The quote above a reply.
 *
 * A bordered card carrying a quote glyph, the original author and up to three
 * lines of what they said — the shape Google Chat uses, because it reads as a
 * quotation rather than as the first paragraph of the reply. It sits on its own
 * surface inside the bubble, so the reply's own text is clearly the message and
 * this is clearly context.
 *
 * The body is clamped in CSS rather than cut server-side. Three *rendered* lines
 * is the thing worth bounding, and only the browser knows how many characters
 * that is at the reader's pane width — a character count would truncate a short
 * wide line and let a long narrow one run.
 *
 * Clickable only when the original is currently loaded. The transcript pages
 * backwards through history, so a quote of something far above may reference a
 * message that is not in the DOM; a link that scrolls nowhere is worse than
 * plain text, so that case renders inert. Where it can navigate, it uses the
 * `data-message-id` anchor the transcript already carries for scroll
 * restoration.
 */
function ReplyQuote({
  authorName,
  body,
  onJump,
}: {
  authorName: string
  body: string
  onJump?: () => void
}) {
  const t = useT()
  const missing = body.length === 0

  const content = (
    <>
      <span className="flex items-center gap-1.5">
        {/* Structural, not decorative: it is what says "quotation" before any
            text is read. Token-coloured rather than Google's brand pink. */}
        <Quote className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate text-xs font-semibold text-foreground">{authorName}</span>
      </span>
      {/* `line-clamp-3` needs the text to wrap, so no `truncate` here — that
          would pin it to one line and the clamp would never engage. */}
      <span
        className={cn(
          'mt-0.5 block whitespace-pre-wrap break-words text-xs',
          missing ? 'italic text-muted-foreground' : 'line-clamp-3 text-foreground',
        )}
      >
        {missing ? t('chat.reply.unavailable', 'Original message unavailable') : body}
      </span>
    </>
  )

  // `bg-surface` on top of the bubble's own fill, the way Google puts a white
  // card on a grey message — it separates quotation from reply without a second
  // border weight.
  const shell = 'mb-1.5 block w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left'
  if (!onJump) return <span className={shell}>{content}</span>

  return (
    <button
      type="button"
      onClick={onJump}
      className={cn(shell, 'transition-colors hover:bg-surface-muted')}
    >
      {content}
    </button>
  )
}

/**
 * The transcript.
 *
 * Message bodies are rendered as text nodes with `whitespace-pre-wrap`, never as
 * HTML — a message is exactly the characters that were typed, so there is no
 * markup path for someone to smuggle anything through.
 *
 * Laid out as opposing bubbles: yours on the right, everyone else's on the
 * left with an avatar. Consecutive messages from one person collapse into a
 * turn, so a fast back-and-forth is a conversation rather than a wall of
 * repeated names.
 *
 * The same transcript renders a direct conversation and a space. A space labels
 * every incoming turn with its author, because it can be any of several people;
 * a direct does not, because the alignment already says which of the two it was.
 * Membership events render as a centred line rather than a bubble — they belong
 * to the room, not to a speaker.
 */
export function MessageList({
  messages,
  pending,
  currentUserId,
  conversationTitle,
  isSpace,
  onReply,
  isLoading,
  hasOlder,
  isLoadingOlder,
  loadOlderFailed,
  unreadSince,
  counterpartLastReadAt,
  onLoadOlder,
  onRetryPending,
}: MessageListProps) {
  const t = useT()
  const locale = useLocale()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const unreadDividerRef = React.useRef<HTMLLIElement>(null)
  const [atBottom, setAtBottom] = React.useState(true)
  const contentRef = React.useRef<HTMLDivElement>(null)
  /**
   * Whether the reader is pinned to the newest message. Kept in a ref as well as
   * state because the resize observer below reads it outside React's render.
   */
  const stuckToBottom = React.useRef(true)

  const separatorLabels = React.useMemo(
    () => ({ today: t('chat.date.today', 'Today'), yesterday: t('chat.date.yesterday', 'Yesterday') }),
    [t],
  )

  /**
   * A membership event as a sentence.
   *
   * Built from the event and the two names rather than read out of the message
   * body, so the same row reads correctly in all five locales and follows a
   * later rename instead of freezing whatever the person was called that day.
   */
  const systemLine = React.useCallback(
    (message: ChatMessageDto): string => {
      const actor = message.senderUserId === currentUserId
        ? t('chat.messages.you', 'You')
        : message.senderName
      const target = message.systemTargetName ?? ''
      switch (message.systemEvent) {
        case 'member_added':
          return t('chat.system.memberAdded', '{actor} added {target}', { actor, target })
        case 'member_removed':
          return t('chat.system.memberRemoved', '{actor} removed {target}', { actor, target })
        case 'member_left':
          return t('chat.system.memberLeft', '{actor} left the space', { actor })
        case 'space_renamed':
          return t('chat.system.spaceRenamed', '{actor} renamed the space to {title}', {
            actor,
            title: message.body,
          })
        default:
          // An event this build does not know about — a row written by a newer
          // deploy against the same database. Rendering nothing beats rendering
          // a raw enum value at the reader.
          return ''
      }
    },
    [currentUserId, t],
  )

  /**
   * Scroll to the message a quote refers to, when it is on screen.
   *
   * Returns whether it could, so the quote can decide between a button and inert
   * text — a link that scrolls nowhere is worse than no link.
   */
  const jumpToMessage = React.useCallback((messageId: string) => {
    const container = scrollRef.current
    if (!container) return
    const target = container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
    if (!target) return
    scrollToTopOf(container, target)
    // A brief ring rather than a persistent highlight: it answers "which one?"
    // and then gets out of the way, and it needs no cleanup state.
    target.classList.add('ring-2', 'ring-primary', 'rounded-xl')
    setTimeout(() => target.classList.remove('ring-2', 'ring-primary', 'rounded-xl'), 1200)
  }, [])

  const loadedMessageIds = React.useMemo(
    () => new Set(messages.map((message) => message.id)),
    [messages],
  )

  /**
   * The receipt hangs off the newest message you sent, not every one of them.
   *
   * A tick per message is how a two-party mobile client does it; in a workplace
   * transcript it repeats the same fact on every line. One marker under the last
   * of your messages says exactly as much — everything above it shares the same
   * state — and is what Google Chat settled on.
   *
   * `kind === 'user'` matters. A membership event carries YOUR id as its actor,
   * so adding someone to a space made the newest thing you had "sent" a system
   * row — and system rows render as a centred line with no receipt, so the
   * receipt silently disappeared from the whole conversation until you typed
   * again.
   */
  const lastOwnMessageId = React.useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!
      if (message.kind === 'user' && message.senderUserId === currentUserId) return message.id
    }
    return null
  }, [currentUserId, messages])

  const rows = React.useMemo<Row[]>(() => {
    const result: Row[] = []
    // `null` is "never read this conversation", not "nothing is new" — so the
    // divider belongs above the first message someone else sent. `undefined` is
    // the different case of not knowing yet, and suppresses it.
    const unreadCutoff =
      unreadSince === undefined ? null : unreadSince === null ? -Infinity : new Date(unreadSince).getTime()
    /**
     * The last message that can START a turn — user messages only.
     *
     * Grouping and day separators are tracked apart on purpose. A membership
     * event must not break Alice's turn in two, so it never becomes `previous`;
     * but it IS a rendered row on a day, so leaving it out of the day tracking
     * as well would print a second separator for the same date as soon as a real
     * message followed it.
     */
    let previous: ChatMessageDto | null = null
    let lastRenderedDay: Date | null = null
    let unreadMarked = false

    for (const message of messages) {
      const createdAt = new Date(message.createdAt)
      const sameDay = lastRenderedDay !== null && isSameDay(lastRenderedDay, createdAt)

      if (!sameDay) {
        result.push({
          kind: 'separator',
          key: `sep-${message.id}`,
          label: formatDateSeparator(locale, createdAt, separatorLabels),
          first: result.length === 0,
        })
        lastRenderedDay = createdAt
      }

      // A membership event belongs to the room, not to a speaker: it gets its
      // own centred row, never groups with the messages around it, and is not
      // counted as unread — matching the server, which excludes it from the
      // unread predicate for the same reason.
      if (message.kind === 'system') {
        result.push({
          kind: 'system',
          key: message.id,
          message,
          topGap: result.length === 0 ? 'none' : 'turn',
        })
        continue
      }

      // The divider belongs above the first message the reader had not seen —
      // and only for messages someone else sent, since your own never arrive
      // unread.
      const isUnread =
        unreadCutoff !== null &&
        message.senderUserId !== currentUserId &&
        createdAt.getTime() > unreadCutoff
      if (isUnread && !unreadMarked) {
        result.push({ kind: 'unread', key: `unread-${message.id}`, first: result.length === 0 })
        unreadMarked = true
      }

      const continuesGroup =
        previous !== null &&
        isSameDay(new Date(previous.createdAt), createdAt) &&
        previous.senderUserId === message.senderUserId &&
        createdAt.getTime() - new Date(previous.createdAt).getTime() < GROUPING_WINDOW_MS &&
        // A turn cannot continue across the unread divider, or the divider would
        // sit inside a group with no avatar beneath it — nor across a membership
        // line, which would leave Alice's second bubble headerless under a row
        // that is not hers.
        result[result.length - 1]?.kind !== 'unread' &&
        result[result.length - 1]?.kind !== 'system'

      const precededByDivider =
        result.length > 0 &&
        (result[result.length - 1]!.kind === 'separator' || result[result.length - 1]!.kind === 'unread')

      result.push({
        kind: 'message',
        key: message.id,
        message,
        mine: message.senderUserId === currentUserId,
        startsGroup: !continuesGroup,
        topGap:
          result.length === 0 || precededByDivider ? 'none' : continuesGroup ? 'tight' : 'turn',
      })
      previous = message
    }

    for (const item of pending) {
      // An unsent message continues your own turn only when the message above it
      // is also yours; after the other person's, it starts a new one like any
      // other message would.
      const last = result[result.length - 1]
      const continuesOwnTurn =
        last !== undefined && (last.kind === 'pending' || (last.kind === 'message' && last.mine))
      result.push({
        kind: 'pending',
        key: `pending-${item.clientMessageId}`,
        pending: item,
        topGap: result.length === 0 ? 'none' : continuesOwnTurn ? 'tight' : 'turn',
      })
    }
    return result
  }, [currentUserId, locale, messages, pending, separatorLabels, unreadSince])

  // Follow the conversation as it grows, but only when the reader is already at
  // the bottom — yanking someone back down while they are reading history is
  // worse than letting a new message arrive off-screen.
  const messageCount = messages.length + pending.length
  // Starts at zero, not at the current count. Seeding it from `messageCount`
  // meant a conversation React Query already had cached mounted with the ref
  // already equal to it, so the "did it grow?" test was false on the very first
  // render and the transcript was never positioned at all — it just sat at the
  // top. Positioning is owned by `positioned` below instead of being inferred
  // from a count transition that only happens on a cold load.
  const previousCount = React.useRef(0)
  /** Whether this mount has placed the transcript yet. One conversation, once. */
  const positioned = React.useRef(false)
  /**
   * The message the reader is looking at, and where it sits.
   *
   * Held as an element rather than a distance, because distance is not stable
   * under the changes this list actually makes. The transcript window is the
   * newest page, so an arriving message *drops the oldest row* as well as adding
   * one: content is removed above the viewport and added below it in the same
   * update. Preserving the distance from the bottom moved the reader by a row;
   * preserving the distance from the top would move them by the other row. Only
   * "put this message back where it was" survives both — and it covers loading
   * older history too, which is the same problem with the signs reversed.
   *
   * Captured while scrolling rather than at update time: a layout effect already
   * runs after the DOM has changed, so by then the old geometry is gone.
   */
  const readingAnchor = React.useRef<{ id: string; top: number } | null>(null)

  const captureAnchor = React.useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const containerTop = container.getBoundingClientRect().top
    const rows = container.querySelectorAll<HTMLElement>('[data-message-id]')
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      // The first row still on screen: the one the reader is reading from.
      if (rect.bottom > containerTop) {
        readingAnchor.current = { id: row.dataset.messageId ?? '', top: rect.top - containerTop }
        return
      }
    }
    readingAnchor.current = null
  }, [])

  /**
   * Put the anchored message back where it was, whenever the list changes under
   * a reader who is not at the bottom.
   */
  React.useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container || !positioned.current || stuckToBottom.current) return
    const anchor = readingAnchor.current
    if (!anchor) return
    const row = container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`)
    // The anchored message fell out of the window entirely — there is nothing
    // left to hold on to, so leave the position alone rather than guess.
    if (!row) return
    const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.top
    if (delta !== 0) container.scrollTop += delta
  }, [messages])

  React.useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return

    // Where a conversation opens, decided once per mount and not tied to how the
    // messages arrived — cold from the network, or already in the query cache.
    //
    // Caught up: the newest message, because that is what you came back for.
    // Behind: the first message you have not seen, pinned to the top with the
    // rest below it — landing at the bottom would mean scrolling back up through
    // everything you just missed to find where you left off. Every major client
    // does this, and the divider is already the mark for the place.
    if (!positioned.current && messageCount > 0) {
      positioned.current = true
      previousCount.current = messageCount
      const divider = unreadDividerRef.current
      if (divider) scrollToTopOf(container, divider)
      else scrollToBottom(container)
      return
    }

    // Following the bottom is the observer's job now — it is the only thing that
    // sees the late layout. This effect just keeps the count in step.
    previousCount.current = messageCount
  }, [messageCount])

  const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX
    stuckToBottom.current = near
    setAtBottom(near)
    // Only worth tracking while the reader is away from the bottom; at the
    // bottom the pin owns the position and the anchor would just be noise.
    if (!near) captureAnchor()
  }, [captureAnchor])

  /**
   * Stay pinned to the newest message while the reader is at the bottom.
   *
   * Scrolling once when the message count changes is not enough: the row's final
   * height lands later than the effect does. The read receipt arrives on a
   * subsequent refetch, text rewraps, fonts settle — each grows the content after
   * the scroll target was captured, and a smooth animation aimed at the old
   * target simply stops short. Measured, that left the transcript ~96px from the
   * bottom and it never recovered.
   *
   * Watching the content instead re-pins after every one of those, and only while
   * the reader is actually at the bottom, so it can never yank someone who has
   * scrolled up to read history.
   */
  /**
   * The primary mechanism: re-pin after every render.
   *
   * Everything that grows the transcript late also re-renders it — the message
   * itself, the read receipt arriving on a later refetch, a pending bubble being
   * replaced by the stored one. Running after the render that caused the growth
   * means `scrollHeight` is already final, which a scroll issued from the earlier
   * count effect never was: aimed at a stale height, it stopped ~128px short and
   * stayed there.
   *
   * No dependency array on purpose. It is two reads and at most one write, and
   * writing `scrollTop` does not cause a render, so it cannot loop.
   */
  React.useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container || !positioned.current || !stuckToBottom.current) return
    if (container.scrollHeight - container.scrollTop - container.clientHeight > 0) {
      container.scrollTop = container.scrollHeight
    }
  })

  /**
   * A supplement for growth that no render accompanies — a font finishing
   * loading, the pane itself being resized. Not the primary path: resize
   * observation is tied to the rendering lifecycle, so a suspended or hidden
   * document delivers nothing.
   */
  React.useEffect(() => {
    const container = scrollRef.current
    const content = contentRef.current
    if (!container || !content || typeof ResizeObserver === 'undefined') return
    // Twice: once now, once after the frame commits. A `scrollTop` written from
    // inside the observer is clamped against the maximum the browser has already
    // computed, which is still the pre-growth one — measured, that left a 38px
    // residual. The second write lands after layout settles and closes it.
    let frame = 0
    const pin = () => {
      container.scrollTop = container.scrollHeight
    }
    const observer = new ResizeObserver(() => {
      if (!positioned.current || !stuckToBottom.current) return
      pin()
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(pin)
    })
    observer.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  if (isLoading) return <MessageListSkeleton />

  return (
    // `relative` so the jump-to-latest control can anchor to the transcript
    // rather than to the pane, keeping it clear of the composer.
    <div className="relative min-h-0 flex-1">
      {/* `tabIndex` on a scrollable region is WCAG 2.1.1: a long transcript
          whose only focusable content is a hover action must still be
          scrollable from the keyboard. The role and label make that tab stop
          announce itself as something worth entering. */}
      <div
        ref={scrollRef}
        role="region"
        tabIndex={0}
        aria-label={t('chat.messages.label', 'Messages')}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-3 outline-none focus-visible:shadow-focus"
      >
        {/* A short conversation belongs at the bottom, against the composer, not
            stranded at the top of a tall empty pane. `mt-auto` rather than
            `justify-end`: once the transcript outgrows the viewport the margin
            resolves to zero, where `justify-end` would clip the oldest messages
            out of the scrollable area. */}
        <div ref={contentRef} className="flex min-h-full flex-col">
          <div className="mt-auto">
            {hasOlder ? (
              <div className="mb-4 flex flex-col items-center gap-1">
                {loadOlderFailed ? (
                  <p role="alert" className="text-xs text-status-error-text">
                    {t('chat.messages.loadOlderFailed', "Couldn't load earlier messages.")}
                  </p>
                ) : null}
                <Button type="button" variant="ghost" size="sm" disabled={isLoadingOlder} onClick={onLoadOlder}>
                  {isLoadingOlder
                    ? t('chat.messages.loadingOlder', 'Loading…')
                    : loadOlderFailed
                      ? t('chat.actions.retry', 'Try again')
                      : t('chat.messages.loadOlder', 'Load earlier messages')}
                </Button>
              </div>
            ) : null}

            {rows.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  variant="subtle"
                  size="sm"
                  icon={<MessageSquare className="size-5" aria-hidden="true" />}
                  title={t('chat.messages.emptyTitle', 'No messages yet')}
                  description={
                    isSpace
                      ? t('chat.messages.emptySpaceDescription', 'Start the conversation in {name}.', {
                          name: conversationTitle,
                        })
                      : t('chat.messages.emptyDescription', 'Say hello to {name}.', {
                          name: conversationTitle,
                        })
                  }
                />
              </div>
            ) : null}

            {/* `aria-live` so an incoming message is announced. Without it the core
                interaction of a chat client is silent for a screen-reader user. */}
            <ol className="flex flex-col" aria-live="polite" aria-relevant="additions">
              {rows.map((row) => {
                if (row.kind === 'system') {
                  // Centred, muted, no bubble and no avatar: it is a note about
                  // the room. The sentence is assembled here from translations
                  // and the names the server resolved, so it reads correctly in
                  // every locale and stays right when someone is renamed.
                  return (
                    <li
                      key={row.key}
                      data-message-id={row.message.id}
                      className={cn('flex justify-center px-2', TOP_GAP[row.topGap])}
                    >
                      {/* The sentence alone. Each of these used to be prefixed
                          with its own clock, so three membership changes in a row
                          read as three timestamps before three facts — and the
                          time of an administrative event is rarely what you are
                          looking for. It stays in the tooltip. */}
                      <p
                        className="max-w-full truncate text-xs text-muted-foreground"
                        title={formatFullTimestamp(locale, new Date(row.message.createdAt))}
                      >
                        {systemLine(row.message)}
                      </p>
                    </li>
                  )
                }

                if (row.kind === 'separator') {
                  return (
                    // The label alone, centred. It used to be flanked by two
                    // full-width hairlines, which drew a pair of rules across the
                    // pane for something that only needs to be findable while
                    // scanning — the date is already the only centred, uppercase
                    // thing in a column of left- and right-aligned bubbles.
                    <li
                      key={row.key}
                      // A stable hook for "this row is a date separator". The
                      // count used to be asserted by counting hairline spans,
                      // which tied the test to the decoration rather than to the
                      // thing being counted.
                      data-row="separator"
                      className={cn('flex justify-center', row.first ? 'mb-4' : DIVIDER_GAP)}
                    >
                      <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
                        {row.label}
                      </span>
                    </li>
                  )
                }

                if (row.kind === 'unread') {
                  // Colour alone would not carry this, so the divider is labelled.
                  return (
                    <li
                      key={row.key}
                      // The anchor a conversation opens on when the reader is
                      // behind. See the first-paint effect above.
                      ref={unreadDividerRef}
                      className={cn('flex items-center gap-3', row.first ? 'mb-4' : DIVIDER_GAP)}
                    >
                      <span className="h-px flex-1 bg-status-error-border" aria-hidden="true" />
                      <span className="text-xs font-semibold text-status-error-text">
                        {t('chat.messages.newDivider', 'New')}
                      </span>
                      <span className="h-px flex-1 bg-status-error-border" aria-hidden="true" />
                    </li>
                  )
                }

                if (row.kind === 'pending') {
                  return (
                    // An unsent message is always yours, so it sits on your side
                    // from the moment it appears — it must not jump across the
                    // pane when the server confirms it.
                    <li key={row.key} className={cn('relative flex flex-col items-end pl-10 pr-2', TOP_GAP[row.topGap])}>
                      <div
                        className={cn(
                          'w-fit max-w-[85%] rounded-2xl px-3 py-2 sm:max-w-prose',
                          row.pending.failed
                            ? 'border border-status-error-border bg-status-error-bg'
                            : 'bg-primary-soft opacity-70',
                        )}
                      >
                        {/* The quote is drawn from what the composer knew, so an
                            in-flight reply looks exactly like the sent one it is
                            about to become — never inert-then-quoted. Not
                            clickable: the message it replies to is confirmed,
                            but this bubble is not yet a row anything can anchor
                            to. */}
                        {row.pending.replyToMessageId ? (
                          <ReplyQuote
                            authorName={row.pending.replyToAuthorName ?? ''}
                            body={row.pending.replyToBody ?? ''}
                          />
                        ) : null}
                        <p
                          className={cn(
                            'whitespace-pre-wrap break-words text-sm',
                            row.pending.failed ? 'text-status-error-text' : 'text-foreground',
                          )}
                        >
                          {row.pending.body}
                        </p>
                      </div>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {row.pending.failed ? (
                          <>
                            <span className="text-status-error-text">
                              {t('chat.messages.failed', 'Not sent')}
                            </span>
                            <Button
                              type="button"
                              variant="link"
                              size="2xs"
                              onClick={() => onRetryPending(row.pending.clientMessageId)}
                            >
                              {t('chat.actions.retry', 'Try again')}
                            </Button>
                          </>
                        ) : (
                          t('chat.messages.sending', 'Sending…')
                        )}
                      </p>
                    </li>
                  )
                }

                const createdAt = new Date(row.message.createdAt)
                // The sender's own name, resolved with the page — so a space
                // labels each turn with whoever wrote it rather than with the
                // one counterpart a direct has.
                const author = row.mine ? t('chat.messages.you', 'You') : row.message.senderName
                const fullTimestamp = formatFullTimestamp(locale, createdAt)
                // Read once their cursor reaches this message. `null` cursor is
                // "never opened", which is unread rather than read-at-epoch.
                const counterpartRead = counterpartLastReadAt ? new Date(counterpartLastReadAt) : null
                const readAt =
                  counterpartRead && counterpartRead.getTime() >= createdAt.getTime()
                    ? counterpartRead
                    : null

                return (
                  <li
                    key={row.key}
                    // What the reading anchor holds on to when the list changes
                    // under a reader who has scrolled up.
                    data-message-id={row.message.id}
                    className={cn(
                      // `group/msg` names the hover scope so the action bar reacts to
                      // this row only. `focus-within` is the keyboard equivalent —
                      // without it the menu trigger can be focused but never seen.
                      // No row fill: the bubble already carries the surface, and
                      // tinting the row behind it just muddies both.
                      'group/msg relative flex flex-col',
                      // Side is the primary "who said this". The avatar gutter is
                      // reserved on both sides so the two columns wrap at the same
                      // measure and the bubbles line up against opposite edges.
                      row.mine ? 'items-end pl-10 pr-2' : 'items-start pl-10 pr-2',
                      TOP_GAP[row.topGap],
                    )}
                  >
                    {row.startsGroup ? (
                      <>
                        {/* Only the other person gets an avatar. Yours would repeat
                            what the side already says, and Google Chat drops it for
                            the same reason. */}
                        {row.mine ? null : (
                          <Avatar
                            label={author}
                            size="sm"
                            variant="default"
                            className="absolute left-0 top-6"
                          />
                        )}
                        <p className="mb-1 flex max-w-full items-baseline gap-2">
                          {/* The name is redundant on your own side — the alignment
                              carries it — but a screen reader has no alignment, so it
                              stays as `sr-only`. Sender is never conveyed by position
                              or colour alone. */}
                          <span
                            className={cn(
                              'truncate text-sm font-semibold text-foreground',
                              row.mine && 'sr-only',
                            )}
                          >
                            {author}
                          </span>
                          <time
                            dateTime={row.message.createdAt}
                            title={fullTimestamp}
                            className="shrink-0 text-xs text-muted-foreground"
                          >
                            {formatTimeOfDay(locale, createdAt)}
                          </time>
                        </p>
                      </>
                    ) : null}

                    {/* `w-fit` so a two-word reply is a two-word bubble; the cap
                        stops a long one running the width of the pane.

                        Two caps, because they solve different problems. On a wide
                        pane `max-w-prose` holds the line to a readable measure. On a
                        narrow one 65ch is wider than the pane, so every bubble
                        reached full width and the left/right alignment — the only
                        thing distinguishing sender from recipient — became invisible.
                        The proportional cap keeps the asymmetry legible on a phone. */}
                    {/* The bubble and its actions share one box, sized to the
                        bubble. That is what lets the bar anchor to the message
                        rather than to the row: parked at the row's outer margin it
                        drifted far away from a short reply and read as belonging to
                        the column instead of to the thing it acts on. */}
                    <div className="relative w-fit max-w-[85%] sm:max-w-prose">
                      <div
                        className={cn(
                          'rounded-2xl px-3 py-2',
                          row.mine ? 'bg-primary-soft' : 'bg-surface-muted',
                        )}
                      >
                        {/* Inside the bubble, above the text: the quote is part
                            of this message, and floating it outside would make
                            the reply look like two rows. */}
                        {row.message.replyTo ? (
                          <ReplyQuote
                            authorName={
                              row.message.replyTo.senderUserId === currentUserId
                                ? t('chat.messages.you', 'You')
                                : row.message.replyTo.senderName
                            }
                            body={row.message.replyTo.body}
                            // A button only when the original is actually in the
                            // DOM. Paging backwards means an old original may not
                            // be, and offering a jump that does nothing is the
                            // dead end this avoids.
                            onJump={
                              !row.message.replyTo.deleted &&
                              loadedMessageIds.has(row.message.replyTo.id)
                                ? () => jumpToMessage(row.message.replyTo!.id)
                                : undefined
                            }
                          />
                        ) : null}
                        <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                          {row.message.body}
                        </p>
                      </div>

                      {/* Metadata and actions share one floating bar, revealed on
                          hover or keyboard focus, sitting just above the bubble's
                          own top edge rather than beside it — so it never covers
                          the message, and a short one still gets its controls
                          within reach.

                          It carries the timestamp too: a grouped message has no
                          header of its own, and the alternative — a time in the
                          40px avatar gutter — does not fit a 12-hour locale.

                          The outer element is a POSITIONER whose padding is a hit
                          bridge; the inner one is the visible chrome. They are
                          separate because the gap between the bar and the bubble
                          has to be reachable, not merely empty — see below. */}
                      <div
                        className={cn(
                          // Anchored to the bubble's own top edge, and the padding
                          // below the chrome is a HIT BRIDGE rather than spacing.
                          //
                          // Parked at a fixed `-top-10` this bar was ~2px clear of
                          // the bubble, and those 2px belonged to the message
                          // ABOVE. Moving the pointer up to the bar therefore left
                          // this row, which dropped `:hover`, which hid the bar —
                          // so the only way to press it was to cross the dead band
                          // fast enough to land on the bar in a single pointer
                          // sample. Every slower path handed the hover to the
                          // neighbour instead.
                          //
                          // `bottom-full` glues the box's bottom edge to the top of
                          // the bubble and `-mb-px` laps it by one pixel, so the
                          // padding runs continuously from the chrome down into the
                          // message. The pointer travels from bubble to button
                          // without ever crossing a pixel this row does not own,
                          // and because the box is a DOM descendant of the row,
                          // hovering it keeps `:hover` on the row — the bar stays up
                          // for as long as you are heading towards it.
                          'pointer-events-none absolute bottom-full z-10 -mb-px pb-1.5',
                          'opacity-0 transition-opacity',
                          'focus-within:pointer-events-auto focus-within:opacity-100',
                          'group-hover/msg:pointer-events-auto group-hover/msg:opacity-100',
                          'group-focus-within/msg:pointer-events-auto group-focus-within/msg:opacity-100',
                          // Pinned to the bubble edge nearest the pane wall, so the
                          // bar opens *inwards*. Anchoring the near edge instead
                          // pushed it outwards: a short bubble against the right
                          // wall sent an 83px bar 20px past the scroller, and
                          // because `overflow-y-auto` promotes `overflow-x` to
                          // `auto`, that produced a horizontal scrollbar across
                          // the whole transcript.
                          row.mine ? 'right-0' : 'left-0',
                        )}
                      >
                        <div className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-surface px-1 py-0.5 shadow-sm">
                        {/* Only where the row has no header of its own. A group
                            start already prints the time beside the author, and
                            repeating it put the same clock twice within 20px. */}
                        {row.startsGroup ? null : (
                          <time
                            dateTime={row.message.createdAt}
                            title={fullTimestamp}
                            className="px-1 text-xs text-muted-foreground"
                          >
                            {formatTimeOfDay(locale, createdAt)}
                          </time>
                        )}
                        <MessageMenu
                          body={row.message.body}
                          onReply={
                            onReply
                              ? () =>
                                  onReply({
                                    messageId: row.message.id,
                                    authorName: row.mine
                                      ? t('chat.messages.you', 'You')
                                      : row.message.senderName,
                                    body: row.message.body,
                                  })
                              : undefined
                          }
                        />
                        </div>
                      </div>
                    </div>

                    {/* The receipt, on the newest message you sent.
                        "Delivered" is the moment the server stored it — that is
                        the only delivery this system actually observes, so it is
                        the message's own timestamp rather than an invented
                        second one. "Read" comes from the other person's cursor
                        passing this message. The full pair is in the `title`, so
                        the line stays one short phrase. */}
                    {row.mine && row.message.id === lastOwnMessageId ? (
                      <p
                        className="mt-1 text-xs text-muted-foreground"
                        title={
                          readAt
                            ? t('chat.receipt.detail', 'Delivered at {delivered} · Read at {read}', {
                                delivered: fullTimestamp,
                                read: formatFullTimestamp(locale, readAt),
                              })
                            : t('chat.receipt.deliveredDetail', 'Delivered at {delivered}', {
                                delivered: fullTimestamp,
                              })
                        }
                      >
                        {readAt
                          ? t('chat.receipt.read', 'Read {time}', {
                              time: formatTimeOfDay(locale, readAt),
                            })
                          : t('chat.receipt.delivered', 'Delivered {time}', {
                              time: formatTimeOfDay(locale, createdAt),
                            })}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      </div>

      {/* Only offered when it does something: at the bottom already, it is not
          rendered rather than rendered inert. */}
      {!atBottom && rows.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-events-auto shadow-sm"
            onClick={() => {
              const container = scrollRef.current
              if (container) scrollToBottom(container, 'smooth')
            }}
          >
            <ArrowDown className="size-4" aria-hidden="true" />
            {t('chat.messages.jumpToLatest', 'Jump to latest')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
