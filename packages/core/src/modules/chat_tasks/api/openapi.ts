import { z } from 'zod'

export const CHAT_TASKS_TAG = 'Chat Tasks'

export const errorSchema = z.object({ error: z.string() })

export const COMMON_ERRORS = [
  { status: 400, description: 'Validation failed, or no organization scope could be resolved', schema: errorSchema },
  { status: 401, description: 'Authentication required', schema: errorSchema },
  { status: 403, description: 'Authenticated, but missing a required task or chat grant', schema: errorSchema },
  {
    status: 404,
    description:
      'Not found — deliberately the same answer for a conversation the caller is not in, a task they may not read, and an id that never existed',
    schema: errorSchema,
  },
] as const

export const WRITE_ERRORS = [
  ...COMMON_ERRORS,
  { status: 429, description: 'Rate limit exceeded', schema: errorSchema },
  {
    status: 503,
    description: 'Rate limiter unavailable; the write was refused rather than left uncounted',
    schema: errorSchema,
  },
] as const

export const IDEMPOTENCY_ERRORS = [
  {
    status: 409,
    description:
      '`idempotency_key_reuse` — the key was reused with different task details; or `request_in_progress` — the first attempt with this key has not finished, and a second task will not be created',
    schema: errorSchema.extend({ code: z.string() }),
  },
] as const

const taskUserSchema = z.object({ id: z.string().uuid(), name: z.string() })

export const cardTaskSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  recurrence: z
    .object({
      freq: z.string(),
      weekday: z.number().nullable(),
      dayOfMonth: z.number().nullable(),
    })
    .nullable(),
  assignees: z.array(taskUserSchema),
  assignmentTargetCount: z.number(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  updatedAt: z.string(),
  canEdit: z.boolean(),
  href: z.string(),
})

export const cardSchema = z.object({
  linkId: z.string().uuid(),
  cardMessageId: z.string().uuid().nullable(),
  available: z.boolean(),
  task: cardTaskSchema.nullable(),
})

export const cardListSchema = z.object({
  items: z.array(cardSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  counts: z.object({
    open: z.number(),
    completed: z.number(),
    assignedToMe: z.number(),
    unavailable: z.number(),
  }),
})

export const cardBatchSchema = z.object({ items: z.array(cardSchema) })

export const composerContextSchema = z.object({
  conversationId: z.string().uuid(),
  kind: z.enum(['direct', 'space']),
  defaultAssignee: taskUserSchema.nullable(),
  defaultAssigneeBlockedReason: z.enum(['inactive', 'not_assignable']).nullable(),
  requiresExplicitAssignee: z.boolean(),
  suggestedAssignees: z.array(taskUserSchema),
  inboxProjectId: z.string().uuid(),
  canCreate: z.boolean(),
  canAssign: z.boolean(),
})

export const createResultSchema = z.object({
  taskId: z.string().uuid(),
  linkId: z.string().uuid(),
  cardPublished: z.boolean(),
  cardMessageId: z.string().uuid().nullable(),
  replayed: z.boolean(),
  task: cardTaskSchema,
})

export const linkResultSchema = z.object({
  linkId: z.string().uuid(),
  cardPublished: z.boolean(),
  cardMessageId: z.string().uuid().nullable(),
  task: cardTaskSchema,
})

export const sourceListSchema = z.object({
  items: z.array(
    z.object({
      linkId: z.string().uuid(),
      conversationId: z.string().uuid(),
      conversationTitle: z.string(),
      kind: z.enum(['direct', 'space']),
      messageId: z.string().uuid().nullable(),
      href: z.string(),
    }),
  ),
})

export const okSchema = z.object({ ok: z.boolean() })
