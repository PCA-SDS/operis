import { z } from 'zod'
import {
  DOC_BODY_PLAINTEXT_MAX_LENGTH,
  DOC_TITLE_MAX_LENGTH,
  LABEL_COLOR_REGEX,
  LABEL_NAME_MAX_LENGTH,
  MILESTONE_DESCRIPTION_MAX_LENGTH,
  MILESTONE_NAME_MAX_LENGTH,
  MILESTONE_STATUSES,
  MY_TASK_VIEWS,
  PROJECT_ARCHIVED_FILTERS,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_ICON_MAX_LENGTH,
  PROJECT_KEY_REGEX,
  PROJECT_MAX_MEMBERS,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_SORTABLE_FIELDS,
  QUICK_ADD_TEXT_MAX_LENGTH,
  TASKS_DEFAULT_PAGE_SIZE,
  TASKS_MAX_PAGE_SIZE,
  TASK_ASSIGNMENT_TARGET_KINDS,
  TASK_CALENDAR_MODES,
  TASK_COMMENTS_PAGE_SIZE_DEFAULT,
  TASK_COMMENTS_PAGE_SIZE_MAX,
  TASK_COMMENT_PLAINTEXT_MAX_LENGTH,
  TASK_DESCRIPTION_PLAINTEXT_MAX_LENGTH,
  TASK_DUE_TIME_REGEX,
  TASK_MAX_ASSIGNEES,
  TASK_MAX_ASSIGNMENT_TARGETS,
  TASK_MAX_LABELS,
  TASK_PRIORITIES,
  TASK_RECURRENCE_FREQUENCIES,
  TASK_SORTABLE_FIELDS,
  TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
} from './types'

const uuid = z.string().uuid()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
const sortOrder = z.enum(['asc', 'desc'])

const coercedInt = (fallback: number) =>
  z.coerce.number().int().positive().optional().transform((value) => value ?? fallback)

/** Scope every command carries; always derived from the authenticated context,
 *  never from request input. */
export const scopeSchema = z.object({
  tenantId: uuid,
  organizationId: uuid,
})
export type TasksScope = z.infer<typeof scopeSchema>

export const paginationSchema = z.object({
  page: coercedInt(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(TASKS_MAX_PAGE_SIZE)
    .optional()
    .transform((value) => value ?? TASKS_DEFAULT_PAGE_SIZE),
})

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(80)
  .optional()
  .refine(
    (value) => {
      if (!value) return true
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value })
        return true
      } catch {
        return false
      }
    },
    { message: 'tz must be a valid IANA timezone name' },
  )

export const recurrenceSchema = z
  .object({
    freq: z.enum(TASK_RECURRENCE_FREQUENCIES),
    weekday: z.number().int().min(0).max(6).nullish(),
    dayOfMonth: z.number().int().min(1).max(31).nullish(),
  })
  .nullable()

export const assignmentTargetSchema = z.object({
  kind: z.enum(TASK_ASSIGNMENT_TARGET_KINDS),
  roleId: uuid.nullish(),
})

// ---------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------

export const projectListQuerySchema = paginationSchema.extend({
  search: z.string().max(200).optional(),
  ownerId: uuid.optional(),
  archived: z.enum(PROJECT_ARCHIVED_FILTERS).optional().default('active'),
  sort: z.enum(PROJECT_SORTABLE_FIELDS).optional(),
  order: sortOrder.optional().default('desc'),
})
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>

export const projectCreateRequestSchema = z.object({
  key: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => PROJECT_KEY_REGEX.test(value), {
      message: '2–10 uppercase letters or digits, starting with a letter',
    }),
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
  description: z.string().max(PROJECT_DESCRIPTION_MAX_LENGTH).nullish(),
  icon: z.string().min(1).max(PROJECT_ICON_MAX_LENGTH).optional(),
  ownerId: uuid.nullish(),
  memberIds: z.array(uuid).max(PROJECT_MAX_MEMBERS).optional(),
})
export type ProjectCreateRequest = z.infer<typeof projectCreateRequestSchema>

export const projectUpdateRequestSchema = z.object({
  key: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => PROJECT_KEY_REGEX.test(value), {
      message: '2–10 uppercase letters or digits, starting with a letter',
    })
    .optional(),
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH).optional(),
  description: z.string().max(PROJECT_DESCRIPTION_MAX_LENGTH).nullish(),
  icon: z.string().min(1).max(PROJECT_ICON_MAX_LENGTH).optional(),
  ownerId: uuid.nullish(),
  memberIds: z.array(uuid).max(PROJECT_MAX_MEMBERS).optional(),
})
export type ProjectUpdateRequest = z.infer<typeof projectUpdateRequestSchema>

export const projectArchiveRequestSchema = z.object({ archived: z.boolean() })

export const projectCreateCommandSchema = projectCreateRequestSchema.merge(scopeSchema)
export type ProjectCreateInput = z.infer<typeof projectCreateCommandSchema>

export const projectUpdateCommandSchema = projectUpdateRequestSchema.merge(scopeSchema).extend({ id: uuid })
export type ProjectUpdateInput = z.infer<typeof projectUpdateCommandSchema>

export const projectArchiveCommandSchema = scopeSchema.extend({ id: uuid, archived: z.boolean() })
export type ProjectArchiveInput = z.infer<typeof projectArchiveCommandSchema>

export const projectDeleteCommandSchema = scopeSchema.extend({ id: uuid })
export type ProjectDeleteInput = z.infer<typeof projectDeleteCommandSchema>

// ---------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------

export const milestoneCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(MILESTONE_NAME_MAX_LENGTH),
  description: z.string().max(MILESTONE_DESCRIPTION_MAX_LENGTH).nullish(),
  status: z.enum(MILESTONE_STATUSES).optional(),
  dueDate: isoDate.nullish(),
})
export type MilestoneCreateRequest = z.infer<typeof milestoneCreateRequestSchema>

export const milestoneUpdateRequestSchema = milestoneCreateRequestSchema.partial()
export type MilestoneUpdateRequest = z.infer<typeof milestoneUpdateRequestSchema>

export const milestoneCreateCommandSchema = milestoneCreateRequestSchema
  .merge(scopeSchema)
  .extend({ projectId: uuid })
export type MilestoneCreateInput = z.infer<typeof milestoneCreateCommandSchema>

export const milestoneUpdateCommandSchema = milestoneUpdateRequestSchema
  .merge(scopeSchema)
  .extend({ id: uuid })
export type MilestoneUpdateInput = z.infer<typeof milestoneUpdateCommandSchema>

export const milestoneDeleteCommandSchema = scopeSchema.extend({ id: uuid })
export type MilestoneDeleteInput = z.infer<typeof milestoneDeleteCommandSchema>

// ---------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------

export const taskListQuerySchema = paginationSchema.extend({
  search: z.string().max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeId: uuid.optional(),
  milestoneId: uuid.optional(),
  labelId: uuid.optional(),
  sort: z.enum(TASK_SORTABLE_FIELDS).optional(),
  order: sortOrder.optional().default('desc'),
})
export type TaskListQuery = z.infer<typeof taskListQuerySchema>

const dueTime = z
  .string()
  .regex(TASK_DUE_TIME_REGEX, 'Expected a 24h HH:MM time')
  .nullish()

export const taskCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH),
  description: z.string().nullish(),
  descriptionPlaintext: z.string().max(TASK_DESCRIPTION_PLAINTEXT_MAX_LENGTH).nullish(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeIds: z.array(uuid).max(TASK_MAX_ASSIGNEES).optional(),
  assignmentTargets: z.array(assignmentTargetSchema).max(TASK_MAX_ASSIGNMENT_TARGETS).optional(),
  milestoneId: uuid.nullish(),
  parentTaskId: uuid.nullish(),
  dueDate: isoDate.nullish(),
  dueTime,
  recurrence: recurrenceSchema.optional(),
  tz: timeZoneSchema,
  labelIds: z.array(uuid).max(TASK_MAX_LABELS).optional(),
})
export type TaskCreateRequest = z.infer<typeof taskCreateRequestSchema>

export const taskUpdateRequestSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH).optional(),
  description: z.string().nullish(),
  descriptionPlaintext: z.string().max(TASK_DESCRIPTION_PLAINTEXT_MAX_LENGTH).nullish(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeIds: z.array(uuid).max(TASK_MAX_ASSIGNEES).optional(),
  assignmentTargets: z.array(assignmentTargetSchema).max(TASK_MAX_ASSIGNMENT_TARGETS).optional(),
  milestoneId: uuid.nullish(),
  parentTaskId: uuid.nullish(),
  dueDate: isoDate.nullish(),
  dueTime,
  recurrence: recurrenceSchema.optional(),
  tz: timeZoneSchema,
  labelIds: z.array(uuid).max(TASK_MAX_LABELS).optional(),
})
export type TaskUpdateRequest = z.infer<typeof taskUpdateRequestSchema>

export const taskMoveRequestSchema = z.object({
  status: z.enum(TASK_STATUSES),
  afterTaskId: uuid.nullish(),
})
export type TaskMoveRequest = z.infer<typeof taskMoveRequestSchema>

export const taskCompleteRequestSchema = z.object({ tz: timeZoneSchema })

export const taskCreateCommandSchema = taskCreateRequestSchema.merge(scopeSchema).extend({
  projectId: uuid,
  reporterUserId: uuid.nullish(),
})
export type TaskCreateInput = z.infer<typeof taskCreateCommandSchema>

export const taskUpdateCommandSchema = taskUpdateRequestSchema.merge(scopeSchema).extend({ id: uuid })
export type TaskUpdateInput = z.infer<typeof taskUpdateCommandSchema>

export const taskMoveCommandSchema = taskMoveRequestSchema.merge(scopeSchema).extend({ id: uuid })
export type TaskMoveInput = z.infer<typeof taskMoveCommandSchema>

export const taskCompleteCommandSchema = scopeSchema.extend({ id: uuid, tz: timeZoneSchema })
export type TaskCompleteInput = z.infer<typeof taskCompleteCommandSchema>

export const taskReopenCommandSchema = scopeSchema.extend({ id: uuid })
export type TaskReopenInput = z.infer<typeof taskReopenCommandSchema>

export const taskDeleteCommandSchema = scopeSchema.extend({ id: uuid })
export type TaskDeleteInput = z.infer<typeof taskDeleteCommandSchema>

// ---------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------

export const commentListQuerySchema = z.object({
  page: coercedInt(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(TASK_COMMENTS_PAGE_SIZE_MAX)
    .optional()
    .transform((value) => value ?? TASK_COMMENTS_PAGE_SIZE_DEFAULT),
})

export const commentWriteRequestSchema = z.object({
  body: z.string().min(1),
  plaintext: z.string().trim().min(1).max(TASK_COMMENT_PLAINTEXT_MAX_LENGTH),
})
export type CommentWriteRequest = z.infer<typeof commentWriteRequestSchema>

export const commentCreateCommandSchema = commentWriteRequestSchema.merge(scopeSchema).extend({
  taskId: uuid,
  authorUserId: uuid.nullish(),
})
export type TaskCommentCreateInput = z.infer<typeof commentCreateCommandSchema>

export const commentUpdateCommandSchema = commentWriteRequestSchema.merge(scopeSchema).extend({ id: uuid })
export type TaskCommentUpdateInput = z.infer<typeof commentUpdateCommandSchema>

export const commentDeleteCommandSchema = scopeSchema.extend({ id: uuid })
export type TaskCommentDeleteInput = z.infer<typeof commentDeleteCommandSchema>

// ---------------------------------------------------------------------
// Project docs
// ---------------------------------------------------------------------

export const docCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(DOC_TITLE_MAX_LENGTH),
  body: z.string().optional(),
  plaintext: z.string().max(DOC_BODY_PLAINTEXT_MAX_LENGTH).optional(),
  parentId: uuid.nullish(),
})
export type DocCreateRequest = z.infer<typeof docCreateRequestSchema>

export const docUpdateRequestSchema = docCreateRequestSchema.partial()
export type DocUpdateRequest = z.infer<typeof docUpdateRequestSchema>

export const docCreateCommandSchema = docCreateRequestSchema.merge(scopeSchema).extend({
  projectId: uuid,
  authorUserId: uuid.nullish(),
})
export type ProjectDocCreateInput = z.infer<typeof docCreateCommandSchema>

export const docUpdateCommandSchema = docUpdateRequestSchema.merge(scopeSchema).extend({ id: uuid })
export type ProjectDocUpdateInput = z.infer<typeof docUpdateCommandSchema>

export const docDeleteCommandSchema = scopeSchema.extend({ id: uuid })
export type ProjectDocDeleteInput = z.infer<typeof docDeleteCommandSchema>

// ---------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------

export const labelCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(LABEL_NAME_MAX_LENGTH),
  color: z.string().regex(LABEL_COLOR_REGEX, 'Expected a #RRGGBB colour').optional(),
})
export type LabelCreateRequest = z.infer<typeof labelCreateRequestSchema>

export const labelUpdateRequestSchema = labelCreateRequestSchema.partial()
export type LabelUpdateRequest = z.infer<typeof labelUpdateRequestSchema>

export const labelCreateCommandSchema = labelCreateRequestSchema.merge(scopeSchema)
export type LabelCreateInput = z.infer<typeof labelCreateCommandSchema>

export const labelUpdateCommandSchema = labelUpdateRequestSchema.merge(scopeSchema).extend({ id: uuid })
export type LabelUpdateInput = z.infer<typeof labelUpdateCommandSchema>

export const labelDeleteCommandSchema = scopeSchema.extend({ id: uuid })
export type LabelDeleteInput = z.infer<typeof labelDeleteCommandSchema>

// ---------------------------------------------------------------------
// My tasks / calendar / quick add / team
// ---------------------------------------------------------------------

export const myTasksQuerySchema = paginationSchema.extend({
  view: z.enum(MY_TASK_VIEWS),
  search: z.string().max(200).optional(),
  tz: timeZoneSchema,
})
export type MyTasksQuery = z.infer<typeof myTasksQuerySchema>

export const taskCalendarQuerySchema = z.object({
  mode: z.enum(TASK_CALENDAR_MODES),
  from: isoDate,
  to: isoDate,
  tz: timeZoneSchema,
  search: z.string().max(200).optional(),
})
export type TaskCalendarQuery = z.infer<typeof taskCalendarQuerySchema>

export const quickAddParseRequestSchema = z.object({
  text: z.string().min(1).max(QUICK_ADD_TEXT_MAX_LENGTH),
  tz: timeZoneSchema,
})
export type QuickAddParseRequest = z.infer<typeof quickAddParseRequestSchema>

export const teamTasksQuerySchema = paginationSchema.extend({
  search: z.string().max(200).optional(),
})
export type TeamTasksQuery = z.infer<typeof teamTasksQuerySchema>
