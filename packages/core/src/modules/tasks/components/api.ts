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
import { toQueryString, jsonRequestInit } from '@open-mercato/shared/lib/http/query'

const BASE = '/api/tasks'

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
      `${BASE}/projects${toQueryString({
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
    readApiResultOrThrow<ProjectDetailDto>(`${BASE}/projects`, jsonRequestInit('POST', body)),

  updateProject: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<ProjectDetailDto>(`${BASE}/projects/${id}`, jsonRequestInit('PATCH', body)),
    ),

  archiveProject: (id: string, archived: boolean, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<ProjectDetailDto>(
        `${BASE}/projects/${id}/archive`,
        jsonRequestInit('PATCH', { archived }),
      ),
    ),

  deleteProject: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/projects/${id}`, jsonRequestInit('DELETE'))),

  // ---- people / roles -----------------------------------------------
  listAssignableUsers: (signal?: AbortSignal) =>
    readApiResultOrThrow<{ items: AssignableUserDto[] }>(`${BASE}/assignable-users`, { signal }),

  listAssignmentOptions: (signal?: AbortSignal) =>
    readApiResultOrThrow<TaskAssignmentOptionsDto>(`${BASE}/assignment-options`, { signal }),

  // ---- tasks --------------------------------------------------------
  listProjectTasks: (projectId: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    readApiResultOrThrow<PagedResponse<TaskListItemDto>>(
      `${BASE}/projects/${projectId}/tasks${toQueryString(params)}`,
      { signal },
    ),

  getBoard: (projectId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<TaskBoardResponse>(`${BASE}/projects/${projectId}/board`, { signal }),

  getTask: (id: string, signal?: AbortSignal) =>
    readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}`, { signal }),

  createTask: (projectId: string, body: Record<string, unknown>) =>
    readApiResultOrThrow<TaskDetailDto>(`${BASE}/projects/${projectId}/tasks`, jsonRequestInit('POST', body)),

  updateTask: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}`, jsonRequestInit('PATCH', body)),
    ),

  moveTask: (id: string, body: { status: string; afterTaskId: string | null }, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}/move`, jsonRequestInit('PATCH', body)),
    ),

  completeTask: (id: string, tz: string, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}/complete`, jsonRequestInit('PATCH', { tz })),
    ),

  reopenTask: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskDetailDto>(`${BASE}/tasks/${id}/reopen`, jsonRequestInit('PATCH')),
    ),

  deleteTask: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/tasks/${id}`, jsonRequestInit('DELETE'))),

  // ---- personal views ------------------------------------------------
  listMyTasks: (
    params: { view: MyTaskView; page?: number; search?: string | null; tz?: string },
    signal?: AbortSignal,
  ) =>
    readApiResultOrThrow<PagedResponse<TaskListItemDto>>(`${BASE}/my-tasks${toQueryString(params)}`, { signal }),

  getCalendar: (
    params: { mode: TaskCalendarMode; from: string; to: string; tz?: string; search?: string | null },
    signal?: AbortSignal,
  ) =>
    readApiResultOrThrow<TaskCalendarResponse>(`${BASE}/my-tasks/calendar${toQueryString(params)}`, { signal }),

  parseQuickAdd: (body: { text: string; tz?: string }, signal?: AbortSignal) =>
    readApiResultOrThrow<QuickAddParseResultDto>(`${BASE}/quick-add/parse`, {
      ...jsonRequestInit('POST', body),
      signal,
    }),

  // ---- comments ------------------------------------------------------
  listComments: (taskId: string, page: number, signal?: AbortSignal) =>
    readApiResultOrThrow<PagedResponse<TaskCommentDto>>(
      `${BASE}/tasks/${taskId}/comments${toQueryString({ page })}`,
      { signal },
    ),

  createComment: (taskId: string, body: { body: string; plaintext: string }) =>
    readApiResultOrThrow<TaskCommentDto>(`${BASE}/tasks/${taskId}/comments`, jsonRequestInit('POST', body)),

  updateComment: (
    id: string,
    body: { body: string; plaintext: string },
    updatedAt?: string | null,
  ) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<TaskCommentDto>(`${BASE}/comments/${id}`, jsonRequestInit('PATCH', body)),
    ),

  deleteComment: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/comments/${id}`, jsonRequestInit('DELETE'))),

  // ---- docs ----------------------------------------------------------
  listDocs: (projectId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<{ items: ProjectDocTreeItemDto[] }>(`${BASE}/projects/${projectId}/docs`, {
      signal,
    }),

  getDoc: (id: string, signal?: AbortSignal) =>
    readApiResultOrThrow<ProjectDocDto>(`${BASE}/docs/${id}`, { signal }),

  createDoc: (projectId: string, body: Record<string, unknown>) =>
    readApiResultOrThrow<ProjectDocDto>(`${BASE}/projects/${projectId}/docs`, jsonRequestInit('POST', body)),

  updateDoc: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<ProjectDocDto>(`${BASE}/docs/${id}`, jsonRequestInit('PATCH', body)),
    ),

  deleteDoc: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/docs/${id}`, jsonRequestInit('DELETE'))),

  // ---- milestones ------------------------------------------------------
  listMilestones: (projectId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<{ items: MilestoneDto[] }>(`${BASE}/projects/${projectId}/milestones`, {
      signal,
    }),

  createMilestone: (projectId: string, body: Record<string, unknown>) =>
    readApiResultOrThrow<MilestoneDto>(`${BASE}/projects/${projectId}/milestones`, jsonRequestInit('POST', body)),

  updateMilestone: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<MilestoneDto>(`${BASE}/milestones/${id}`, jsonRequestInit('PATCH', body)),
    ),

  deleteMilestone: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/milestones/${id}`, jsonRequestInit('DELETE'))),

  // ---- labels ----------------------------------------------------------
  listLabels: (signal?: AbortSignal) =>
    readApiResultOrThrow<{ items: LabelDto[] }>(`${BASE}/labels`, { signal }),

  createLabel: (body: { name: string; color?: string }) =>
    readApiResultOrThrow<LabelDto>(`${BASE}/labels`, jsonRequestInit('POST', body)),

  updateLabel: (id: string, body: Record<string, unknown>, updatedAt?: string | null) =>
    withLock(updatedAt, () =>
      readApiResultOrThrow<LabelDto>(`${BASE}/labels/${id}`, jsonRequestInit('PATCH', body)),
    ),

  deleteLabel: (id: string, updatedAt?: string | null) =>
    withLock(updatedAt, () => apiCallOrThrow(`${BASE}/labels/${id}`, jsonRequestInit('DELETE'))),

  // ---- team ------------------------------------------------------------
  listTeamMembers: (signal?: AbortSignal) =>
    readApiResultOrThrow<TeamMembersResponse>(`${BASE}/team/members`, { signal }),

  getTeamMemberBoard: (userId: string, signal?: AbortSignal) =>
    readApiResultOrThrow<TaskBoardResponse>(`${BASE}/team/members/${userId}/board`, { signal }),

  getTeamMemberTasks: (userId: string, params: { page?: number; search?: string | null }, signal?: AbortSignal) =>
    readApiResultOrThrow<PagedResponse<TaskListItemDto>>(
      `${BASE}/team/members/${userId}/tasks${toQueryString(params)}`,
      { signal },
    ),
}
