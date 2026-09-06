"use client"

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, ChevronRight, Pin, Search, Users } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useTCount } from './plurals'
import type { ChatMessageDto } from '../data/types'
import { MessageComposer, type MentionCandidate } from './MessageComposer'
import { MessageList, MessageListSkeleton, type PendingMessage } from './MessageList'
import { PinnedMessagesPanel } from './PinnedMessagesPanel'
import { ConversationSearchBar } from './ConversationSearchBar'
import { highlightPlan, parseSearchQuery } from '../lib/searchQuery'
import { TranslateControl } from './TranslateControl'
import { SpaceDetailsDialog } from './SpaceDetailsDialog'
import {
  useCanSendChat,
  useChatLocale,
  useChatTranslation,
  useConversation,
  useMarkRead,
  useMessageEngagement,
  useMessages,
  useSendMessage,
  useSpaceMembers,
} from './hooks'

/** What the composer is replying to, as the view holds it. */
export type ReplyTarget = {
  messageId: string
  authorName: string
  body: string
}

export type ConversationViewProps = {
  conversationId: string
  currentUserId: string
  /** Rendered on narrow viewports, where the list and the conversation are separate screens. */
  showBackToList?: boolean
}

const logger = createLogger('chat').child({ component: 'ConversationView' })

/**
 * Long enough that a typist does not fire a request per keystroke, short enough
 * that the menu still feels live. The same window the member picker uses.
 */
const MENTION_SEARCH_DEBOUNCE_MS = 250

/**
 * How much of a scrolled-back transcript whole-conversation mode keeps
 * translated.
 *
 * Four pages at the 30-message page size, so a reader who scrolls back a little
 * sees it follow them, and one who scrolls back a long way does not silently
 * queue hundreds of inferences. Above the batch cap so the window is the
 * product decision rather than a side effect of the request limit.
 */
const STICKY_TRANSLATION_WINDOW = 120

function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * The right pane: who you are talking to, the transcript, and the composer.
 *
 * Sending is optimistic *in the transcript only*: the bubble appears greyed
 * immediately so typing feels instant, but it is never treated as stored. When
 * the server confirms, the real message replaces it; when the request fails, the
 * bubble turns into a "Not sent — try again" affordance rather than vanishing.
 * The retry reuses the same `clientMessageId`, so a request that actually
 * committed before the connection dropped is deduplicated server-side instead of
 * posting twice.
 */
export function ConversationView({ conversationId, currentUserId, showBackToList }: ConversationViewProps) {
  const t = useT()
  const tc = useTCount()
  /**
   * The message the transcript is currently centred on.
   *
   * Set only when a jump target is not already loaded — a pin from last month —
   * so the common case of jumping to something on screen costs no request at
   * all.
   */
  const [anchorMessageId, setAnchorMessageId] = React.useState<string | null>(null)

  const { conversation, isLoading: isLoadingConversation, error: conversationError, retry } =
    useConversation(conversationId)
  const {
    messages,
    isLoading: isLoadingMessages,
    isFetching: isFetchingMessages,
    error: messagesError,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    retry: retryMessages,
  } = useMessages(conversationId, anchorMessageId)
  const sendMessage = useSendMessage(conversationId)
  const canSend = useCanSendChat()

  const [pending, setPending] = React.useState<PendingMessage[]>([])
  const [replyTarget, setReplyTarget] = React.useState<ReplyTarget | null>(null)
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const chatLocale = useChatLocale()
  /**
   * Whole-conversation mode. Sticky per conversation: a one-shot covering only
   * what is on screen would look broken the moment the reader scrolled back, or
   * a new message arrived untranslated beside translated ones.
   */
  const [translateAll, setTranslateAll] = React.useState(false)
  React.useEffect(() => setTranslateAll(false), [conversationId])
  /**
   * Only user messages: joins, renames and the rest are system copy the product
   * already renders in the interface language.
   */
  const translatableIds = React.useMemo(
    () =>
      translateAll
        ? messages
            .filter((message) => message.kind === 'user')
            // Sticky means "keep up with the transcript", not "translate the
            // archive". Without a bound, scrolling to the top of a long
            // conversation translated every message in it — each page a real
            // request against a CPU-bound engine, for history the reader
            // scrolled past rather than read. The window is the newest
            // messages, which is where a reader following a conversation
            // actually is; anything older stays one click away on its own row.
            .slice(-STICKY_TRANSLATION_WINDOW)
            .map((message) => message.id)
        : null,
    [translateAll, messages],
  )
  const translation = useChatTranslation(conversationId, chatLocale.locale, translatableIds)

  const [pinsOpen, setPinsOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)

  /**
   * Bring a message into view, loading its window first if it is not on screen.
   *
   * Lifted out of the pin panel's prop so search uses the identical path: a
   * result from three years ago and a pin from three years ago are the same
   * problem, and solving it twice would mean two behaviours to keep in step.
   */
  const jumpToMessage = React.useCallback(
    (messageId: string, options?: { focus?: boolean; flash?: boolean }) => {
      if (!messages.some((message) => message.id === messageId)) {
        setAnchorMessageId(messageId)
      }
      // Held in a ref rather than in state because the re-assert below fires
      // later, once the anchored window has loaded, and has to land the same way
      // the original request asked for — silently focusing there would undo the
      // whole point for a jump that came from someone typing.
      jumpShouldFocus.current = options?.focus ?? true
      jumpShouldFlash.current = options?.flash ?? true
      setJumpTarget(messageId)
    },
    [messages],
  )

  /**
   * Cmd/Ctrl+F opens the conversation find bar.
   *
   * Scoped to this view rather than bound globally, and it only takes over the
   * browser's own find when a conversation is actually open — searching a
   * transcript is what someone means by "find" here, and the browser can only
   * see the page of history that happens to be loaded.
   */
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      setSearchOpen(true)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // A different conversation is a different search.
  React.useEffect(() => setSearchOpen(false), [conversationId])

  /**
   * The message a search result named, if this conversation was opened at one.
   *
   * The id arrives as `?message=`, which is what lets a result from the
   * cross-conversation search open the right thread AND the right point in it
   * — through a real navigation, so back works and the link can be shared.
   */
  const searchParams = useSearchParams()
  const requestedMessageId = searchParams?.get('message') ?? null
  /**
   * A message to bring into view once it is loaded.
   *
   * Set by pin navigation. It cannot scroll immediately: the message may not be
   * in the current window, in which case the transcript first refetches around
   * it, and only then is there something to scroll to.
   */
  const [jumpTarget, setJumpTarget] = React.useState<string | null>(null)
  /** Whether the pending jump should take focus; see `jumpToMessage`. */
  const jumpShouldFocus = React.useRef(true)
  /** Whether the pending jump should flash the row; see `jumpToMessage`. */
  const jumpShouldFlash = React.useRef(true)

  /**
   * What the open find bar wants marked in the transcript.
   *
   * Terms rather than ranges: the transcript renders messages the search
   * response never mentioned, and they have to mark the same words.
   */
  const [searchState, setSearchState] = React.useState<{
    query: string
    currentMessageId: string | null
  }>({ query: '', currentMessageId: null })
  const searchHighlight = React.useMemo(
    () => (searchState.query ? highlightPlan(parseSearchQuery(searchState.query)) : undefined),
    [searchState.query],
  )

  /**
   * A conversation switch must not carry the previous one's unsent drafts — or
   * its reply target, which would otherwise attach this conversation's next
   * message to a message in the last one. The server would refuse that (the
   * reply must be in the same conversation), so the failure would be a confusing
   * 404 on send rather than a silent cross-post; clearing it here means it never
   * gets that far. The details panel closes for the same reason: it describes a
   * space that is no longer on screen.
   */
  React.useEffect(() => {
    setPending([])
    setReplyTarget(null)
    setDetailsOpen(false)
    setPinsOpen(false)
    // Where to land is part of the same decision as what to clear, so it is
    // resolved here rather than in an effect of its own. As two effects the
    // reset ran second on mount and wiped the jump the URL had just asked for,
    // and a shared link opened at the bottom of the conversation instead of at
    // its message. Keyed on the id, so it fires when the destination changes
    // and not on every render — re-running would drag the reader back each
    // time they scrolled away from it.
    // Arriving from a link, nothing else holds the caret, so landing takes it.
    jumpShouldFocus.current = true
    jumpShouldFlash.current = true
    setJumpTarget(requestedMessageId)
    setAnchorMessageId(requestedMessageId)
  }, [conversationId, requestedMessageId])

  /**
   * Land again once the window we asked for has arrived.
   *
   * Opening at a message sets an anchor and a jump together, but the jump is
   * applied to whatever is on screen at that moment — the tail, usually, still
   * cached from the conversation list. Loading the window around the message
   * then replaces every row, and a transcript whose rows all vanished counts as
   * scrolled to the bottom, so the follow-the-bottom rule takes the reader back
   * down. The first landing is real but lands on rows that are about to be
   * discarded; this is the one the reader actually sees.
   *
   * Keyed on the arrival rather than on `messages`, so paging further back
   * afterwards does not drag them here again.
   */
  const anchorLanded =
    Boolean(anchorMessageId) &&
    !isFetchingMessages &&
    messages.some((message) => message.id === anchorMessageId)
  React.useEffect(() => {
    if (anchorLanded) setJumpTarget(anchorMessageId)
  }, [anchorLanded, anchorMessageId])

  const confirmedIds = React.useMemo(
    () => new Set(messages.map((message) => message.clientMessageId).filter(Boolean) as string[]),
    [messages],
  )

  // Once the server's copy of a message arrives, its optimistic twin has done
  // its job. Dropping it here rather than on the mutation's success covers the
  // case where the SSE refetch lands first.
  React.useEffect(() => {
    if (confirmedIds.size === 0) return
    setPending((current) => {
      const next = current.filter((item) => !confirmedIds.has(item.clientMessageId))
      return next.length === current.length ? current : next
    })
  }, [confirmedIds])

  const newestMessage = messages[messages.length - 1] as ChatMessageDto | undefined
  useMarkRead(conversationId, newestMessage, currentUserId)

  /**
   * Where the "New" divider goes, frozen at the moment this conversation opened.
   *
   * `useMarkRead` advances the cursor a beat after the transcript paints, so
   * reading `conversation.lastReadAt` live would move the divider to the bottom
   * and then delete it — the reader would never see the thing it exists to show.
   * Captured once per conversation instead, and `undefined` until the first load
   * resolves so an unopened conversation does not mark everything new.
   */
  const unreadSinceRef = React.useRef<{ id: string; value: string | null } | null>(null)
  if (conversation && unreadSinceRef.current?.id !== conversationId) {
    unreadSinceRef.current = { id: conversationId, value: conversation.lastReadAt }
  }
  // `undefined` while the conversation is still loading, so the transcript does
  // not briefly mark every message new before the cursor is known.
  const unreadSince =
    unreadSinceRef.current?.id === conversationId ? unreadSinceRef.current.value : undefined

  const deliver = React.useCallback(
    async (clientMessageId: string, body: string, replyToMessageId?: string) => {
      try {
        await sendMessage.mutateAsync({ body, clientMessageId, replyToMessageId })
        setPending((current) => current.filter((item) => item.clientMessageId !== clientMessageId))
      } catch (error) {
        setPending((current) =>
          current.map((item) =>
            item.clientMessageId === clientMessageId ? { ...item, failed: true } : item,
          ),
        )
        throw error
      }
    },
    [sendMessage],
  )

  const handleSend = React.useCallback(
    (body: string) => {
      const clientMessageId = newClientMessageId()
      // Captured before the state is cleared, so the retry below still knows
      // what this message was replying to even though the composer has moved on.
      const replyToMessageId = replyTarget?.messageId
      setPending((current) => [
        ...current,
        {
          clientMessageId,
          body,
          createdAt: new Date().toISOString(),
          failed: false,
          replyToMessageId,
          replyToAuthorName: replyTarget?.authorName,
          replyToBody: replyTarget?.body,
        },
      ])
      // Cleared on send rather than on success. The reply is already committed to
      // the pending bubble, and leaving the strip up would invite a second reply
      // to the same message while the first is still in flight.
      setReplyTarget(null)
      // The bubble owns the message from here: a rejection flips it to `failed`
      // and the retry there reuses this same `clientMessageId`. The rejection is
      // already represented in the UI, so it is logged rather than re-thrown.
      void deliver(clientMessageId, body, replyToMessageId).catch((err: unknown) => {
        logger.warn('Sending a chat message failed', { conversationId, clientMessageId, err })
      })
    },
    [conversationId, deliver, replyTarget],
  )

  const handleRetryPending = React.useCallback(
    (clientMessageId: string) => {
      const target = pending.find((item) => item.clientMessageId === clientMessageId)
      if (!target) return
      setPending((current) =>
        current.map((item) => (item.clientMessageId === clientMessageId ? { ...item, failed: false } : item)),
      )
      // Same key AND the same reply target as the first attempt, so a send that
      // committed before the connection dropped is deduplicated rather than
      // posted twice — and a retry never loses the reply it was.
      void deliver(clientMessageId, target.body, target.replyToMessageId).catch((err: unknown) => {
        logger.warn('Retrying a chat message failed', { conversationId, clientMessageId, err })
      })
    },
    [conversationId, deliver, pending],
  )

  const { toggleReaction, setPinned } = useMessageEngagement(conversationId)
  const isSpace = conversation?.kind === 'space'

  /**
   * Who this conversation lets you name.
   *
   * A space offers its members plus `@everyone`; a direct offers nobody, because
   * a picker to choose between the one person already reading it is friction
   * with nothing behind it. The list is the same membership the server validates
   * against, so the menu cannot suggest someone the send would refuse.
   */
  /**
   * What is being typed after an `@`, debounced.
   *
   * The membership endpoint pages at 50, so an unfiltered fetch made everyone
   * past the first page silently unmentionable in a large space — the menu
   * simply never offered them, while the server would have accepted the mention
   * happily. Feeding the query through means the search happens where the whole
   * membership is, and the debounce keeps a fast typist from firing a request
   * per keystroke.
   */
  const [mentionQuery, setMentionQuery] = React.useState('')
  const [debouncedMentionQuery, setDebouncedMentionQuery] = React.useState('')
  React.useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedMentionQuery(mentionQuery.trim()),
      MENTION_SEARCH_DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [mentionQuery])
  const handleMentionQueryChange = React.useCallback((query: string | null) => {
    setMentionQuery(query ?? '')
  }, [])

  const { members } = useSpaceMembers(conversationId, debouncedMentionQuery, Boolean(isSpace))
  const mentionCandidates = React.useMemo<MentionCandidate[]>(() => {
    if (!isSpace) return []
    const people = members
      .filter((member) => member.id !== currentUserId)
      .map((member) => ({
        id: member.id,
        name: member.name,
        kind: 'user' as const,
        subtitle: member.email,
      }))
    return [
      { id: 'everyone', name: t('chat.mentions.everyone', 'everyone'), kind: 'everyone' as const,
        subtitle: t('chat.mentions.everyoneHint', 'Notify everyone in this space') },
      ...people,
    ]
  }, [currentUserId, isSpace, members, t])

  /** Owners in a space; either participant in a direct — matching the server. */
  const canPin = Boolean(conversation) && (!isSpace || conversation?.viewerRole === 'owner')
  // Resolved server-side for both kinds — a space's name, or the other person's.
  const conversationTitle = conversation?.title ?? t('chat.list.unknownPerson', 'Former colleague')
  // Only a DIRECT conversation can become one-way. A space with a departed
  // member is still a live room for everyone else, so it must not disable the
  // composer for them.
  const counterpartLeft =
    Boolean(conversation) && !isSpace && conversation?.counterpart == null

  /**
   * The header renders in every state, including loading and error.
   *
   * It carries the only way back to the list on narrow screens, where the list
   * pane is hidden. Returning early before it — which this component used to do
   * — left a phone user on a broken conversation with no back button, no list,
   * and a "Try again" that for a 404 can never succeed.
   */
  // The header and the find bar are one unit: the bar sits under the header
  // and above the transcript, and every branch below renders `header` — so
  // grouping them here means search appears in the loading and error states
  // too, rather than vanishing the moment a refetch fails.
  const header = (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      {showBackToList ? (
        <IconButton variant="ghost" size="sm" asChild className="lg:hidden">
          <Link href="/backend/chat" aria-label={t('chat.conversation.back', 'Back to conversations')}>
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
        </IconButton>
      ) : null}

      {/* One header for both kinds. A space differs only in its glyph, its
          subtitle and the fact that the whole block is a button — so the two do
          not drift into separate layouts that have to be kept in step. */}
      {(() => {
        const identity = (
          <>
            <Avatar
              label={conversation ? conversationTitle : ''}
              size="sm"
              icon={isSpace ? <Users className="size-4" aria-hidden="true" /> : undefined}
            />
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-semibold text-foreground">
                {conversation ? conversationTitle : t('chat.conversation.loading', 'Loading conversation…')}
              </span>
              {/* Suppressed once the conversation can no longer be read. The
                  cached copy survives a failed refetch, so a member count from
                  before you were removed would sit directly above "Couldn't open
                  this conversation" — the header asserting membership the body
                  is denying. The name stays: it is what you clicked, and losing
                  it too would leave the pane unlabelled. */}
              {conversationError ? null : isSpace && conversation ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {tc('chat.space.memberCount', conversation.memberCount, '{count} members')}
                </span>
              ) : conversation?.counterpart ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {conversation.counterpart.email}
                </span>
              ) : conversation ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {t('chat.conversation.counterpartLeft', 'No longer in this organization')}
                </span>
              ) : null}
            </span>
          </>
        )

        // The header IS the way into the details panel, the way it is in every
        // client people already use — rather than a separate button competing
        // for the same 56px. A direct has no details, so it stays plain text
        // instead of becoming a control that opens nothing.
        return isSpace ? (
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            aria-haspopup="dialog"
            className="-mx-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 outline-none transition-colors hover:bg-surface-muted focus-visible:shadow-focus"
          >
            {identity}
            {/* The header is the way into the details panel, so it needs to look
                like a way in. Without this it was an unmarked click target that
                only revealed itself on hover — discoverable by accident. */}
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="sr-only">{t('chat.space.details', 'Space details')}</span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
        )
      })()}

      {/* Pushes the pin control to the trailing edge, away from the identity. */}
      <span className="flex-1" />

      {conversation ? (
        <IconButton
          variant="ghost"
          size="sm"
          onClick={() => setSearchOpen((open) => !open)}
          aria-expanded={searchOpen}
          aria-label={t('chat.search.openInConversation', 'Search this conversation')}
        >
          <Search className="size-4" aria-hidden="true" />
        </IconButton>
      ) : null}

      {conversation ? (
        <TranslateControl
          locale={chatLocale.locale}
          translatableLocales={chatLocale.translatableLocales}
          // Choosing a language only records the choice. Re-translating the
          // transcript into it is the sticky mode's job, and doing it here as
          // well raced the mode: both paths asked for the same messages, and
          // whichever answered second wrote the other language's words.
          onLocaleChange={(next) => chatLocale.setLocale.mutate(next)}
          active={translateAll}
          busy={translation.pending.size > 0}
          onToggle={(next) => {
            setTranslateAll(next)
            if (!next) for (const message of messages) translation.showOriginal(message.id)
          }}
        />
      ) : null}

      {/* Only when there is something to show. At zero this is not rendered
          rather than rendered disabled: the panel's whole job is to answer
          "what has been pinned here", and a control that opens an empty answer
          is the dead end it exists to avoid. */}
      {conversation && conversation.pinnedCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5 text-muted-foreground"
          onClick={() => setPinsOpen(true)}
        >
          <Pin className="size-4" aria-hidden="true" />
          <span className="tabular-nums">{conversation.pinnedCount}</span>
          <span className="sr-only">{t('chat.pins.open', 'View pinned messages')}</span>
        </Button>
      ) : null}
      </header>
      {searchOpen && conversation ? (
        <ConversationSearchBar
          conversationId={conversationId}
          onJumpToMessage={jumpToMessage}
          onSearchStateChange={setSearchState}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </>
  )

  if (isLoadingConversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        {/* The transcript's own silhouette, not a centred spinner. A spinner in
            the middle of an empty pane says "something is happening somewhere";
            bubbles in the place bubbles will appear say what is coming, and the
            composer stays put instead of arriving late and shifting the page.

            `sr-only` carries the announcement the spinner used to make -- the
            skeletons are decoration, and `Skeleton` is already a polite live
            region, so the label is what a screen reader should hear. */}
        <span className="sr-only" role="status">
          {t('chat.conversation.loading', 'Loading conversation…')}
        </span>
        <MessageListSkeleton />
        <div className="px-4 py-3">
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  if (conversationError || !conversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <ErrorMessage
            label={t('chat.conversation.error', "Couldn't open this conversation")}
            description={t(
              'chat.conversation.errorDescription',
              'It may have been removed, or it may not be yours to read.',
            )}
            action={
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => retry()}>
                  {t('chat.actions.retry', 'Try again')}
                </Button>
                {/* Always offer a way out, not only a retry that a 404 will
                    never satisfy. */}
                <Button type="button" size="sm" asChild>
                  <Link href="/backend/chat">{t('chat.start.backToChat', 'Go to chat')}</Link>
                </Button>
              </div>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}

      {messagesError && messages.length === 0 ? (
        <div className="p-4">
          <ErrorMessage
            label={t('chat.messages.error', "Couldn't load messages")}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => retryMessages()}>
                {t('chat.actions.retry', 'Try again')}
              </Button>
            }
          />
        </div>
      ) : (
        <MessageList
          translations={translation.translations}
          showingTranslation={translation.showing}
          pendingTranslation={translation.pending}
          onTranslate={(messageId) => void translation.translate([messageId])}
          onShowOriginal={translation.showOriginal}
          isAnchored={Boolean(anchorMessageId)}
          onReturnToLatest={() => setAnchorMessageId(null)}
          jumpToMessageId={jumpTarget}
          jumpShouldFocus={jumpShouldFocus.current}
          jumpShouldFlash={jumpShouldFlash.current}
          searchHighlight={searchHighlight}
          currentSearchMessageId={searchState.currentMessageId}
          onJumpHandled={() => setJumpTarget(null)}
          onToggleReaction={
            canSend ? (messageId, emoji) => toggleReaction.mutate({ messageId, emoji }) : undefined
          }
          onTogglePin={
            canSend && canPin
              ? (messageId, pinned) => setPinned.mutate({ messageId, pinned })
              : undefined
          }
          messages={messages}
          pending={pending}
          currentUserId={currentUserId}
          conversationTitle={conversationTitle}
          isSpace={Boolean(isSpace)}
          onReply={canSend ? setReplyTarget : undefined}
          isLoading={isLoadingMessages}
          hasOlder={hasOlder}
          isLoadingOlder={isLoadingOlder}
          loadOlderFailed={Boolean(messagesError)}
          unreadSince={unreadSince}
          counterpartLastReadAt={conversation.counterpartLastReadAt}
          onLoadOlder={() => void loadOlder()}
          onRetryPending={handleRetryPending}
        />
      )}

      <MessageComposer
        disabled={counterpartLeft || !canSend}
        onSend={handleSend}
        replyTarget={replyTarget}
        onCancelReply={() => setReplyTarget(null)}
        mentionCandidates={mentionCandidates}
        onMentionQueryChange={handleMentionQueryChange}
        placeholder={
          !canSend
            ? t('chat.composer.readOnly', 'You do not have permission to send messages')
            : counterpartLeft
              ? t('chat.composer.disabled', 'This person has left the organization')
              : t('chat.composer.placeholder', 'Message {name}', { name: conversationTitle })
        }
      />

      {/* Only when there is something to open. A control that leads to an empty
          panel is the dead end the panel exists to avoid. */}
      {conversation && conversation.pinnedCount > 0 ? (
        <PinnedMessagesPanel
          open={pinsOpen}
          onClose={() => setPinsOpen(false)}
          conversationId={conversationId}
          canUnpin={canPin}
          onJumpToMessage={jumpToMessage}
        />
      ) : null}

      {/* Mounted only for a space, and only once the conversation has loaded —
          it needs the title, the viewer's role and the member count, and there
          is no meaningful skeleton for a panel nobody has opened yet. Kept
          mounted across open/close after that, so Radix can restore focus to
          the header button. */}
      {isSpace && conversation ? (
        <SpaceDetailsDialog
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          conversation={conversation}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  )
}
