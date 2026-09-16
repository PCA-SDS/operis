"use client"

// The module's single HTTP surface. Every component reads and writes through here
// rather than assembling URLs inline, so a route change is one edit.

import {
  apiCallOrThrow,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import type { TaskDetailDto, PagedResponse, TaskListItemDto } from '@open-mercato/core/modules/tasks/data/types'
import type {
  ChatTaskCardDto,
  ChatTaskComposerContextDto,
  ChatTaskCreateResultDto,
  ChatTaskLinkListDto,
  ChatTaskLinkResultDto,
  ChatTaskSourceListDto,
} from '../data/types'
import type { ChatTaskCreateRequest, ChatTaskLinkRequest } from '../data/validators'

const BASE = '/api/chat_tasks'
const TASKS_BASE = '/api/tasks'

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

/**
 * A write that carries the record's last-known version.
 *
 * `complete` is the one that matters. Completing a recurring task advances its
 * occurrence rather than finishing it, so a retried click — a double tap, a
 * reconnect, a browser re-sending a timed-out POST — would advance it twice and
 * silently move a deadline a week. The header makes the second attempt a 409
 * instead, and `surfaceRecordConflict` (wired by `useGuardedMutation`) turns that
 * into the standard "record changed" bar.
 */
function withLock<T>(updatedAt: string | null | undefined, run: () => Promise<T>): Promise<T> {
  if (!updatedAt) return run()
  return withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), run)
}

export const chatTasksApi = {
  composerContext: (conversationId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatTaskComposerContextDto>(
      `${BASE}/conversations/${conversationId}/composer`,
      { signal },
    ),

  listConversationTasks: (
    conversationId: string,
    params: { cursor?: string; limit?: number; state?: string; assignedToMe?: boolean },
    signal?: AbortSignal,
  ) =>
    readApiResultOrThrow<ChatTaskLinkListDto>(
      `${BASE}/conversations/${conversationId}/tasks${query(params)}`,
      { signal },
    ),

  /** One request per transcript page; see the route's own note on why. */
  cardsForMessages: (conversationId: string, messageIds: readonly string[], signal?: AbortSignal) =>
    readApiResultOrThrow<{ items: ChatTaskCardDto[] }>(
      `${BASE}/conversations/${conversationId}/cards${query({ messageIds: messageIds.join(',') })}`,
      { signal },
    ),

  createTask: async (conversationId: string, body: ChatTaskCreateRequest) =>
    (
      await apiCallOrThrow<ChatTaskCreateResultDto>(
        `${BASE}/conversations/${conversationId}/tasks`,
        jsonInit('POST', body),
      )
    ).result!,

  linkExistingTask: async (conversationId: string, body: ChatTaskLinkRequest) =>
    (
      await apiCallOrThrow<ChatTaskLinkResultDto>(
        `${BASE}/conversations/${conversationId}/links`,
        jsonInit('POST', body),
      )
    ).result!,

  publishCard: async (linkId: string) =>
    (
      await apiCallOrThrow<{ cardMessageId: string }>(
        `${BASE}/links/${linkId}/card`,
        jsonInit('POST'),
      )
    ).result!,

  unlink: async (linkId: string, options: { removeCard: boolean }) =>
    (
      await apiCallOrThrow<{ ok: boolean; cardRemoved: boolean }>(
        `${BASE}/links/${linkId}${query({ removeCard: options.removeCard })}`,
        jsonInit('DELETE'),
      )
    ).result!,

  sourcesForTask: (taskId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<ChatTaskSourceListDto>(`${BASE}/tasks/${taskId}/sources`, { signal }),

  listWorkspaceTasks: (
    params: { page?: number; pageSize?: number; search?: string; tz?: string },
    signal?: AbortSignal,
  ) =>
    readApiResultOrThrow<PagedResponse<TaskListItemDto>>(
      `${BASE}/workspace/tasks${query(params)}`,
      { signal },
    ),

  createWorkspaceTask: async (body: Record<string, unknown>) =>
    (
      await apiCallOrThrow<{ taskId: string; replayed: boolean }>(
        `${BASE}/workspace/tasks`,
        jsonInit('POST', body),
      )
    ).result!,

  /**
   * Completing and reopening go to the TASKS module's own endpoints, not to this
   * one.
   *
   * There is deliberately no chat_tasks proxy for them: the tasks module owns
   * recurrence, ranking and the audit entry, and a second door into that logic is
   * a second place for it to be got wrong. What this module adds is the
   * expected-version header, because `/complete` is retryable and advancing a
   * recurring task twice is the concrete harm.
   */
  completeTask: async (taskId: string, tz: string, updatedAt: string) =>
    withLock(updatedAt, async () =>
      (
        await apiCallOrThrow<TaskDetailDto>(
          `${TASKS_BASE}/tasks/${taskId}/complete`,
          jsonInit('PATCH', { tz }),
        )
      ).result!,
    ),

  reopenTask: async (taskId: string, updatedAt: string) =>
    withLock(updatedAt, async () =>
      (
        await apiCallOrThrow<TaskDetailDto>(
          `${TASKS_BASE}/tasks/${taskId}/reopen`,
          jsonInit('PATCH'),
        )
      ).result!,
    ),
}
