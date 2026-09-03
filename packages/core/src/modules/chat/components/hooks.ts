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
import { createLogger } from '@open-mercato/shared/lib/logger'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import type { ChatConversationDto, ChatMessageDto } from '../data/types'
import { CONVERSATION_PAGE_STEP, MAX_CONVERSATION_PAGE_SIZE } from '../data/validators'
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
  unreadCount: (scope: number) => [...chatKeys.scoped(scope), 'unread-count'] as const,
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

export function useChatLiveRefresh(): void {
  const client = useQueryClient()
  const schedule = React.useCallback(() => {
    if (pendingRefresh) return
    pendingRefresh = setTimeout(() => {
      pendingRefresh = null
      invalidateChat(client)
    }, REFRESH_COALESCE_MS)
  }, [client])

  useAppEvent('chat.*', schedule, [schedule])
  useAppEvent('om:bridge:reconnected', schedule, [schedule])
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
export function useConversations() {
  const scope = useOrganizationScopeVersion()
  const [limit, setLimit] = React.useState(CONVERSATION_PAGE_STEP)

  // A new organization means a different, usually much shorter list.
  React.useEffect(() => {
    setLimit(CONVERSATION_PAGE_STEP)
  }, [scope])

  const query = useQuery({
    queryKey: chatKeys.conversations(scope, limit),
    queryFn: ({ signal }) => chatApi.listConversations({ limit }, signal),
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
export function useMessages(conversationId: string | undefined) {
  const scope = useOrganizationScopeVersion()
  const query = useInfiniteQuery({
    queryKey: chatKeys.messages(scope, conversationId ?? 'none'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      chatApi.listMessages(conversationId as string, { cursor: pageParam }, signal),
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

export function useSendMessage(conversationId: string | undefined) {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'chat.message' })

  return useMutation({
    mutationFn: (input: { body: string; clientMessageId: string }) =>
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
