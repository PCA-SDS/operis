"use client"

// The module's single HTTP surface. Every component reads and writes through
// here rather than assembling URLs inline, so a route change is one edit and
// the optimistic-lock header is attached the same way everywhere.

import {
  apiCallOrThrow,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import type {
  AssignableUserDto,
  LabelDto,
  MilestoneDto,
  MyTaskView,
  PagedResponse,
  ProjectArchivedFilter,
  ProjectDetailDto,
  ProjectListItemDto,
  ProjectDocDto,
  ProjectDocTreeItemDto,
  ProjectSortField,
  QuickAddParseResultDto,
  TaskAssignmentOptionsDto,
  TaskBoardResponse,
  TaskCalendarMode,
  TaskCalendarResponse,
  TaskCommentDto,
  TaskDetailDto,
  TaskListItemDto,
  TeamMembersResponse,
} from '../data/types'

const BASE = '/api/tasks'

function query(params: Record<string, string | number | null | undefined>): string {
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
 * Attach the optimistic-lock header for a write against a record the caller
 * already loaded. Without it a concurrent edit silently wins; with it the
 * server answers 409 and the UI can say so.
 */
function withLock<T>(updatedAt: string | null | undefined, run: () => Promise<T>): Promise<T> {
  return withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), run)
}

export type ProjectListParams = {
  page?: number
  pageSize?: number
  search?: string | null
  archived?: ProjectArchivedFilter
  sort?: ProjectSortField | null
  order?: 'asc' | 'desc'
}

export const tasksApi = {
  // ---- projects -----------------------------------------------------
  listProjects: (params: ProjectListParams, signal?: AbortSignal) =>
    readApiResultOrThrow<PagedResponse<ProjectListItemDto>>(
      `${BASE}/projects${query({
        page: params.page,
        pageSize: params.pageSize,
        search: params.search,
        archived: params.archived,
        sort: params.sort,
        order: params.order,
      })}`,
      { signal },
    ),

  getProject: (id: string, signal?: AbortSignal) =>
    readApiResultOrThrow<ProjectDetailDto>(`${BASE}/projects/${id}`, { signal }),

  getInbox: (signal?: AbortSignal) =>
    readApiResultOrThrow<ProjectDetailDto>(`${BASE}/inbox`, { signal }),

  createProject: (body: Record<string, unknown>) =>
    readApiResultOrThrow<ProjectDetailDto>(`${BASE}/projects`, jsonInit('POST', body)),

  updateProject: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<ProjectDetailDto>(`${BASE}/projects/${id}`, jsonInit('PATCH', body)),
    ),

  archiveProject: (id: string, archived: boolean, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<ProjectDetailDto>(
        `${BASE}/projects/${id}/archive`,
        jsonInit('PATCH', { archived }),
      ),
    ),

  deleteProject: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/projects/${id}`, jsonInit('DELETE'))),

  // ---- people / roles -----------------------------------------------
  listAssignableUsers: (signal?: AbortSignal) =>
    readApiResultOrThrow<{ items: AssignableUserDto[] }>(`${BASE}/assignable-users`, { signal }),

  listAssignmentOptions: (signal?: AbortSignal) =>
    readApiResultOrThrow<TaskAssignmentOptionsDto>(`${BASE}/assignment-options`, { signal }),

  // ---- tasks --------------------------------------------------------
  listProjectTasks: (projectId: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    readApiResultOrThrow<PagedResponse<TaskListItemDto>>(
      `${BASE}/projects/${projectId}/tasks${query(params)}`,
      { signal },
    ),

  getBoard: (projectId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<TaskBoardResponse>(`${BASE}/projects/${projectId}/board`, { signal }),

  getTask: (id: string, signal?: AbortSignal) =>
    readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}`, { signal }),

  createTask: (projectId: string, body: Record<string, unknown>) =>
    readApiResultOrThrow<TaskDetailDto>(`${BASE}/projects/${projectId}/tasks`, jsonInit('POST', body)),

  updateTask: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}`, jsonInit('PATCH', body)),
    ),

  moveTask: (id: string, body: { status: string; afterTaskId: string | null }, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}/move`, jsonInit('PATCH', body)),
    ),

  completeTask: (id: string, tz: string, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}/complete`, jsonInit('PATCH', { tz })),
    ),

  reopenTask: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}/reopen`, jsonInit('PATCH')),
    ),

  deleteTask: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/tasks/${id}`, jsonInit('DELETE'))),

  // ---- personal views ------------------------------------------------
  listMyTasks: (
    params: { view: MyTaskView; page?: number; search?: string | null; tz?: string },
    signal?: AbortSignal,
  ) =>
    readApiResultOrThrow<PagedResponse<TaskListItemDto>>(`${BASE}/my-tasks${query(params)}`, { signal }),

  getCalendar: (
    params: { mode: TaskCalendarMode; from: string; to: string; tz?: string; search?: string | null },
    signal?: AbortSignal,
  ) =>
    readApiResultOrThrow<TaskCalendarResponse>(`${BASE}/my-tasks/calendar${query(params)}`, { signal }),

  parseQuickAdd: (body: { text: string; tz?: string }, signal?: AbortSignal) =>
    readApiResultOrThrow<QuickAddParseResultDto>(`${BASE}/quick-add/parse`, {
      ...jsonInit('POST', body),
      signal,
    }),

  // ---- comments ------------------------------------------------------
  listComments: (taskId: string, page: number, signal?: AbortSignal) =>
    readApiResultOrThrow<PagedResponse<TaskCommentDto>>(
      `${BASE}/tasks/${taskId}/comments${query({ page })}`,
      { signal },
    ),

  createComment: (taskId: string, body: { body: string; plaintext: string }) =>
    readApiResultOrThrow<TaskCommentDto>(`${BASE}/tasks/${taskId}/comments`, jsonInit('POST', body)),

  updateComment: (
    id: string,
    body: { body: string; plaintext: string },
    updatedAt?: string | null,
  ) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskCommentDto>(`${BASE}/comments/${id}`, jsonInit('PATCH', body)),
    ),

  deleteComment: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/comments/${id}`, jsonInit('DELETE'))),

  // ---- docs ----------------------------------------------------------
  listDocs: (projectId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<{ items: ProjectDocTreeItemDto[] }>(`${BASE}/projects/${projectId}/docs`, {
      signal,
    }),

  getDoc: (id: string, signal?: AbortSignal) =>
    readApiResultOrThrow<ProjectDocDto>(`${BASE}/docs/${id}`, { signal }),

  createDoc: (projectId: string, body: Record<string, unknown>) =>
    readApiResultOrThrow<ProjectDocDto>(`${BASE}/projects/${projectId}/docs`, jsonInit('POST', body)),

  updateDoc: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<ProjectDocDto>(`${BASE}/docs/${id}`, jsonInit('PATCH', body)),
    ),

  deleteDoc: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/docs/${id}`, jsonInit('DELETE'))),

  // ---- milestones ------------------------------------------------------
  listMilestones: (projectId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<{ items: MilestoneDto[] }>(`${BASE}/projects/${projectId}/milestones`, {
      signal,
    }),

  createMilestone: (projectId: string, body: Record<string, unknown>) =>
    readApiResultOrThrow<MilestoneDto>(`${BASE}/projects/${projectId}/milestones`, jsonInit('POST', body)),

  updateMilestone: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<MilestoneDto>(`${BASE}/milestones/${id}`, jsonInit('PATCH', body)),
    ),

  deleteMilestone: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/milestones/${id}`, jsonInit('DELETE'))),

  // ---- labels ----------------------------------------------------------
  listLabels: (signal?: AbortSignal) =>
    readApiResultOrThrow<{ items: LabelDto[] }>(`${BASE}/labels`, { signal }),

  createLabel: (body: { name: string; color?: string }) =>
    readApiResultOrThrow<LabelDto>(`${BASE}/labels`, jsonInit('POST', body)),

  updateLabel: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<LabelDto>(`${BASE}/labels/${id}`, jsonInit('PATCH', body)),
    ),

  deleteLabel: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/labels/${id}`, jsonInit('DELETE'))),

  // ---- team ------------------------------------------------------------
  listTeamMembers: (signal?: AbortSignal) =>
    readApiResultOrThrow<TeamMembersResponse>(`${BASE}/team/members`, { signal }),

  getTeamMemberBoard: (userId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<TaskBoardResponse>(`${BASE}/team/members/${userId}/board`, { signal }),

  getTeamMemberTasks: (userId: string, params: { page?: number; search?: string | null }, signal?: AbortSignal) =>
    readApiResultOrThrow<PagedResponse<TaskListItemDto>>(
      `${BASE}/team/members/${userId}/tasks${query(params)}`,
      { signal },
    ),
}
