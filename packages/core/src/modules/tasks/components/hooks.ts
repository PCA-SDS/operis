"use client"

// Query and mutation hooks. Reads go through TanStack Query so the sidebar
// counters, the board and the open task panel all see the same data; writes go
// through `useGuardedMutation` so record locks and optimistic-lock conflicts
// are handled once rather than per call site.

import * as React from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type {
  MyTaskView,
  ProjectArchivedFilter,
  ProjectSortField,
  TaskCalendarMode,
} from '../data/types'
import { tasksApi, type ProjectListParams } from './api'
import { taskKeys } from './queryKeys'
import { browserTimeZone } from './format'

/** Everything a write can stale. Task writes ripple into boards, personal
 *  views, project counters and the calendar, so they all drop together. */
function invalidateTaskSurfaces(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: taskKeys.all })
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function useTaskError(error: unknown, fallback: string): string | null {
  return React.useMemo(() => (error ? errorMessage(error, fallback) : null), [error, fallback])
}

/** Refresh open task surfaces when another operator writes. The server marks
 *  task events `clientBroadcast`, so this is a live board rather than a polled one. */
export function useTasksLiveRefresh(): void {
  const client = useQueryClient()
  useAppEvent(
    'tasks.*',
    () => {
      invalidateTaskSurfaces(client)
    },
    [client],
  )
}

// ---------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------

export function useProjects(params: ProjectListParams = {}) {
  const query = useQuery({
    queryKey: taskKeys.projects(params as Record<string, unknown>),
    queryFn: ({ signal }) => tasksApi.listProjects(params, signal),
  })
  return {
    projects: query.data?.items ?? [],
    page: query.data?.page ?? 1,
    pageSize: query.data?.pageSize ?? 20,
    total: query.data?.total ?? 0,
    totalPages: query.data?.totalPages ?? 1,
    isInitialLoading: query.isLoading,
    isFetching: query.isFetching,
    isStale: query.isPlaceholderData,
    error: query.error,
    retry: query.refetch,
  }
}

export function useProject(id: string | undefined) {
  const query = useQuery({
    queryKey: taskKeys.project(id ?? 'none'),
    queryFn: ({ signal }) => tasksApi.getProject(id as string, signal),
    enabled: !!id,
  })
  return {
    project: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

const inboxQuery = {
  queryKey: taskKeys.inbox(),
  queryFn: ({ signal }: { signal?: AbortSignal }) => tasksApi.getInbox(signal),
  staleTime: 5 * 60 * 1000,
} as const

export function useInboxProject() {
  const client = useQueryClient()
  const query = useQuery(inboxQuery)
  /**
   * The Inbox, waiting for it if the query has not landed yet.
   *
   * A submit handler cannot read `inbox` and give up when it is still null:
   * the Inbox is the fallback project for anything Quick Add creates without
   * one, and the request is in flight for the first moment the composer is
   * open — exactly when someone typing quickly presses Enter. Reading through
   * the client resolves from cache when it is there and awaits the same
   * in-flight request when it is not, so the write happens either way.
   */
  const ensureInbox = React.useCallback(
    () => client.ensureQueryData(inboxQuery),
    [client],
  )
  return { inbox: query.data ?? null, isLoading: query.isLoading, ensureInbox }
}

export function useProjectMutations() {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'tasks.project' })

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      runMutation({
        operation: () => tasksApi.createProject(body),
        context: { entityId: 'tasks:tasks_project' },
        mutationPayload: body,
      }),
    onSuccess: () => invalidateTaskSurfaces(client),
  })

  const update = useMutation({
    mutationFn: ({
      id,
      body,
      updatedAt,
    }: {
      id: string
      body: Record<string, unknown>
      updatedAt?: string | null
    }) =>
      runMutation({
        operation: () => tasksApi.updateProject(id, body, updatedAt),
        context: { entityId: 'tasks:tasks_project', recordId: id },
        mutationPayload: body,
      }),
    onSuccess: () => invalidateTaskSurfaces(client),
  })

  const archive = useMutation({
    mutationFn: ({
      id,
      archived,
      updatedAt,
    }: {
      id: string
      archived: boolean
      updatedAt?: string | null
    }) =>
      runMutation({
        operation: () => tasksApi.archiveProject(id, archived, updatedAt),
        context: { entityId: 'tasks:tasks_project', recordId: id },
        mutationPayload: { archived },
      }),
    onSuccess: () => invalidateTaskSurfaces(client),
  })

  const remove = useMutation({
    mutationFn: ({ id, updatedAt }: { id: string; updatedAt?: string | null }) =>
      runMutation({
        operation: () => tasksApi.deleteProject(id, updatedAt),
        context: { entityId: 'tasks:tasks_project', recordId: id },
        mutationPayload: {},
      }),
    onSuccess: () => invalidateTaskSurfaces(client),
  })

  return { create, update, archive, remove }
}

// ---------------------------------------------------------------------
// People and roles
// ---------------------------------------------------------------------

export function useAssignableUsers() {
  const query = useQuery({
    queryKey: taskKeys.assignableUsers(),
    queryFn: ({ signal }) => tasksApi.listAssignableUsers(signal),
    staleTime: 5 * 60 * 1000,
  })
  return { users: query.data?.items ?? [], isLoading: query.isLoading }
}

export function useAssignmentOptions() {
  const query = useQuery({
    queryKey: taskKeys.assignmentOptions(),
    queryFn: ({ signal }) => tasksApi.listAssignmentOptions(signal),
    staleTime: 5 * 60 * 1000,
  })
  return { roles: query.data?.roles ?? [], isLoading: query.isLoading }
}

// ---------------------------------------------------------------------
// Board and tasks
// ---------------------------------------------------------------------

export function useBoard(projectId: string | undefined) {
  const query = useQuery({
    queryKey: taskKeys.board(projectId ?? 'none'),
    queryFn: ({ signal }) => tasksApi.getBoard(projectId as string, signal),
    enabled: !!projectId,
  })
  return {
    tasks: query.data?.tasks ?? [],
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

export function useTask(id: string | undefined) {
  const query = useQuery({
    queryKey: taskKeys.task(id ?? 'none'),
    queryFn: ({ signal }) => tasksApi.getTask(id as string, signal),
    enabled: !!id,
  })
  return {
    task: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

export function useTaskMutations(projectId?: string) {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'tasks.task' })

  const create = useMutation({
    mutationFn: ({
      projectId: targetProjectId,
      body,
    }: {
      projectId: string
      body: Record<string, unknown>
    }) =>
      runMutation({
        operation: () => tasksApi.createTask(targetProjectId, body),
        context: { entityId: 'tasks:tasks_task' },
        mutationPayload: body,
      }),
    onSuccess: () => invalidateTaskSurfaces(client),
  })

  const update = useMutation({
    mutationFn: ({
      id,
      body,
      updatedAt,
    }: {
      id: string
      body: Record<string, unknown>
      updatedAt?: string | null
    }) =>
      runMutation({
        operation: () => tasksApi.updateTask(id, body, updatedAt),
        context: { entityId: 'tasks:tasks_task', recordId: id },
        mutationPayload: body,
      }),
    onSuccess: () => invalidateTaskSurfaces(client),
  })

  const move = useMutation({
    mutationFn: ({
      id,
      status,
      afterTaskId,
      updatedAt,
    }: {
      id: string
      status: string
      afterTaskId: string | null
      updatedAt?: string | null
    }) =>
      runMutation({
        operation: () => tasksApi.moveTask(id, { status, afterTaskId }, updatedAt),
        context: { entityId: 'tasks:tasks_task', recordId: id },
        mutationPayload: { status, afterTaskId },
      }),
    // The board renders the drop optimistically; refetching on settle is what
    // makes a rejected move snap back instead of lying.
    onSettled: () => {
      if (projectId) void client.invalidateQueries({ queryKey: taskKeys.board(projectId) })
      invalidateTaskSurfaces(client)
    },
  })

  const complete = useMutation({
    mutationFn: ({ id, updatedAt }: { id: string; updatedAt?: string | null }) =>
      runMutation({
        operation: () => tasksApi.completeTask(id, browserTimeZone(), updatedAt),
        context: { entityId: 'tasks:tasks_task', recordId: id },
        mutationPayload: {},
      }),
    onSuccess: () => invalidateTaskSurfaces(client),
  })

  const reopen = useMutation({
    mutationFn: ({ id, updatedAt }: { id: string; updatedAt?: string | null }) =>
      runMutation({
        operation: () => tasksApi.reopenTask(id, updatedAt),
        context: { entityId: 'tasks:tasks_task', recordId: id },
        mutationPayload: {},
      }),
    onSuccess: () => invalidateTaskSurfaces(client),
  })

  const remove = useMutation({
    mutationFn: ({ id, updatedAt }: { id: string; updatedAt?: string | null }) =>
      runMutation({
        operation: () => tasksApi.deleteTask(id, updatedAt),
        context: { entityId: 'tasks:tasks_task', recordId: id },
        mutationPayload: {},
      }),
    onSuccess: () => invalidateTaskSurfaces(client),
  })

  return { create, update, move, complete, reopen, remove }
}

// ---------------------------------------------------------------------
// Personal views
// ---------------------------------------------------------------------

export function useMyTasks(view: MyTaskView, options: { page?: number; search?: string } = {}) {
  const params = {
    view,
    page: options.page ?? 1,
    search: options.search || undefined,
    tz: browserTimeZone(),
  }
  const query = useQuery({
    queryKey: taskKeys.myTasks(params),
    queryFn: ({ signal }) => tasksApi.listMyTasks(params, signal),
  })
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    retry: query.refetch,
  }
}

export function useTaskCalendar(params: {
  mode: TaskCalendarMode
  from: string
  to: string
  search?: string
}) {
  const resolved = { ...params, search: params.search || undefined, tz: browserTimeZone() }
  const query = useQuery({
    queryKey: taskKeys.calendar(resolved),
    queryFn: ({ signal }) => tasksApi.getCalendar(resolved, signal),
  })
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

// ---------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------

export function useTaskComments(taskId: string, page = 1) {
  const query = useQuery({
    queryKey: taskKeys.comments(taskId, page),
    queryFn: ({ signal }) => tasksApi.listComments(taskId, page, signal),
    enabled: !!taskId,
  })
  return {
    comments: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    totalPages: query.data?.totalPages ?? 1,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

export function useCommentMutations(taskId: string) {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'tasks.comment' })
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ['tasks', 'comments', taskId] })
    void client.invalidateQueries({ queryKey: taskKeys.task(taskId) })
    invalidateTaskSurfaces(client)
  }

  const create = useMutation({
    mutationFn: (body: { body: string; plaintext: string }) =>
      runMutation({
        operation: () => tasksApi.createComment(taskId, body),
        context: { entityId: 'tasks:tasks_task_comment' },
        mutationPayload: body,
      }),
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: ({
      id,
      body,
      updatedAt,
    }: {
      id: string
      body: { body: string; plaintext: string }
      updatedAt?: string | null
    }) =>
      runMutation({
        operation: () => tasksApi.updateComment(id, body, updatedAt),
        context: { entityId: 'tasks:tasks_task_comment', recordId: id },
        mutationPayload: body,
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: ({ id, updatedAt }: { id: string; updatedAt?: string | null }) =>
      runMutation({
        operation: () => tasksApi.deleteComment(id, updatedAt),
        context: { entityId: 'tasks:tasks_task_comment', recordId: id },
        mutationPayload: {},
      }),
    onSuccess: invalidate,
  })

  return { create, update, remove }
}

// ---------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------

export function useDocTree(projectId: string) {
  const query = useQuery({
    queryKey: taskKeys.docs(projectId),
    queryFn: ({ signal }) => tasksApi.listDocs(projectId, signal),
    enabled: !!projectId,
  })
  return {
    tree: query.data?.items ?? [],
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

export function useDoc(id: string | null) {
  const query = useQuery({
    queryKey: taskKeys.doc(id ?? 'none'),
    queryFn: ({ signal }) => tasksApi.getDoc(id as string, signal),
    enabled: !!id,
  })
  return {
    doc: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

export function useDocMutations(projectId: string) {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'tasks.doc' })
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: taskKeys.docs(projectId) })
    invalidateTaskSurfaces(client)
  }

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      runMutation({
        operation: () => tasksApi.createDoc(projectId, body),
        context: { entityId: 'tasks:tasks_project_doc' },
        mutationPayload: body,
      }),
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: ({
      id,
      body,
      updatedAt,
    }: {
      id: string
      body: Record<string, unknown>
      updatedAt?: string | null
    }) =>
      runMutation({
        operation: () => tasksApi.updateDoc(id, body, updatedAt),
        context: { entityId: 'tasks:tasks_project_doc', recordId: id },
        mutationPayload: body,
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: ({ id, updatedAt }: { id: string; updatedAt?: string | null }) =>
      runMutation({
        operation: () => tasksApi.deleteDoc(id, updatedAt),
        context: { entityId: 'tasks:tasks_project_doc', recordId: id },
        mutationPayload: {},
      }),
    onSuccess: invalidate,
  })

  return { create, update, remove }
}

// ---------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------

export function useMilestones(projectId: string | undefined) {
  const query = useQuery({
    queryKey: taskKeys.milestones(projectId ?? 'none'),
    queryFn: ({ signal }) => tasksApi.listMilestones(projectId as string, signal),
    enabled: !!projectId,
  })
  return {
    milestones: query.data?.items ?? [],
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

export function useMilestoneMutations(projectId: string) {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'tasks.milestone' })
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: taskKeys.milestones(projectId) })
    invalidateTaskSurfaces(client)
  }

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      runMutation({
        operation: () => tasksApi.createMilestone(projectId, body),
        context: { entityId: 'tasks:tasks_milestone' },
        mutationPayload: body,
      }),
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: ({
      id,
      body,
      updatedAt,
    }: {
      id: string
      body: Record<string, unknown>
      updatedAt?: string | null
    }) =>
      runMutation({
        operation: () => tasksApi.updateMilestone(id, body, updatedAt),
        context: { entityId: 'tasks:tasks_milestone', recordId: id },
        mutationPayload: body,
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: ({ id, updatedAt }: { id: string; updatedAt?: string | null }) =>
      runMutation({
        operation: () => tasksApi.deleteMilestone(id, updatedAt),
        context: { entityId: 'tasks:tasks_milestone', recordId: id },
        mutationPayload: {},
      }),
    onSuccess: invalidate,
  })

  return { create, update, remove }
}

// ---------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------

export function useLabels() {
  const query = useQuery({
    queryKey: taskKeys.labels(),
    queryFn: ({ signal }) => tasksApi.listLabels(signal),
    staleTime: 60 * 1000,
  })
  return { labels: query.data?.items ?? [], isLoading: query.isLoading }
}

export function useLabelMutations() {
  const client = useQueryClient()
  const { runMutation } = useGuardedMutation({ contextId: 'tasks.label' })
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: taskKeys.labels() })
    invalidateTaskSurfaces(client)
  }

  const create = useMutation({
    mutationFn: (body: { name: string; color?: string }) =>
      runMutation({
        operation: () => tasksApi.createLabel(body),
        context: { entityId: 'tasks:tasks_label' },
        mutationPayload: body,
      }),
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: ({
      id,
      body,
      updatedAt,
    }: {
      id: string
      body: Record<string, unknown>
      updatedAt?: string | null
    }) =>
      runMutation({
        operation: () => tasksApi.updateLabel(id, body, updatedAt),
        context: { entityId: 'tasks:tasks_label', recordId: id },
        mutationPayload: body,
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: ({ id, updatedAt }: { id: string; updatedAt?: string | null }) =>
      runMutation({
        operation: () => tasksApi.deleteLabel(id, updatedAt),
        context: { entityId: 'tasks:tasks_label', recordId: id },
        mutationPayload: {},
      }),
    onSuccess: invalidate,
  })

  return { create, update, remove }
}

// ---------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------

export function useTeamMembers() {
  const query = useQuery({
    queryKey: taskKeys.teamMembers(),
    queryFn: ({ signal }) => tasksApi.listTeamMembers(signal),
  })
  return {
    members: query.data?.members ?? [],
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

export function useTeamMemberBoard(userId: string | null) {
  const query = useQuery({
    queryKey: taskKeys.teamMemberBoard(userId ?? 'none'),
    queryFn: ({ signal }) => tasksApi.getTeamMemberBoard(userId as string, signal),
    enabled: !!userId,
  })
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}

export function useTeamMemberTasks(userId: string | null, params: { page?: number; search?: string }) {
  const resolved = { page: params.page ?? 1, search: params.search || undefined }
  const query = useQuery({
    queryKey: taskKeys.teamMemberTasks(userId ?? 'none', resolved),
    queryFn: ({ signal }) => tasksApi.getTeamMemberTasks(userId as string, resolved, signal),
    enabled: !!userId,
  })
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    retry: query.refetch,
  }
}

export type { ProjectArchivedFilter, ProjectSortField }
