import type { TaskPriority, TaskRecurrenceDto, TaskStatus } from '@open-mercato/core/modules/tasks/data/types'

/**
 * The wire shapes this module owns.
 *
 * The one rule that runs through all of them: a task's details are present only
 * when the *viewer* may read that task. `available: false` is not an error state,
 * it is the normal answer for a colleague who is in the conversation but has no
 * task grant — and it carries no title, no assignee, no project and no status,
 * because a shape that can be half-filled is a shape that will leak.
 */

/** A task as a card shows it, for a viewer who may read it. */
export type ChatTaskCardTaskDto = {
  id: string
  /** `PROJ-42`, assembled server-side so the client never has to know the rule. */
  reference: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  dueTime: string | null
  recurrence: TaskRecurrenceDto | null
  /** Named people only. Role audiences are described by `assignmentTargetCount`. */
  assignees: { id: string; name: string }[]
  /**
   * How many role audiences the task carries, without naming them: the count is
   * what a card needs to say "and a role", and the names belong to the task
   * surface where the reader can act on them.
   */
  assignmentTargetCount: number
  projectId: string
  projectName: string
  /** For the expected-version header on complete / reopen. */
  updatedAt: string
  /** Whether this viewer may complete or reopen it. */
  canEdit: boolean
  /** Where the task opens, resolved server-side against the real tasks routes. */
  href: string
}

export type ChatTaskCardDto = {
  linkId: string
  /** The card row in the transcript, when this link has one. */
  cardMessageId: string | null
  /**
   * `true` with `task` set, or `false` with `task: null`. Never `true` with a
   * partially-filled task — the two travel together.
   */
  available: boolean
  task: ChatTaskCardTaskDto | null
}

/** A page of the conversation's Tasks panel. */
export type ChatTaskLinkListDto = {
  items: ChatTaskCardDto[]
  /** Keyset cursor over the link rows, so paging cannot skip or repeat. */
  nextCursor: string | null
  hasMore: boolean
  /**
   * Counts over what this viewer may actually read. A count that included tasks
   * the reader cannot see would be an oracle for how many exist.
   */
  counts: { open: number; completed: number; assignedToMe: number; unavailable: number }
}

/** Where a task came from, for the task panel's own sidebar. */
export type ChatTaskSourceDto = {
  linkId: string
  conversationId: string
  /** The conversation's name for this viewer; a direct is named by its counterpart. */
  conversationTitle: string
  kind: 'direct' | 'space'
  /** Present only when a source message was recorded AND is still readable. */
  messageId: string | null
  /** Where the conversation opens. */
  href: string
}

export type ChatTaskSourceListDto = {
  /**
   * Only the sources this viewer is currently a member of. A link the viewer
   * cannot see is omitted entirely rather than listed as hidden — saying "there
   * is a conversation you may not read" still says a conversation exists.
   */
  items: ChatTaskSourceDto[]
}

/** What the composer needs before it can offer to create a task. */
export type ChatTaskComposerContextDto = {
  conversationId: string
  kind: 'direct' | 'space'
  /**
   * Who the assignee defaults to, resolved from server-verified membership.
   *
   * A direct defaults to the other active person. A space has no default and
   * must be chosen. Null with `defaultAssigneeBlockedReason` set means there IS a
   * counterpart and they cannot be assigned — an inactive account, or one the
   * caller may not assign to — which is an actionable message, not silence.
   */
  defaultAssignee: { id: string; name: string } | null
  defaultAssigneeBlockedReason: 'inactive' | 'not_assignable' | null
  /** Whether this conversation requires the assignee to be chosen explicitly. */
  requiresExplicitAssignee: boolean
  /** Current participants who are also assignable, as the first suggestions. */
  suggestedAssignees: { id: string; name: string }[]
  /** The scope's Inbox, where a task with no project goes. */
  inboxProjectId: string
  /** The caller's own grants for this flow, so the UI can offer only what will work. */
  canCreate: boolean
  canAssign: boolean
}

/** The outcome of the coordinated create. */
export type ChatTaskCreateResultDto = {
  taskId: string
  linkId: string
  /**
   * False means the task exists and its card does not. The caller is told that
   * plainly and offered a retry — never told the whole thing failed, and never
   * handed a compensating delete of a task somebody now owns.
   */
  cardPublished: boolean
  cardMessageId: string | null
  /** True when this response replayed an earlier request with the same key. */
  replayed: boolean
  task: ChatTaskCardTaskDto
}

export type ChatTaskLinkResultDto = {
  linkId: string
  cardPublished: boolean
  cardMessageId: string | null
  task: ChatTaskCardTaskDto
}

export const CHAT_TASK_LINK_PAGE_SIZE = 20
export const CHAT_TASK_LINK_MAX_PAGE_SIZE = 50
/** A transcript page is at most 50 messages, so this covers one page of it. */
export const CHAT_TASK_CARD_BATCH_LIMIT = 60
export const CHAT_TASK_IDEMPOTENCY_KEY_MAX_LENGTH = 200
