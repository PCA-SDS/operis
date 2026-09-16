"use client"

// Reads go through TanStack Query so every card, panel and workspace list sees the
// same cache; writes go through `useGuardedMutation` so record locks, the
// optimistic-lock conflict bar and any future global guard are handled once.

import * as React from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { taskKeys } from '@open-mercato/core/modules/tasks/components/queryKeys'
import { chatTasksApi } from './api'

/**
 * Query keys, partitioned by organization scope.
 *
 * `scope` is in the KEY rather than in an invalidate-on-change effect, so org A's
 * cards can never be served under org B — not even for the frame between a switch
 * and an invalidation landing. It is also what clears these caches when the signed-in
 * identity changes, because the scope version changes with it.
 */
export const chatTaskKeys = {
  all: ['chat-tasks'] as const,
  scoped: (scope: number) => [...chatTaskKeys.all, { scope }] as const,
  composer: (scope: number, conversationId: string) =>
    [...chatTaskKeys.scoped(scope), 'composer', conversationId] as const,
  conversation: (scope: number, conversationId: string, filters: string) =>
    [...chatTaskKeys.scoped(scope), 'conversation', conversationId, filters] as const,
  cards: (scope: number, conversationId: string, messageIds: string) =>
    [...chatTaskKeys.scoped(scope), 'cards', conversationId, messageIds] as const,
  sources: (scope: number, taskId: string) =>
    [...chatTaskKeys.scoped(scope), 'sources', taskId] as const,
  workspace: (scope: number, params: string) =>
    [...chatTaskKeys.scoped(scope), 'workspace', params] as const,
}

function invalidateChatTasks(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: chatTaskKeys.all })
}

/** Coalescing window for inbound events, matched to chat's own. */
const REFRESH_COALESCE_MS = 200

let pendingRefresh: ReturnType<typeof setTimeout> | null = null

/**
 * Keep every card and panel current, in both directions.
 *
 * Two sources, because the integration has to refresh on either side:
 *
 * - `tasks.*` — a task changed anywhere. Broadcast organization-wide by the tasks
 *   module, which is exactly why the cards refetch rather than read the payload:
 *   the frame says a task moved, and each viewer's own authorized read decides
 *   what they may now see. Note that `tasks.task.completed` is declared but never
 *   emitted — completion arrives as `tasks.task.updated` — so this listens on the
 *   wildcard rather than on the specific id.
 * - `chat_tasks.*` — a link was made or removed. Recipient-scoped to the
 *   conversation's participants, so it reaches only people who can see it.
 *
 * Coalesced through a module-level timer rather than a per-instance one: a
 * transcript mounts one of these per card surface, and without a shared timer each
 * invalidation would cancel the previous one's in-flight refetch.
 */
export function useChatTaskLiveRefresh(): void {
  const client = useQueryClient()

  const schedule = React.useCallback(() => {
    if (pendingRefresh) return
    pendingRefresh = setTimeout(() => {
      pendingRefresh = null
      invalidateChatTasks(client)
      // The tasks module's own surfaces too, so completing from a card updates the
      // board and the personal views the same way completing from the panel does.
      void client.invalidateQueries({ queryKey: taskKeys.all })
    }, REFRESH_COALESCE_MS)
  }, [client])

  useAppEvent('tasks.*', () => schedule(), [schedule])
  useAppEvent('chat_tasks.*', () => schedule(), [schedule])
  // After a dropped socket the client cannot know what it missed, so it refetches
  // authoritative state rather than assuming it is current.
  useAppEvent('om:bridge:reconnected', () => schedule(), [schedule])
}

export function useChatTaskComposerContext(conversationId: string | undefined, enabled: boolean) {
  const scope = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: chatTaskKeys.composer(scope, conversationId ?? 'none'),
    queryFn: ({ signal }) => chatTasksApi.composerContext(conversationId as string, signal),
    enabled: enabled && !!conversationId,
  })
  return { context: query.data ?? null, isLoading: query.isLoading, error: query.error }
}

export type ConversationTaskFilters = {
  state: 'all' | 'open' | 'completed'
  assignedToMe: boolean
}

/**
 * The linked tasks of one conversation, a page at a time.
 *
 * Infinite rather than single-page, matching chat's own cursor-paged hooks: the
 * endpoint answers with a keyset cursor, and a panel that rendered only the first
 * page left every older link unreachable — the count said there was more and
 * nothing could ask for it.
 *
 * The counts describe the whole conversation, so they are read from the first
 * page rather than the most recent one.
 */
export function useConversationTasks(
  conversationId: string | undefined,
  filters: ConversationTaskFilters,
  enabled: boolean,
) {
  const scope = useOrganizationScopeVersion()
  const serialized = `${filters.state}:${filters.assignedToMe}`
  const query = useInfiniteQuery({
    queryKey: chatTaskKeys.conversation(scope, conversationId ?? 'none', serialized),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      chatTasksApi.listConversationTasks(
        conversationId as string,
        { state: filters.state, assignedToMe: filters.assignedToMe, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && !!conversationId,
  })

  const pages = React.useMemo(() => query.data?.pages ?? [], [query.data])
  const first = pages[0] ?? null
  const data = React.useMemo(
    () =>
      first
        ? { ...first, items: pages.flatMap((page) => page.items), hasMore: query.hasNextPage }
        : null,
    [first, pages, query.hasNextPage],
  )

  return {
    data,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
    hasMore: query.hasNextPage,
    loadMore: query.fetchNextPage,
    isLoadingMore: query.isFetchingNextPage,
  }
}

/**
 * The card for one message.
 *
 * Keyed on the message so every card row in a transcript shares one cache entry per
 * message — and requested one id at a time deliberately: the batch endpoint exists
 * and is used by the panel, but a card row does not know its neighbours, and React
 * Query's own deduplication already collapses the identical in-flight requests a
 * page of them produces.
 */
export function useMessageTaskCard(conversationId: string, messageId: string) {
  const scope = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: chatTaskKeys.cards(scope, conversationId, messageId),
    queryFn: ({ signal }) => chatTasksApi.cardsForMessages(conversationId, [messageId], signal),
    enabled: !!conversationId && !!messageId,
  })
  return {
    card: query.data?.items?.[0] ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

export function useTaskSources(taskId: string | undefined) {
  const scope = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: chatTaskKeys.sources(scope, taskId ?? 'none'),
    queryFn: ({ signal }) => chatTasksApi.sourcesForTask(taskId as string, signal),
    enabled: !!taskId,
  })
  return { sources: query.data?.items ?? [], isLoading: query.isLoading, error: query.error }
}

export function useWorkspaceTasks(params: { page?: number; search?: string; tz?: string }) {
  const scope = useOrganizationScopeVersion()
  const serialized = JSON.stringify(params)
  const query = useQuery({
    queryKey: chatTaskKeys.workspace(scope, serialized),
    queryFn: ({ signal }) => chatTasksApi.listWorkspaceTasks(params, signal),
  })
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

/** Every write this module makes, behind the one guarded-mutation contract. */
export function useChatTaskMutations() {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'chat_tasks.link' })
  const settle = () => {
    invalidateChatTasks(client)
    void client.invalidateQueries({ queryKey: taskKeys.all })
  }

  const create = useMutation({
    mutationFn: (input: { conversationId: string; body: Parameters<typeof chatTasksApi.createTask>[1] }) =>
      runMutation({
        operation: () => chatTasksApi.createTask(input.conversationId, input.body),
        context: { resourceKind: 'chat_tasks.link', resourceId: input.conversationId },
        mutationPayload: input.body as Record<string, unknown>,
      }),
    onSuccess: settle,
  })

  const link = useMutation({
    mutationFn: (input: { conversationId: string; body: Parameters<typeof chatTasksApi.linkExistingTask>[1] }) =>
      runMutation({
        operation: () => chatTasksApi.linkExistingTask(input.conversationId, input.body),
        context: { resourceKind: 'chat_tasks.link', resourceId: input.conversationId },
        mutationPayload: input.body as Record<string, unknown>,
      }),
    onSuccess: settle,
  })

  const publishCard = useMutation({
    mutationFn: (linkId: string) =>
      runMutation({
        operation: () => chatTasksApi.publishCard(linkId),
        context: { resourceKind: 'chat_tasks.link', resourceId: linkId },
      }),
    onSuccess: settle,
  })

  const unlink = useMutation({
    mutationFn: (input: { linkId: string; removeCard: boolean }) =>
      runMutation({
        operation: () => chatTasksApi.unlink(input.linkId, { removeCard: input.removeCard }),
        context: { resourceKind: 'chat_tasks.link', resourceId: input.linkId },
      }),
    onSuccess: settle,
  })

  const complete = useMutation({
    mutationFn: (input: { taskId: string; tz: string; updatedAt: string }) =>
      runMutation({
        operation: () => chatTasksApi.completeTask(input.taskId, input.tz, input.updatedAt),
        context: { resourceKind: 'tasks.task', resourceId: input.taskId },
      }),
    onSuccess: settle,
  })

  const reopen = useMutation({
    mutationFn: (input: { taskId: string; updatedAt: string }) =>
      runMutation({
        operation: () => chatTasksApi.reopenTask(input.taskId, input.updatedAt),
        context: { resourceKind: 'tasks.task', resourceId: input.taskId },
      }),
    onSuccess: settle,
  })

  const createWorkspaceTask = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      runMutation({
        operation: () => chatTasksApi.createWorkspaceTask(body),
        context: { resourceKind: 'chat_tasks.workspace_task', resourceId: null },
        mutationPayload: body,
      }),
    onSuccess: settle,
  })

  return { create, link, publishCard, unlink, complete, reopen, createWorkspaceTask }
}
