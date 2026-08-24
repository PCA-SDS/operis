/**
 * Task tools exposed to AI surfaces — the in-app assistant and, through the
 * `mcp` module's OAuth-protected endpoint, remote MCP clients.
 *
 * Every tool is a thin adapter over the module's own HTTP routes via
 * `defineApiBackedAiTool`. Nothing here re-implements task logic: the route
 * handlers still run `resolveTasksRequest` (tenant + organization resolution),
 * `runGuardedCommand` (mutation guards, record locks, optimistic locking) and
 * the command bus (validators, events, notifications, action-log auditing). A
 * task created here is indistinguishable from one created in the UI.
 *
 * Two invariants hold for every tool below:
 *
 *  - **No scope arguments.** `tenantId` / `organizationId` / `userId` are absent
 *    from every input schema. They come from the authenticated context, so a
 *    caller cannot aim a tool at another tenant.
 *  - **No destructive operations.** Task deletion is deliberately not exposed.
 */
import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { AiApiOperationRequest } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import {
  MY_TASK_VIEWS,
  PROJECT_ARCHIVED_FILTERS,
  TASKS_MAX_PAGE_SIZE,
  TASK_PRIORITIES,
  TASK_SORTABLE_FIELDS,
  TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  type ProjectListItemDto,
  type TaskDetailDto,
  type TaskListItemDto,
} from './data/types'

// ---------------------------------------------------------------------------
// Bounded primitives — every string and page size has a ceiling so an oversized
// argument is rejected by the schema instead of reaching the database.
// ---------------------------------------------------------------------------

const uuid = z.string().uuid()
const searchTerm = z.string().trim().min(1).max(200)
const pageNumber = z.number().int().min(1).max(1000).optional()
const pageSize = z.number().int().min(1).max(TASKS_MAX_PAGE_SIZE).optional()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
const dueTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a 24h HH:MM time')
/** IANA zone name; the task routes need it to resolve "today" and recurrence. */
const timeZone = z.string().trim().min(1).max(64).optional()

const DEFAULT_PAGE_SIZE = 25

type PagedApiResponse<T> = { items?: T[]; total?: number; page?: number; pageSize?: number }

type PagedOutput<T> = { items: T[]; total: number; page: number; pageSize: number }

function pagedOutput<TApi, TOut>(
  data: PagedApiResponse<TApi> | undefined,
  page: number,
  size: number,
  map: (row: TApi) => TOut,
): PagedOutput<TOut> {
  const items = Array.isArray(data?.items) ? data.items : []
  return {
    items: items.map(map),
    total: typeof data?.total === 'number' ? data.total : items.length,
    page,
    pageSize: size,
  }
}

/**
 * Compact projection of a task. Deliberately narrower than the API DTO: an MCP
 * client gets what it needs to reason about work, not every internal field.
 */
function toTaskSummary(task: TaskListItemDto) {
  return {
    id: task.id,
    reference: `${task.projectKey}-${task.number}`,
    title: task.title,
    status: task.status,
    priority: task.priority,
    projectId: task.projectId,
    projectName: task.projectName,
    parentTaskId: task.parentTaskId ?? null,
    milestoneId: task.milestoneId ?? null,
    milestoneName: task.milestoneName ?? null,
    assignees: (task.assignees ?? []).map((user) => ({ id: user.id, name: user.name ?? null })),
    dueDate: task.dueDate ?? null,
    dueTime: task.dueTime ?? null,
    completedAt: task.completedAt ?? null,
    subtaskCount: task.subtaskCount,
    subtaskDoneCount: task.subtaskDoneCount,
    updatedAt: task.updatedAt ?? null,
  }
}

function toTaskDetail(task: TaskDetailDto) {
  return {
    ...toTaskSummary(task),
    description: task.descriptionPlaintext ?? '',
    reporter: task.reporter ? { id: task.reporter.id, name: task.reporter.name ?? null } : null,
    reviewer: task.reviewer ? { id: task.reviewer.id, name: task.reviewer.name ?? null } : null,
    subtasks: (task.subtasks ?? []).map(toTaskSummary),
  }
}

function toProjectSummary(project: ProjectListItemDto) {
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description ?? null,
    isInbox: project.isInbox,
    archivedAt: project.archivedAt ?? null,
    taskCount: project.taskCount,
    openTaskCount: project.openTaskCount,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const listProjectsInput = z.object({
  search: searchTerm.optional().describe('Case-insensitive match on the project name.'),
  archived: z
    .enum(PROJECT_ARCHIVED_FILTERS)
    .optional()
    .describe('Which projects to include. Defaults to active only.'),
  page: pageNumber,
  pageSize,
})

const listProjectsTool = defineApiBackedAiTool<
  z.infer<typeof listProjectsInput>,
  PagedApiResponse<ProjectListItemDto>,
  PagedOutput<ReturnType<typeof toProjectSummary>>
>({
  name: 'tasks_list_projects',
  displayName: 'List task projects',
  description:
    'List the projects that hold tasks in the current organization. Call this first when you need a projectId to create a task in.',
  inputSchema: listProjectsInput,
  requiredFeatures: ['tasks.projects.view'],
  toOperation: (input) => {
    const page = input.page ?? 1
    const size = input.pageSize ?? DEFAULT_PAGE_SIZE
    const query: Record<string, string | number> = { page, pageSize: size }
    if (input.search) query.search = input.search
    if (input.archived) query.archived = input.archived
    const operation: AiApiOperationRequest = { method: 'GET', path: '/tasks/projects', query }
    return operation
  },
  mapResponse: (response, input) =>
    pagedOutput(response.data, input.page ?? 1, input.pageSize ?? DEFAULT_PAGE_SIZE, toProjectSummary),
})

const listTasksInput = z.object({
  projectId: uuid
    .optional()
    .describe('Restrict to one project. Omit to list across every project in the organization.'),
  view: z
    .enum(MY_TASK_VIEWS)
    .optional()
    .describe(
      'Cross-project view when projectId is omitted: all, today, upcoming, assigned (to you) or completed. Defaults to all.',
    ),
  status: z.enum(TASK_STATUSES).optional().describe('Only meaningful together with projectId.'),
  priority: z.enum(TASK_PRIORITIES).optional().describe('Only meaningful together with projectId.'),
  assigneeId: uuid.optional().describe('Only meaningful together with projectId.'),
  milestoneId: uuid.optional().describe('Only meaningful together with projectId.'),
  labelId: uuid.optional().describe('Only meaningful together with projectId.'),
  sort: z.enum(TASK_SORTABLE_FIELDS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  search: searchTerm.optional(),
  timeZone,
  page: pageNumber,
  pageSize,
})

const listTasksTool = defineApiBackedAiTool<
  z.infer<typeof listTasksInput>,
  PagedApiResponse<TaskListItemDto>,
  PagedOutput<ReturnType<typeof toTaskSummary>>
>({
  name: 'tasks_list',
  displayName: 'List tasks',
  description:
    'List tasks. With projectId, lists that project and accepts status/priority/assignee/milestone/label filters. Without it, lists across all projects using one of the personal views.',
  inputSchema: listTasksInput,
  requiredFeatures: ['tasks.view'],
  toOperation: (input) => {
    const page = input.page ?? 1
    const size = input.pageSize ?? DEFAULT_PAGE_SIZE
    const query: Record<string, string | number> = { page, pageSize: size }
    if (input.search) query.search = input.search

    if (input.projectId) {
      if (input.status) query.status = input.status
      if (input.priority) query.priority = input.priority
      if (input.assigneeId) query.assigneeId = input.assigneeId
      if (input.milestoneId) query.milestoneId = input.milestoneId
      if (input.labelId) query.labelId = input.labelId
      if (input.sort) query.sort = input.sort
      if (input.order) query.order = input.order
      const operation: AiApiOperationRequest = {
        method: 'GET',
        path: `/tasks/projects/${input.projectId}/tasks`,
        query,
      }
      return operation
    }

    query.view = input.view ?? 'all'
    if (input.timeZone) query.tz = input.timeZone
    const operation: AiApiOperationRequest = { method: 'GET', path: '/tasks/my-tasks', query }
    return operation
  },
  mapResponse: (response, input) =>
    pagedOutput(response.data, input.page ?? 1, input.pageSize ?? DEFAULT_PAGE_SIZE, toTaskSummary),
})

const searchTasksInput = z.object({
  query: searchTerm.describe('Free text matched against task titles and descriptions.'),
  view: z.enum(MY_TASK_VIEWS).optional(),
  timeZone,
  page: pageNumber,
  pageSize,
})

const searchTasksTool = defineApiBackedAiTool<
  z.infer<typeof searchTasksInput>,
  PagedApiResponse<TaskListItemDto>,
  PagedOutput<ReturnType<typeof toTaskSummary>>
>({
  name: 'tasks_search',
  displayName: 'Search tasks',
  description:
    'Free-text search across every task in the current organization. Use tasks_list when you already know the project or want structured filters.',
  inputSchema: searchTasksInput,
  requiredFeatures: ['tasks.view'],
  toOperation: (input) => {
    const page = input.page ?? 1
    const size = input.pageSize ?? DEFAULT_PAGE_SIZE
    const query: Record<string, string | number> = {
      page,
      pageSize: size,
      view: input.view ?? 'all',
      search: input.query,
    }
    if (input.timeZone) query.tz = input.timeZone
    const operation: AiApiOperationRequest = { method: 'GET', path: '/tasks/my-tasks', query }
    return operation
  },
  mapResponse: (response, input) =>
    pagedOutput(response.data, input.page ?? 1, input.pageSize ?? DEFAULT_PAGE_SIZE, toTaskSummary),
})

const getTaskInput = z.object({
  taskId: uuid.describe('Task id (UUID).'),
})

const getTaskTool = defineApiBackedAiTool<
  z.infer<typeof getTaskInput>,
  TaskDetailDto,
  ReturnType<typeof toTaskDetail>
>({
  name: 'tasks_get',
  displayName: 'Get a task',
  description:
    'Read one task in full: status, priority, assignees, reporter, reviewer, dates, milestone and direct subtasks.',
  inputSchema: getTaskInput,
  requiredFeatures: ['tasks.view'],
  toOperation: (input) => {
    const operation: AiApiOperationRequest = { method: 'GET', path: `/tasks/tasks/${input.taskId}` }
    return operation
  },
  mapResponse: (response) => toTaskDetail(response.data as TaskDetailDto),
})

// ---------------------------------------------------------------------------
// Writes
//
// Each of these carries `isMutation: true`, which is what the agent runtime's
// mutation policy and the MCP endpoint's `tasks:write` scope gate key off.
// ---------------------------------------------------------------------------

const createTaskInput = z.object({
  projectId: uuid.describe('Project to create the task in. Use tasks_list_projects to find one.'),
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH),
  description: z.string().max(10_000).optional().describe('Plain text description.'),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeIds: z.array(uuid).max(20).optional().describe('User ids to assign. Replaces the whole set.'),
  milestoneId: uuid.optional(),
  parentTaskId: uuid.optional().describe('Create as a subtask of this task.'),
  dueDate: isoDate.optional(),
  dueTime: dueTime.optional(),
  labelIds: z.array(uuid).max(20).optional(),
  timeZone,
})

const createTaskTool = defineApiBackedAiTool<
  z.infer<typeof createTaskInput>,
  TaskDetailDto,
  ReturnType<typeof toTaskDetail>
>({
  name: 'tasks_create',
  displayName: 'Create a task',
  description:
    'Create a task in a project. Runs the same command, validation, events and notifications as the Tasks UI.',
  inputSchema: createTaskInput,
  requiredFeatures: ['tasks.create'],
  isMutation: true,
  toOperation: (input) => {
    const { projectId, description, timeZone: tz, ...rest } = input
    const body: Record<string, unknown> = { ...rest }
    // The API takes rich text plus a plaintext mirror; tools send plain text, so
    // both sides get the same value rather than smuggling unsanitized HTML in.
    if (description !== undefined) {
      body.description = description
      body.descriptionPlaintext = description
    }
    if (tz) body.tz = tz
    const operation: AiApiOperationRequest = {
      method: 'POST',
      path: `/tasks/projects/${projectId}/tasks`,
      body,
    }
    return operation
  },
  mapResponse: (response) => toTaskDetail(response.data as TaskDetailDto),
})

const updateTaskInput = z.object({
  taskId: uuid,
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH).optional(),
  description: z.string().max(10_000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeIds: z.array(uuid).max(20).optional().describe('Replaces the entire assignee set when present.'),
  milestoneId: uuid.nullable().optional().describe('Pass null to detach from its milestone.'),
  dueDate: isoDate.nullable().optional().describe('Pass null to clear the due date.'),
  dueTime: dueTime.nullable().optional(),
  labelIds: z.array(uuid).max(20).optional().describe('Replaces the entire label set when present.'),
  timeZone,
})

const updateTaskTool = defineApiBackedAiTool<
  z.infer<typeof updateTaskInput>,
  TaskDetailDto,
  ReturnType<typeof toTaskDetail>
>({
  name: 'tasks_update',
  displayName: 'Update a task',
  description:
    'Update an existing task. Only the fields you pass change. assigneeIds and labelIds replace their whole set when present.',
  inputSchema: updateTaskInput,
  requiredFeatures: ['tasks.edit'],
  isMutation: true,
  toOperation: (input) => {
    const { taskId, description, timeZone: tz, ...rest } = input
    const body: Record<string, unknown> = { ...rest }
    if (description !== undefined) {
      body.description = description
      body.descriptionPlaintext = description
    }
    if (tz) body.tz = tz
    const operation: AiApiOperationRequest = {
      method: 'PATCH',
      path: `/tasks/tasks/${taskId}`,
      body,
    }
    return operation
  },
  mapResponse: (response) => toTaskDetail(response.data as TaskDetailDto),
})

const setStatusInput = z.object({
  taskId: uuid,
  status: z
    .enum(TASK_STATUSES)
    .describe('Target status. Use `done` to complete the task and any other status to reopen or move it.'),
  afterTaskId: uuid
    .nullable()
    .optional()
    .describe('Board ordering: place this task directly after the given one within the target column.'),
  timeZone,
})

/**
 * Status changes route to whichever endpoint owns the transition, because the
 * three are not interchangeable: completing runs recurrence roll-forward,
 * reopening clears `completedAt`, and a plain move re-ranks the board.
 */
const setStatusTool = defineApiBackedAiTool<
  z.infer<typeof setStatusInput>,
  TaskDetailDto | { ok: true },
  ReturnType<typeof toTaskDetail> | { taskId: string; status: string; ok: true }
>({
  name: 'tasks_set_status',
  displayName: 'Change task status',
  description:
    'Move a task to a different status. Completing a recurring task rolls it forward exactly as the UI does.',
  inputSchema: setStatusInput,
  requiredFeatures: ['tasks.edit'],
  isMutation: true,
  toOperation: (input) => {
    if (input.status === 'done') {
      const operation: AiApiOperationRequest = {
        method: 'PATCH',
        path: `/tasks/tasks/${input.taskId}/complete`,
        body: input.timeZone ? { tz: input.timeZone } : {},
      }
      return operation
    }

    if (input.afterTaskId !== undefined) {
      const operation: AiApiOperationRequest = {
        method: 'PATCH',
        path: `/tasks/tasks/${input.taskId}/move`,
        body: { status: input.status, afterTaskId: input.afterTaskId },
      }
      return operation
    }

    const operation: AiApiOperationRequest = {
      method: 'PATCH',
      path: `/tasks/tasks/${input.taskId}`,
      body: { status: input.status },
    }
    return operation
  },
  mapResponse: (response, input) => {
    const data = response.data
    if (data && typeof data === 'object' && 'id' in data) {
      return toTaskDetail(data as TaskDetailDto)
    }
    return { taskId: input.taskId, status: input.status, ok: true as const }
  },
})

export const aiTools: AiToolDefinition[] = [
  listProjectsTool,
  listTasksTool,
  searchTasksTool,
  getTaskTool,
  createTaskTool,
  updateTaskTool,
  setStatusTool,
] as unknown as AiToolDefinition[]

export default aiTools
