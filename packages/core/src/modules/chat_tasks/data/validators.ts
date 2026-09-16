import { z } from 'zod'
import {
  recurrenceSchema,
  timeZoneSchema,
} from '@open-mercato/core/modules/tasks/data/validators'
import {
  TASK_MAX_ASSIGNEES,
  TASK_MAX_ASSIGNMENT_TARGETS,
  TASK_MAX_LABELS,
  TASK_PRIORITIES,
  TASK_TITLE_MAX_LENGTH,
  TASK_DESCRIPTION_PLAINTEXT_MAX_LENGTH,
} from '@open-mercato/core/modules/tasks/data/types'
import {
  CHAT_TASK_IDEMPOTENCY_KEY_MAX_LENGTH,
  CHAT_TASK_CARD_BATCH_LIMIT,
  CHAT_TASK_LINK_MAX_PAGE_SIZE,
  CHAT_TASK_LINK_PAGE_SIZE,
} from './types'

/**
 * Every caps, enum and date rule here is imported from the tasks module rather
 * than restated. A second copy of "a title is 300 characters" is a second thing
 * to forget: the two would drift, and the one that drifted would be this file,
 * where the mistake looks like a stricter validation rather than a wrong one.
 */

const uuid = z.string().uuid()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
const dueTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a 24h HH:MM time').nullish()

/**
 * The fields a task carries when it is created from chat.
 *
 * A deliberate subset of the task module's own create shape: no `parentTaskId`
 * (a subtask needs a parent chosen on a task surface), no `status` (chat-created
 * work is meant to be started, so the command pins `pending` the way Quick Add
 * does), and no `reporterUserId` (authorship comes from the session, never the
 * payload).
 */
export const chatTaskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH),
  description: z.string().nullish(),
  descriptionPlaintext: z.string().max(TASK_DESCRIPTION_PLAINTEXT_MAX_LENGTH).nullish(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeIds: z.array(uuid).max(TASK_MAX_ASSIGNEES).optional(),
  assignmentTargets: z
    .array(z.object({ kind: z.literal('role'), roleId: uuid }))
    .max(TASK_MAX_ASSIGNMENT_TARGETS)
    .optional(),
  /** Omitted means the scope's Inbox, exactly as Quick Add behaves. */
  projectId: uuid.nullish(),
  milestoneId: uuid.nullish(),
  dueDate: isoDate.nullish(),
  dueTime,
  recurrence: recurrenceSchema.optional(),
  labelIds: z.array(uuid).max(TASK_MAX_LABELS).optional(),
  tz: timeZoneSchema,
})
export type ChatTaskFields = z.infer<typeof chatTaskFieldsSchema>

export const chatTaskCreateRequestSchema = chatTaskFieldsSchema.extend({
  /**
   * Required, not optional.
   *
   * An optional idempotency key is one nobody sends, and this is the exact flow —
   * a click that can be double-clicked, retried by the browser and re-sent after
   * a timeout — where a missing key means a duplicate task. The client mints one
   * per composer session.
   */
  idempotencyKey: z.string().trim().min(8).max(CHAT_TASK_IDEMPOTENCY_KEY_MAX_LENGTH),
  /**
   * The message this task was raised from.
   *
   * Validated against this conversation on the server: a message id from
   * somewhere else is refused rather than stored, and the stored reference is
   * revealed later only to someone who can still read the conversation.
   */
  sourceMessageId: uuid.nullish(),
  /**
   * Whether to post a card. `false` records the link without adding a row to the
   * transcript.
   *
   * It does **not** lower what the caller needs. Both link routes require
   * `chat.send`, because a link is shared conversation state — it shows up in
   * every member's Tasks panel — and a route gate can only express the union of
   * what a request might do. `publishCard` chooses whether a message is written,
   * not whether the caller is allowed to contribute; the card write re-checks
   * `chat.send` for itself regardless, because a command must not depend on which
   * route reached it.
   */
  publishCard: z.boolean().optional().default(true),
})
export type ChatTaskCreateRequest = z.infer<typeof chatTaskCreateRequestSchema>

/** Creating a task in the personal workspace: no conversation, so no card. */
export const chatTaskWorkspaceCreateRequestSchema = chatTaskFieldsSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(CHAT_TASK_IDEMPOTENCY_KEY_MAX_LENGTH),
})
export type ChatTaskWorkspaceCreateRequest = z.infer<typeof chatTaskWorkspaceCreateRequestSchema>

export const chatTaskLinkRequestSchema = z.object({
  taskId: uuid,
  sourceMessageId: uuid.nullish(),
  publishCard: z.boolean().optional().default(true),
})
export type ChatTaskLinkRequest = z.infer<typeof chatTaskLinkRequestSchema>

export const chatTaskLinkListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_TASK_LINK_MAX_PAGE_SIZE).optional().default(CHAT_TASK_LINK_PAGE_SIZE),
  /** `open` excludes the two terminal statuses, matching every other tasks view. */
  state: z.enum(['all', 'open', 'completed']).optional().default('all'),
  assignedToMe: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})
export type ChatTaskLinkListQuery = z.infer<typeof chatTaskLinkListQuerySchema>

/**
 * Cards for one page of a transcript, resolved in one request.
 *
 * A batch rather than one call per card: a transcript renders up to fifty
 * messages and a per-card request is the N+1 that makes scrolling slow in the
 * place people notice most.
 */
export const chatTaskCardBatchQuerySchema = z.object({
  messageIds: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((entry) => entry.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(CHAT_TASK_CARD_BATCH_LIMIT)),
})
export type ChatTaskCardBatchQuery = z.infer<typeof chatTaskCardBatchQuerySchema>
