import { z } from 'zod'
import {
  MILESTONE_STATUSES,
  QUICK_ADD_WARNING_CODES,
  TASK_ASSIGNMENT_TARGET_KINDS,
  TASK_CALENDAR_MODES,
  TASK_PRIORITIES,
  TASK_RECURRENCE_FREQUENCIES,
  TASK_STATUSES,
} from '../data/types'

export const TASKS_TAG = 'Tasks'

export const errorSchema = z.object({ error: z.string() })
export const okSchema = z.object({ ok: z.boolean() })

export function pagedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  })
}

export const taskUserSchema = z.object({ id: z.string().uuid(), name: z.string() })

export const labelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  taskCount: z.number(),
  updatedAt: z.string(),
})

export const projectListItemSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string(),
  owner: taskUserSchema.nullable(),
  startDate: z.string().nullable(),
  memberCount: z.number(),
  taskCount: z.number(),
  openTaskCount: z.number(),
  isInbox: z.boolean(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const projectDetailSchema = projectListItemSchema.extend({
  members: z.array(z.object({ id: z.string().uuid(), name: z.string(), email: z.string() })),
})

export const milestoneSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(MILESTONE_STATUSES),
  dueDate: z.string().nullable(),
  taskCount: z.number(),
  doneTaskCount: z.number(),
  progress: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const recurrenceSchemaOut = z
  .object({
    freq: z.enum(TASK_RECURRENCE_FREQUENCIES),
    weekday: z.number().nullable().optional(),
    dayOfMonth: z.number().nullable().optional(),
  })
  .nullable()

export const taskListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectKey: z.string(),
  projectName: z.string(),
  projectIcon: z.string(),
  parentTaskId: z.string().uuid().nullable(),
  parent: z
    .object({
      id: z.string().uuid(),
      number: z.number(),
      title: z.string(),
      status: z.enum(TASK_STATUSES),
    })
    .nullable(),
  subtaskCount: z.number(),
  subtaskDoneCount: z.number(),
  number: z.number(),
  title: z.string(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  assignees: z.array(taskUserSchema),
  assignmentTargets: z.array(
    z.object({
      kind: z.enum(TASK_ASSIGNMENT_TARGET_KINDS),
      role: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    }),
  ),
  reviewer: taskUserSchema.nullable(),
  milestoneId: z.string().uuid().nullable(),
  milestoneName: z.string().nullable(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  recurrence: recurrenceSchemaOut,
  completedAt: z.string().nullable(),
  rank: z.number(),
  commentCount: z.number(),
  labels: z.array(labelSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const taskDetailSchema = taskListItemSchema.extend({
  reporter: taskUserSchema.nullable(),
  description: z.string(),
  descriptionPlaintext: z.string(),
  subtasks: z.array(taskListItemSchema),
})

export const taskBoardSchema = z.object({ tasks: z.array(taskListItemSchema) })

export const taskCommentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  body: z.string(),
  plaintext: z.string(),
  author: taskUserSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isEdited: z.boolean(),
})

export const docTreeItemSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  title: z.string(),
  position: z.number(),
})

export const docSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  title: z.string(),
  body: z.string(),
  plaintext: z.string(),
  position: z.number(),
  author: taskUserSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const assignableUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
})

export const assignmentOptionsSchema = z.object({
  roles: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
})

export const teamMembersSchema = z.object({
  members: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string(),
      roleNames: z.array(z.string()),
      isSelf: z.boolean(),
      openTaskCount: z.number(),
    }),
  ),
})

export const calendarItemSchema = taskListItemSchema.extend({
  calendarDate: z.string(),
  calendarTime: z.string().nullable(),
})

export const calendarResponseSchema = z.object({
  mode: z.enum(TASK_CALENDAR_MODES),
  from: z.string(),
  to: z.string(),
  items: z.array(calendarItemSchema),
  truncated: z.boolean(),
})

export const quickAddParseResultSchema = z.object({
  originalText: z.string(),
  title: z.string(),
  project: z
    .object({
      id: z.string().uuid(),
      key: z.string(),
      name: z.string(),
      icon: z.string(),
      isInbox: z.boolean(),
    })
    .nullable(),
  projectQuery: z.string().nullable(),
  assignee: taskUserSchema.nullable(),
  assigneeQuery: z.string().nullable(),
  labels: z.array(z.object({ id: z.string().uuid(), name: z.string(), color: z.string() })),
  labelQueries: z.array(z.string()),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  recurrence: recurrenceSchemaOut,
  priority: z.enum(TASK_PRIORITIES).nullable(),
  recognizedTokens: z.array(
    z.object({
      text: z.string(),
      type: z.string(),
      start: z.number(),
      end: z.number(),
      normalized: z.string().optional(),
      corrected: z.string().optional(),
    }),
  ),
  warnings: z.array(
    z.object({
      code: z.enum(QUICK_ADD_WARNING_CODES),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  ),
  parserVersion: z.number(),
})

export const COMMON_ERRORS = [
  { status: 400, description: 'Validation failed', schema: errorSchema },
  { status: 401, description: 'Authentication required', schema: errorSchema },
  { status: 403, description: 'Forbidden', schema: errorSchema },
  { status: 404, description: 'Not found', schema: errorSchema },
  { status: 409, description: 'The record changed since it was loaded', schema: errorSchema },
] as const
