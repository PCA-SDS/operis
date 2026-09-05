"use client"

// Reads go through TanStack Query so the conversation list, the open
// conversation and the topbar badge all see the same cache; writes go through
// `useGuardedMutation` so record locks and any future global guard are handled
// once rather than per call site.

import * as React from 'react'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import type {
  ChatConversationDto,
  ChatMessageDto,
  ChatParticipantRole,
  ChatTranslationDto,
} from '../data/types'
import {
  CONVERSATION_PAGE_STEP,
  MAX_CONVERSATION_PAGE_SIZE,
  MAX_TRANSLATE_BATCH,
} from '../data/validators'
import { chatApi } from './api'

const logger = createLogger('chat').child({ component: 'hooks' })

/**
 * Query keys, partitioned by organization scope.
 *
 * `scope` is `useOrganizationScopeVersion()`, and it belongs in the KEY rather
 * than in an invalidate-on-change effect — the pattern the customers module
 * already uses via `keyExtras`. Partitioning means org A's conversations can
 * never be served under org B, not even for the frame between the switch and an
 * invalidation landing, and it covers surfaces mounted outside the chat page
 * (the topbar badge) that have no effect of their own to run.
 */
export const chatKeys = {
  all: ['chat'] as const,
  scoped: (scope: number) => [...chatKeys.all, { scope }] as const,
  conversations: (scope: number, limit?: number) =>
    limit === undefined
      ? ([...chatKeys.scoped(scope), 'conversations'] as const)
      : ([...chatKeys.scoped(scope), 'conversations', limit] as const),
  conversation: (scope: number, id: string) => [...chatKeys.scoped(scope), 'conversation', id] as const,
  messages: (scope: number, id: string) => [...chatKeys.scoped(scope), 'messages', id] as const,
  directory: (scope: number, q: string) => [...chatKeys.scoped(scope), 'directory', q] as const,
  members: (scope: number, id: string, q: string) =>
    [...chatKeys.scoped(scope), 'members', id, q] as const,
  pinned: (scope: number, id: string) => [...chatKeys.scoped(scope), 'pinned', id] as const,
  unreadCount: (scope: number) => [...chatKeys.scoped(scope), 'unread-count'] as const,
  settings: (scope: number) => [...chatKeys.scoped(scope), 'settings'] as const,
}

function invalidateChat(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: chatKeys.all })
}

/** Coalescing window for inbound events. */
const REFRESH_COALESCE_MS = 200

/**
 * Keep every open chat surface current.
 *
 * The server marks chat events `clientBroadcast` and targets them at the
 * conversation's participants, so this fires only for people who are actually in
 * the conversation. `om:bridge:reconnected` is handled too: after a dropped
 * socket the client cannot know what it missed, so it refetches rather than
 * assuming it is up to date.
 *
 * Note what this deliberately does *not* do — apply the event payload to the
 * cache. The payload carries no message body (the bridge truncates frames over
 * 4KB), so it is a signal to refetch, and persistence stays the source of truth.
 *
 * Two details that stop one message becoming a burst of requests:
 *
 * - **Coalescing.** A single send produces several events (`message.sent`, then
 *   `conversation.read` once the recipient's client marks it), and this hook is
 *   mounted by more than one component. `useAppEvent` registers a listener per
 *   instance, so without a shared timer each invalidation would cancel the
 *   previous one's in-flight refetch — `invalidateQueries` defaults to
 *   `cancelRefetch: true` — and restart work the server had already done.
 * - **A module-level timer**, not a per-instance one, so the topbar badge and
 *   the chat page collapse into the same refresh rather than two.
 */
let pendingRefresh: ReturnType<typeof setTimeout> | null = null
/**
 * How much the pending refresh needs to touch. Upgraded, never downgraded —
 * if anything in the coalescing window needs the transcript, the whole window
 * refetches it.
 */
let pendingScope: RefreshScope = 'badges'
/**
 * The conversations named by `engagement` events in this window. Only read on
 * the `engagement` path; an upgrade to `all` makes it irrelevant.
 */
let pendingConversationIds = new Set<string>()

/** Widest wins, so the order here is the upgrade order. */
type RefreshScope = 'badges' | 'engagement' | 'all'
const SCOPE_RANK: Record<RefreshScope, number> = { badges: 0, engagement: 1, all: 2 }

/**
 * How much of the cache an event can possibly have invalidated.
 *
 * The wide path refetches every chat query that is mounted. That is right for a
 * new message — it can move the conversation order, the previews, the unread
 * counts and the transcript at once — and wrong for everything narrower, which
 * is why the two exceptions below exist.
 *
 * `chat.conversation.read` is bookkeeping, not content. It is emitted to the
 * reader's OWN sessions so their other tabs can clear the badge, and it came
 * back to the tab that caused it — so opening a conversation refetched the very
 * messages it had just loaded. Measured on a cold load: 17 chat requests, with
 * the transcript fetched four times. A read can only move a badge.
 *
 * A reaction or a pin is narrower still, and the server already tells us where
 * it landed. Left on the wide path, one person adding an emoji made every
 * participant refetch their conversation list, their member list, the directory
 * and — because `useMessages` is an infinite query — *every loaded page* of a
 * transcript that may not even be the one reacted in. A reader scrolled five
 * pages back paid nine requests for someone else's thumbs-up, twice over: once
 * from the mutation and once from the event echoing back.
 */
function scopeForEvent(eventId: string): RefreshScope {
  if (eventId === 'chat.conversation.read') return 'badges'
  if (eventId === 'chat.message.reacted' || eventId === 'chat.conversation.pinned') {
    return 'engagement'
  }
  return 'all'
}

/** The event's conversation, when it named one we can trust. */
function conversationIdOf(payload: AppEventPayload): string | null {
  const value = payload.payload?.conversationId
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function useChatLiveRefresh(): void {
  const client = useQueryClient()
  const scope = useOrganizationScopeVersion()

  const schedule = React.useCallback(
    (eventId: string, conversationId: string | null) => {
      let wanted = scopeForEvent(eventId)
      // An engagement event that did not say where it happened cannot be
      // narrowed, so it falls back to the wide path rather than being dropped.
      if (wanted === 'engagement' && !conversationId) wanted = 'all'
      if (SCOPE_RANK[wanted] > SCOPE_RANK[pendingScope]) pendingScope = wanted
      if (wanted === 'engagement' && conversationId) pendingConversationIds.add(conversationId)

      if (pendingRefresh) return
      pendingRefresh = setTimeout(() => {
        pendingRefresh = null
        const settled = pendingScope
        const conversationIds = pendingConversationIds
        pendingScope = 'badges'
        pendingConversationIds = new Set()

        if (settled === 'all') {
          invalidateChat(client)
          return
        }
        if (settled === 'engagement') {
          // A reaction changes the chips on a message; a pin changes those, the
          // pinned list, and the count in that conversation's header. None of
          // them can reorder the conversation list, move an unread count, or
          // touch another conversation — so none of those are refetched.
          for (const conversationId of conversationIds) {
            void client.invalidateQueries({ queryKey: chatKeys.messages(scope, conversationId) })
            void client.invalidateQueries({ queryKey: chatKeys.pinned(scope, conversationId) })
            void client.invalidateQueries({
              queryKey: chatKeys.conversation(scope, conversationId),
            })
          }
          return
        }
        void client.invalidateQueries({ queryKey: chatKeys.conversations(scope) })
        void client.invalidateQueries({ queryKey: chatKeys.unreadCount(scope) })
      }, REFRESH_COALESCE_MS)
    },
    [client, scope],
  )

  useAppEvent('chat.*', (payload) => schedule(payload.id, conversationIdOf(payload)), [schedule])
  // A dropped socket means the client cannot know what it missed, so this one
  // always takes the wide path.
  useAppEvent('om:bridge:reconnected', () => schedule('om:bridge:reconnected', null), [schedule])
}

/**
 * Whether the viewer may write, not just read.
 *
 * `chat.view` and `chat.send` are separate grants, so a read-only member can
 * legitimately open chat. Without this the UI offered them a "New chat" button
 * and a live composer that answered 403 on every attempt — a control that looks
 * available and never is, which is the definition of a dead end.
 *
 * Defaults to `true` until the chrome payload lands, so the composer does not
 * flicker disabled for the majority who can send.
 */
export function useCanSendChat(): boolean {
  const { payload, isReady } = useBackendChrome()
  return React.useMemo(() => {
    if (!isReady || !payload) return true
    return hasFeature(payload.grantedFeatures ?? [], 'chat.send')
  }, [isReady, payload])
}

/**
 * The caller's conversations, most recently active first.
 *
 * Not an infinite query. The list is ordered by `last_message_at`, which every
 * send rewrites, so cursor pagination could skip a conversation that got bumped
 * between two page fetches — it left the un-fetched region and entered the
 * already-loaded one, which was stale. "Load more" therefore grows a single
 * bounded request instead of walking pages: every fetch returns the current top
 * N in the current order, so there is no gap for a row to fall through, and no
 * page boundary for one to appear on twice.
 *
 * The set is naturally bounded — you have as many direct conversations as
 * colleagues you talk to — so this stays one indexed query at any size.
 */
export function useConversations(enabled: boolean = true) {
  const scope = useOrganizationScopeVersion()
  const [limit, setLimit] = React.useState(CONVERSATION_PAGE_STEP)

  // A new organization means a different, usually much shorter list.
  React.useEffect(() => {
    setLimit(CONVERSATION_PAGE_STEP)
  }, [scope])

  const query = useQuery({
    queryKey: chatKeys.conversations(scope, limit),
    queryFn: ({ signal }) => chatApi.listConversations({ limit }, signal),
    // The topbar panel shares this query but only needs it while it is open, so
    // a closed panel costs nothing. The chat page passes nothing and keeps the
    // previous default.
    enabled,
    // Growing the limit re-reads a superset, so showing the previous answer
    // while it lands avoids blanking a list the reader is looking at.
    placeholderData: keepPreviousData,
  })

  const atCeiling = limit >= MAX_CONVERSATION_PAGE_SIZE
  const moreExist = Boolean(query.data?.hasMore)

  return {
    conversations: query.data?.items ?? [],
    isLoading: query.isLoading,
    error: query.error,
    hasMore: moreExist && !atCeiling,
    // More exist but the bounded list will not grow further. Reported rather
    // than silently dropping the button, which would leave the reader believing
    // they had reached the end.
    reachedLimit: moreExist && atCeiling,
    isLoadingMore: query.isFetching && query.isPlaceholderData,
    loadMore: () =>
      setLimit((current) => Math.min(current + CONVERSATION_PAGE_STEP, MAX_CONVERSATION_PAGE_SIZE)),
    retry: query.refetch,
  }
}

export function useConversation(id: string | undefined) {
  const scope = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: chatKeys.conversation(scope, id ?? 'none'),
    queryFn: ({ signal }) => chatApi.getConversation(id as string, signal),
    enabled: Boolean(id),
  })
  return {
    conversation: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

/**
 * A conversation's messages, paged backwards through history.
 *
 * Pages arrive newest-page-first with each page oldest-first inside it, so
 * flattening in reverse page order yields one chronological transcript.
 */
export function useMessages(conversationId: string | undefined, anchorMessageId?: string | null) {
  const scope = useOrganizationScopeVersion()
  const query = useInfiniteQuery({
    // The anchor is part of the key, so asking for a window around an old
    // message is a different cached result from the newest page rather than an
    // overwrite of it — going back to the bottom does not refetch.
    queryKey: [...chatKeys.messages(scope, conversationId ?? 'none'), anchorMessageId ?? null],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      // Only the FIRST page is centred. Once the reader scrolls up from there,
      // paging continues backwards from the window's own edge exactly as it
      // would anywhere else.
      pageParam === undefined && anchorMessageId
        ? chatApi.listMessagesAround(conversationId as string, anchorMessageId, signal)
        : chatApi.listMessages(conversationId as string, { cursor: pageParam }, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(conversationId),
  })

  const messages = React.useMemo<ChatMessageDto[]>(
    () => (query.data?.pages ?? []).slice().reverse().flatMap((page) => page.items),
    [query.data],
  )

  return {
    messages,
    isLoading: query.isLoading,
    error: query.error,
    hasOlder: Boolean(query.hasNextPage),
    isLoadingOlder: query.isFetchingNextPage,
    loadOlder: query.fetchNextPage,
    retry: query.refetch,
  }
}

export function useDirectorySearch(query: string, enabled: boolean) {
  const scope = useOrganizationScopeVersion()
  const result = useQuery({
    queryKey: chatKeys.directory(scope, query),
    queryFn: ({ signal }) => chatApi.searchDirectory({ q: query || undefined }, signal),
    enabled,
    // A directory changes on the timescale of HR, not of typing. Holding results
    // briefly means backspacing through a query does not refire every request.
    staleTime: 30_000,
  })
  return {
    people: result.data?.items ?? [],
    truncated: result.data?.truncated ?? false,
    isLoading: result.isLoading,
    error: result.error,
    retry: result.refetch,
  }
}

export function useChatUnreadCount(enabled: boolean) {
  const scope = useOrganizationScopeVersion()
  // No `staleTime` override: the app-wide 30s default plus the SSE invalidation
  // already keep this fresh, and a shorter window would only add focus refetches.
  const query = useQuery({
    queryKey: chatKeys.unreadCount(scope),
    queryFn: ({ signal }) => chatApi.unreadCount(signal),
    enabled,
  })
  return { unreadCount: query.data?.unreadCount ?? 0 }
}

/**
 * The members of a space, and the search over them.
 *
 * Shares the module's scope-partitioned key space, so switching organization
 * cannot serve one space's membership under another's id — and `enabled` keeps
 * a closed details panel from fetching anything at all.
 */
export function useSpaceMembers(conversationId: string | undefined, search: string, enabled: boolean) {
  const scope = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: chatKeys.members(scope, conversationId ?? 'none', search),
    queryFn: ({ signal }) => chatApi.listMembers(conversationId as string, { q: search || undefined }, signal),
    enabled: enabled && Boolean(conversationId),
    placeholderData: keepPreviousData,
  })
  return {
    members: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    hasMore: query.data?.hasMore ?? false,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

/**
 * The space write operations.
 *
 * One hook rather than five, because they share a cache-invalidation rule and
 * differ only in which request they send: every one of them changes something
 * the conversation list, the header or the member panel is rendering, so all of
 * them invalidate the module's whole key space exactly as sending does. Each
 * goes through `useGuardedMutation`, so none is the write that quietly opts out
 * of record locks and future global guards.
 */
export function useSpaceMutations(conversationId?: string) {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'chat.conversation' })
  const context = React.useMemo(
    () => ({ resourceKind: 'chat.conversation', resourceId: conversationId ?? null }),
    [conversationId],
  )
  const settled = React.useCallback(() => invalidateChat(client), [client])

  const createSpace = useMutation({
    mutationFn: (input: { title: string; memberIds: string[] }) =>
      runMutation({
        operation: () => chatApi.createSpace(input),
        context: { resourceKind: 'chat.conversation', resourceId: null },
        mutationPayload: input,
      }),
    onSuccess: settled,
  })

  const rename = useMutation({
    mutationFn: (title: string) =>
      runMutation({
        operation: () => chatApi.renameSpace(conversationId as string, title),
        context,
        mutationPayload: { title },
      }),
    onSuccess: settled,
  })

  const addMembers = useMutation({
    mutationFn: (memberIds: string[]) =>
      runMutation({
        operation: () => chatApi.addMembers(conversationId as string, memberIds),
        context,
        mutationPayload: { memberIds },
      }),
    onSuccess: settled,
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      runMutation({
        operation: () => chatApi.removeMember(conversationId as string, userId),
        context,
        mutationPayload: { userId },
      }),
    onSuccess: settled,
  })

  const setMemberRole = useMutation({
    mutationFn: (input: { userId: string; role: ChatParticipantRole }) =>
      runMutation({
        operation: () => chatApi.setMemberRole(conversationId as string, input.userId, input.role),
        context,
        mutationPayload: input,
      }),
    onSuccess: settled,
  })

  return { createSpace, rename, addMembers, removeMember, setMemberRole }
}

/**
 * The messages pinned in a conversation.
 *
 * `enabled` so a closed panel costs nothing; the header's count comes from the
 * conversation row, which every surface already has, so opening the panel is the
 * first request this makes.
 */
export function usePinnedMessages(conversationId: string | undefined, enabled: boolean) {
  const scope = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: chatKeys.pinned(scope, conversationId ?? 'none'),
    queryFn: ({ signal }) => chatApi.listPinned(conversationId as string, signal),
    enabled: enabled && Boolean(conversationId),
  })
  return {
    pinned: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

/**
 * Reacting and pinning.
 *
 * Both are toggles the server owns — it decides whether the emoji goes on or
 * off, and whether the pin exists — so neither is applied optimistically. A
 * reaction that flickered on and then off because the server disagreed would be
 * worse than one that appears a moment later.
 */
/**
 * Say so when a write fails.
 *
 * Reactions and pins are toggles the server owns, so nothing is applied
 * optimistically — which means a rejected one leaves the UI exactly as it was.
 * Without this the click simply did nothing, forever, with no explanation: a
 * rate-limited reaction, a pin refused because the caller is not an owner, and
 * a dropped connection were all indistinguishable from a missed click.
 *
 * A flash rather than inline state: these controls live in a transient hover bar
 * and a dialog row, neither of which has anywhere to keep an error.
 */
function useMutationFailureFlash(): (fallback: string) => void {
  const t = useT()
  return React.useCallback(
    (fallback: string) => {
      flash(t('chat.errors.actionFailed', fallback), 'error')
    },
    [t],
  )
}

export function useMessageEngagement(conversationId: string | undefined) {
  const client = useQueryClient()
  const scope = useOrganizationScopeVersion()
  const { runMutation } = useGuardedMutation({ contextId: 'chat.message' })
  const flashFailure = useMutationFailureFlash()
  // The same three keys the live-refresh `engagement` path uses, for the same
  // reason: this can only have changed the chips on a message, the pinned list,
  // and the pin count in this conversation's header. Invalidating the whole
  // `['chat']` tree here made the actor refetch their conversation list, member
  // list, directory and every loaded transcript page — and then do it again
  // when the event echoed back to them.
  const settled = React.useCallback(() => {
    if (!conversationId) {
      invalidateChat(client)
      return
    }
    void client.invalidateQueries({ queryKey: chatKeys.messages(scope, conversationId) })
    void client.invalidateQueries({ queryKey: chatKeys.pinned(scope, conversationId) })
    void client.invalidateQueries({ queryKey: chatKeys.conversation(scope, conversationId) })
  }, [client, conversationId, scope])

  const toggleReaction = useMutation({
    mutationFn: (input: { messageId: string; emoji: string }) =>
      runMutation({
        operation: () => chatApi.toggleReaction(conversationId as string, input.messageId, input.emoji),
        context: { resourceKind: 'chat.message', resourceId: input.messageId },
        mutationPayload: input,
      }),
    onSuccess: settled,
    onError: () => flashFailure("Couldn't update that reaction. Please try again."),
  })

  const setPinned = useMutation({
    mutationFn: (input: { messageId: string; pinned: boolean }) =>
      runMutation({
        operation: () => chatApi.setPinned(conversationId as string, input.messageId, input.pinned),
        context: { resourceKind: 'chat.conversation', resourceId: conversationId ?? null },
        mutationPayload: input,
      }),
    onSuccess: settled,
    onError: () => flashFailure("Couldn't update the pin. Please try again."),
  })

  return { toggleReaction, setPinned }
}

export function useSendMessage(conversationId: string | undefined) {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'chat.message' })

  return useMutation({
    mutationFn: (input: { body: string; clientMessageId: string; replyToMessageId?: string }) =>
      runMutation({
        operation: () => chatApi.sendMessage(conversationId as string, input),
        context: { resourceKind: 'chat.message', resourceId: conversationId ?? null },
        mutationPayload: input,
      }),
    onSuccess: () => {
      invalidateChat(client)
    },
  })
}

/**
 * Catch up on everything — what "clear" means for a chat notification.
 *
 * Wrapped in `useGuardedMutation` like every other write in the module, so it
 * goes through the same mutation-guard and conflict surface rather than being
 * the one write that bypasses it.
 */
export function useMarkAllRead() {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'chat.conversation' })
  const flashFailure = useMutationFailureFlash()

  return useMutation({
    mutationFn: () =>
      runMutation({
        operation: () => chatApi.markAllRead(),
        context: { resourceKind: 'chat.conversation', resourceId: null },
      }),
    onSuccess: () => {
      invalidateChat(client)
    },
    // The button re-enables and the badge stays put, which reads as "the badge
    // is wrong" rather than "that did not work".
    onError: () => flashFailure("Couldn't clear your unread messages. Please try again."),
  })
}

export function useOpenConversation() {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'chat.conversation' })

  return useMutation({
    mutationFn: (userId: string) =>
      runMutation({
        operation: () => chatApi.openConversation(userId),
        context: { resourceKind: 'chat.conversation', resourceId: null },
        mutationPayload: { userId },
      }),
    onSuccess: (conversation: ChatConversationDto) => {
      invalidateChat(client)
      return conversation
    },
  })
}

/**
 * Mark a conversation read once its newest message has been seen.
 *
 * Keyed on the newest message id rather than run on every render, so switching
 * back to an already-read conversation does not re-POST. Failures are swallowed:
 * a read receipt that does not land is a stale badge, not a lost message, and
 * the next open retries it.
 */
export function useMarkRead(
  conversationId: string | undefined,
  newestMessage: ChatMessageDto | undefined,
  currentUserId: string,
) {
  const client = useQueryClient()
  const scope = useOrganizationScopeVersion()
  const lastMarked = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!conversationId || !newestMessage) return
    // Your own message needs no read receipt. Sending one meant every send cost
    // an extra POST and an extra event round trip.
    if (newestMessage.senderUserId === currentUserId) return
    const marker = `${conversationId}:${newestMessage.id}`
    if (lastMarked.current === marker) return
    lastMarked.current = marker

    let cancelled = false
    void chatApi
      .markRead(conversationId, newestMessage.createdAt)
      .then(() => {
        if (cancelled) return
        void client.invalidateQueries({ queryKey: chatKeys.conversations(scope) })
        void client.invalidateQueries({ queryKey: chatKeys.unreadCount(scope) })
      })
      .catch((err: unknown) => {
        // Deliberately NOT re-armed. Resetting the marker here meant a
        // conversation whose `/read` always fails (a deleted conversation, say)
        // re-fired the failing POST on every inbound event, forever. Leaving the
        // marker set costs one stale badge until the next conversation switch.
        //
        // Logged rather than swallowed: a read receipt that never lands is
        // invisible to the user and would otherwise be invisible in support too.
        logger.warn('Marking a conversation read failed', { conversationId, err })
      })

    return () => {
      cancelled = true
    }
  }, [client, conversationId, currentUserId, newestMessage, scope])
}

/**
 * The language this person reads chat in.
 *
 * Separate from `useLocale()` on purpose. The interface ships in five languages;
 * the languages colleagues write to each other in are not limited to those, and
 * someone reading Vietnamese runs the interface in English because there is no
 * Vietnamese interface. Falling back to the UI locale is right as a default and
 * wrong as the only answer.
 */
export function useChatLocale() {
  const scope = useOrganizationScopeVersion()
  const client = useQueryClient()
  const uiLocale = useLocale()
  const { runMutation } = useGuardedMutation({ contextId: 'chat.settings' })
  const flashFailure = useMutationFailureFlash()

  const query = useQuery({
    queryKey: chatKeys.settings(scope),
    queryFn: ({ signal }) => chatApi.getChatSettings(signal),
    // Rarely changes, and every message row would otherwise wait on it.
    staleTime: 5 * 60 * 1000,
  })

  const setLocale = useMutation({
    mutationFn: (locale: string | null) =>
      runMutation({
        operation: () => chatApi.setChatLocale(locale),
        context: { resourceKind: 'chat.settings', resourceId: null },
        mutationPayload: { locale },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: chatKeys.settings(scope) })
    },
    onError: () => flashFailure("Couldn't save your language. Please try again."),
  })

  return {
    /** What to translate into. Never null, so callers need no fallback of their own. */
    locale: query.data?.translationLocale ?? uiLocale,
    /** Whether it was chosen, as opposed to inherited from the interface. */
    isExplicit: Boolean(query.data?.translationLocale),
    /** What this deployment can actually produce; empty when none is configured. */
    translatableLocales: query.data?.translatableLocales ?? [],
    isLoading: query.isLoading,
    setLocale,
  }
}

/**
 * A cache slot. The reading language is part of the key, not context around it:
 * the same message has a different translation in every language, and a map
 * keyed on the id alone answers "already have it" with the previous language's
 * words the moment the reader switches.
 */
function entryKey(messageId: string, locale: string): string {
  return `${messageId}\u0000${locale}`
}

/**
 * What to tell the reader when a translation produced nothing.
 *
 * The command distinguishes four reasons and the difference matters: a message
 * already in your language is a non-event, while an engine that is not deployed
 * or has just failed is something the reader needs told. Without this the
 * action is indistinguishable from a dead button in all four cases.
 */
function describeSkips(
  rows: ChatTranslationDto[],
  t: (key: string, fallback: string) => string,
): { message: string; kind: 'info' | 'error' } | null {
  const skipped = rows.filter((row) => !row.body)
  if (skipped.length === 0) return null
  const reasons = new Set(skipped.map((row) => row.skipped))
  // A partly-failed batch used to say nothing at all, so three messages that
  // could not be translated rendered as originals inside a translated
  // transcript -- indistinguishable from "already in your language".
  if (skipped.length !== rows.length) {
    const unexplained = skipped.filter(
      (row) => row.skipped !== 'same-language' && row.skipped !== 'nothing-to-translate',
    )
    if (unexplained.length === 0) return null
    return {
      message: t(
        'chat.translation.partial',
        "Some messages couldn't be translated. They are shown in their original language.",
      ),
      kind: 'info',
    }
  }
  if (reasons.has('unsupported-language')) {
    return {
      message: t(
        'chat.translation.unsupportedLanguage',
        'This deployment cannot translate into the language you chose.',
      ),
      kind: 'error',
    }
  }
  if (reasons.has('detection-declined')) {
    return {
      message: t(
        'chat.translation.detectionDeclined',
        "The language couldn't be identified confidently, so nothing was translated.",
      ),
      kind: 'info',
    }
  }
  if (reasons.has('overloaded')) {
    return {
      message: t(
        'chat.translation.overloaded',
        'The translation service is busy. Please try again shortly.',
      ),
      kind: 'error',
    }
  }
  if (reasons.has('deadline-exceeded')) {
    return {
      message: t(
        'chat.translation.deadlineExceeded',
        'Translating took too long. Press Translate again to carry on.',
      ),
      kind: 'error',
    }
  }
  if (reasons.has('mentions-unsafe')) {
    return {
      message: t(
        'chat.translation.mentionsUnsafe',
        'This message names too many people to translate safely.',
      ),
      kind: 'info',
    }
  }
  if (reasons.has('unavailable')) {
    return {
      message: t(
        'chat.translation.unavailable',
        'Translation is not available on this deployment.',
      ),
      kind: 'error',
    }
  }
  if (reasons.has('failed')) {
    return {
      message: t(
        'chat.translation.engineFailed',
        "The translation service couldn't be reached. Please try again.",
      ),
      kind: 'error',
    }
  }
  if (reasons.has('same-language')) {
    return {
      message: t('chat.translation.alreadyInLanguage', 'Already in your reading language.'),
      kind: 'info',
    }
  }
  return {
    message: t('chat.translation.nothingToTranslate', 'There are no words to translate here.'),
    kind: 'info',
  }
}

/**
 * Translations the reader has asked for, held per conversation.
 *
 * Client state rather than a query cache: which messages are *showing* their
 * translation is a view preference, not server data. The translations
 * themselves are cached server-side and shared between readers, so re-asking is
 * cheap and nothing here needs to survive a remount.
 *
 * `autoTranslateIds` drives whole-conversation mode. It lives here rather than
 * in an effect at the call site because the decision needs `entries`, `pending`
 * and `failed`, and reaching those from outside means exporting three
 * identities that change on every response — which turns the caller's effect
 * into a re-render loop. Pass the ids that should be kept translated, or null
 * when the mode is off.
 */
export function useChatTranslation(
  conversationId: string | undefined,
  targetLocale: string,
  autoTranslateIds: string[] | null = null,
) {
  const t = useT()
  const { runMutation } = useGuardedMutation({ contextId: 'chat.message' })
  const flashFailure = useMutationFailureFlash()
  const [entries, setEntries] = React.useState<Map<string, ChatTranslationDto>>(new Map())
  const [showing, setShowing] = React.useState<Set<string>>(new Set())
  const [pending, setPending] = React.useState<Set<string>>(new Set())
  // Attempts that threw. Without this the auto-translate effect re-requests
  // them the moment `pending` clears, so an engine that is down is asked again
  // on every render for as long as the conversation is open.
  const [failed, setFailed] = React.useState<Set<string>>(new Set())
  /**
   * Requests already out, tracked synchronously.
   *
   * `pending` is state, so it is not readable until the next render — and both
   * the auto-translate effect and a reader's own click can call in before that
   * commit, each seeing an empty set and asking the engine for the same
   * messages. A ref is written the moment the decision is made, so the second
   * caller sees the first.
   */
  const inFlight = React.useRef<Set<string>>(new Set())
  /**
   * Messages the reader explicitly asked to see in the original.
   *
   * Whole-conversation mode re-reveals everything it holds on every run, and
   * the run is triggered by things the reader did not do -- a message arriving,
   * someone reacting, another batch landing. Without a record of the choice,
   * pressing "Show original" was undone a second later by a background effect,
   * which is the reader being overruled rather than a race.
   */
  const [hidden, setHidden] = React.useState<Set<string>>(new Set())
  /**
   * Which conversation the state belongs to.
   *
   * A request started in one conversation can resolve after the reader has
   * moved to another, and the reset that runs on the switch happens first --
   * so the late response would repopulate the fresh state and flash a message
   * about a thread that is no longer on screen.
   */
  const generation = React.useRef(0)

  // A different conversation is a different transcript; carrying translations
  // across would show one message's words under another's id.
  React.useEffect(() => {
    setEntries(new Map())
    setShowing(new Set())
    setPending(new Set())
    setFailed(new Set())
    setHidden(new Set())
    inFlight.current = new Set()
    generation.current += 1
  }, [conversationId])

  const translate = React.useCallback(
    async (messageIds: string[]) => {
      if (!conversationId || messageIds.length === 0) return
      // Anything already fetched for THIS language is already usable; asking
      // again would spend a request to be handed the same rows.
      const wanted = messageIds.filter((id) => {
        const key = entryKey(id, targetLocale)
        return !entries.has(key) && !inFlight.current.has(key)
      })
      if (wanted.length === 0) {
        const known = messageIds
          .map((id) => entries.get(entryKey(id, targetLocale)))
          .filter((row): row is ChatTranslationDto => Boolean(row))
        setShowing((current) => {
          const next = new Set(current)
          for (const row of known) if (row.body && !hidden.has(row.messageId)) next.add(row.messageId)
          return next.size === current.size ? current : next
        })
        // Say it again. The reason is already known, so nothing is requested —
        // but pressing Translate a second time on a message already in your
        // language would otherwise be the one press that does nothing at all.
        const repeated = describeSkips(known, t)
        if (repeated) flash(repeated.message, repeated.kind)
        return
      }

      const wantedKeys = wanted.map((id) => entryKey(id, targetLocale))
      for (const key of wantedKeys) inFlight.current.add(key)
      setPending((current) => new Set([...current, ...wanted]))
      setFailed((current) => {
        if (!wantedKeys.some((key) => current.has(key))) return current
        const next = new Set(current)
        for (const key of wantedKeys) next.delete(key)
        return next
      })
      // The server refuses more than `MAX_TRANSLATE_BATCH` ids, and a reader
      // who scrolled back twice before pressing Translate has ninety loaded.
      // Sent whole that is a 400 for every id at once, and because a failure is
      // remembered the mode then does nothing for that conversation ever again.
      const batches: string[][] = []
      for (let index = 0; index < wanted.length; index += MAX_TRANSLATE_BATCH) {
        batches.push(wanted.slice(index, index + MAX_TRANSLATE_BATCH))
      }
      const startedIn = generation.current
      try {
        for (const batch of batches) {
          const result = await runMutation({
            operation: () => chatApi.translateMessages(conversationId, batch, targetLocale),
            context: { resourceKind: 'chat.conversation', resourceId: conversationId },
            mutationPayload: { count: batch.length, targetLocale },
          })
          // The reader moved on while this was in flight. Writing now would
          // repopulate state that was deliberately cleared and raise a message
          // about a conversation that is no longer open.
          if (generation.current !== startedIn) return
          const rows =
            (result as { translations: ChatTranslationDto[] } | undefined)?.translations ?? []
          setEntries((current) => {
            const next = new Map(current)
            for (const row of rows) next.set(entryKey(row.messageId, targetLocale), row)
            return next
          })
          // Only reveal what actually produced words, and never re-reveal a
          // message the reader asked to see in the original.
          setShowing((current) => {
            const next = new Set(current)
            for (const row of rows) if (row.body && !hidden.has(row.messageId)) next.add(row.messageId)
            return next.size === current.size ? current : next
          })
          const outcome = describeSkips(rows, t)
          if (outcome) flash(outcome.message, outcome.kind)
        }
      } catch {
        if (generation.current !== startedIn) return
        setFailed((current) => new Set([...current, ...wantedKeys]))
        flashFailure("Couldn't translate that message. Please try again.")
      } finally {
        for (const key of wantedKeys) inFlight.current.delete(key)
        setPending((current) => {
          const next = new Set(current)
          for (const id of wanted) next.delete(id)
          return next
        })
      }
    },
    [conversationId, entries, flashFailure, hidden, runMutation, t, targetLocale],
  )

  /**
   * Keep whole-conversation mode true as the transcript changes.
   *
   * The mode is sticky, so messages that arrive after it was switched on -- and
   * older pages fetched by scrolling back -- have to be translated too.
   * Otherwise a new message renders in its original language beside translated
   * ones, which is exactly the broken-looking state stickiness exists to avoid.
   */
  /**
   * Follow the reader's language for messages they had already opened.
   *
   * `showing` is keyed by message id, not by language, so switching language
   * left a per-message translation marked as shown with nothing to show — the
   * bubble silently reverted to the original and the footer disappeared, with
   * no request and no explanation. Whole-conversation mode self-heals through
   * the effect below; a single opened message had nothing to heal it.
   */
  React.useEffect(() => {
    if (autoTranslateIds) return
    const orphaned = [...showing].filter((id) => {
      const key = entryKey(id, targetLocale)
      return !entries.has(key) && !failed.has(key) && !inFlight.current.has(key)
    })
    if (orphaned.length === 0) return
    void translate(orphaned)
  }, [autoTranslateIds, entries, failed, showing, targetLocale, translate])

  React.useEffect(() => {
    if (!autoTranslateIds || autoTranslateIds.length === 0) return
    // Reveal first, and unconditionally: switching the mode off hides every
    // message, so switching it back on has to show the translations already
    // held rather than only the ones still to be fetched.
    setShowing((current) => {
      const next = new Set(current)
      for (const id of autoTranslateIds) {
        if (hidden.has(id)) continue
        if (entries.get(entryKey(id, targetLocale))?.body) next.add(id)
      }
      return next.size === current.size ? current : next
    })
    const wanted = autoTranslateIds.filter((id) => {
      const key = entryKey(id, targetLocale)
      return !entries.has(key) && !failed.has(key) && !inFlight.current.has(key)
    })
    if (wanted.length === 0) return
    void translate(wanted)
  }, [autoTranslateIds, entries, failed, hidden, targetLocale, translate])

  const showOriginal = React.useCallback((messageId: string) => {
    // Recorded, not just applied. The auto-effect reveals everything it holds
    // whenever the transcript changes, so a choice that lives only in `showing`
    // is undone by the next inbound message.
    setHidden((current) => (current.has(messageId) ? current : new Set(current).add(messageId)))
    setShowing((current) => {
      if (!current.has(messageId)) return current
      const next = new Set(current)
      next.delete(messageId)
      return next
    })
  }, [])

  const showTranslation = React.useCallback((messageId: string) => {
    setHidden((current) => {
      if (!current.has(messageId)) return current
      const next = new Set(current)
      next.delete(messageId)
      return next
    })
    setShowing((current) => (current.has(messageId) ? current : new Set(current).add(messageId)))
  }, [])

  /**
   * The entries for the language being read, keyed by message id.
   *
   * Callers render by message id and must never be handed another language's
   * words, so the locale is resolved here rather than at each call site.
   */
  const translations = React.useMemo(() => {
    const view = new Map<string, ChatTranslationDto>()
    for (const [key, row] of entries) {
      const [messageId, locale] = key.split('\u0000')
      if (locale === targetLocale) view.set(messageId, row)
    }
    return view
  }, [entries, targetLocale])

  return { translations, showing, pending, translate, showOriginal, showTranslation }
}
