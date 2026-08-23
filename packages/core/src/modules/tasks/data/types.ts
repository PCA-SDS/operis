// Tasks module (work management) — shared wire contract.
//
// A tenant plans work as Projects, each holding Milestones, Tasks and doc pages.
// Tasks move across a status board (Kanban) and carry assignees, a reviewer,
// priority, due date, labels and threaded comments. Every entity is scoped by
// tenant AND organization server-side; children scope through their project.
//
// The lowercase enum members below are the wire values verbatim and are written
// into the database, so they are frozen (see BACKWARD_COMPATIBILITY.md).

// ---------------------------------------------------------------------
// Enums / status vocabularies
// ---------------------------------------------------------------------

export const MILESTONE_STATUSES = ['planned', 'active', 'completed'] as const
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]

/** The Kanban columns, in board order. */
export const TASK_STATUSES = [
  'backlog',
  'pending',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/** Statuses that count as "complete" — every view filtering to incomplete tasks
 *  excludes exactly these. */
export const TASK_TERMINAL_STATUSES = ['done', 'cancelled'] as const

/** How a task repeats. Completing a recurring task advances its due date to the
 *  next occurrence instead of marking it done (no duplicate rows). */
export const TASK_RECURRENCE_FREQUENCIES = ['daily', 'weekdays', 'weekly', 'monthly'] as const
export type TaskRecurrenceFrequency = (typeof TASK_RECURRENCE_FREQUENCIES)[number]

/**
 * A task's recurrence rule. Calendar-based (date + optional wall-clock time, no
 * stored UTC instant), so occurrences are DST-neutral by construction.
 * - `weekly` carries `weekday` (0 = Sunday … 6 = Saturday, JS getDay()).
 * - `monthly` carries `dayOfMonth` (1–31); months without that day clamp to
 *   their last day, but the anchor is kept so later months return to it.
 */
export type TaskRecurrenceDto = {
  freq: TaskRecurrenceFrequency
  weekday?: number | null
  dayOfMonth?: number | null
}

/** Kind of a task's dynamic assignment audience. */
export const TASK_ASSIGNMENT_TARGET_KINDS = ['role'] as const
export type TaskAssignmentTargetKind = (typeof TASK_ASSIGNMENT_TARGET_KINDS)[number]

// ---------------------------------------------------------------------
// Shared caps and value shapes
// ---------------------------------------------------------------------

export const TASKS_DEFAULT_PAGE_SIZE = 20
export const TASKS_MAX_PAGE_SIZE = 100

export const PROJECT_NAME_MAX_LENGTH = 200
/** Short uppercase project prefix used to label tasks (e.g. "ENG"). */
export const PROJECT_KEY_MAX_LENGTH = 10
export const PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}$/
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000
export const MILESTONE_NAME_MAX_LENGTH = 200
export const MILESTONE_DESCRIPTION_MAX_LENGTH = 2000
export const TASK_TITLE_MAX_LENGTH = 300
/** Task description + doc body are rich HTML; the plaintext mirror bounds size. */
export const TASK_DESCRIPTION_PLAINTEXT_MAX_LENGTH = 20000
export const TASK_COMMENT_PLAINTEXT_MAX_LENGTH = 10240
export const TASK_COMMENTS_PAGE_SIZE_DEFAULT = 20
export const TASK_COMMENTS_PAGE_SIZE_MAX = 100
export const DOC_TITLE_MAX_LENGTH = 300
export const DOC_BODY_PLAINTEXT_MAX_LENGTH = 100000
/** A project may carry at most this many member users (a sane guard). */
export const PROJECT_MAX_MEMBERS = 200
/** Emoji a project shows as its icon. Bounds a code-point-heavy ZWJ emoji. */
export const PROJECT_ICON_MAX_LENGTH = 32
export const PROJECT_DEFAULT_ICON = '📋'
export const LABEL_NAME_MAX_LENGTH = 60
/** Fallback label swatch when none is chosen. */
export const LABEL_DEFAULT_COLOR = '#64748B'
export const TASK_MAX_LABELS = 20
export const TASK_MAX_ASSIGNEES = 50
export const TASK_MAX_ASSIGNMENT_TARGETS = 20
/** Hex colour a label shows as its swatch. */
export const LABEL_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/
/** Optional wall-clock due time, 24h "HH:MM". Mirrored by a DB check. */
export const TASK_DUE_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/
/** One-line quick-add input cap. */
export const QUICK_ADD_TEXT_MAX_LENGTH = 500

/** The tenant's hidden Inbox project (default location for project-less tasks).
 *  Created lazily, excluded from project lists, immutable. */
export const INBOX_PROJECT_KEY = 'INBOX'
export const INBOX_PROJECT_NAME = 'Inbox'
export const INBOX_PROJECT_ICON = '📥'

/** A user reference resolved to a display name (owner / assignee / reviewer /
 *  reporter / author). Null where the referenced user was removed. */
export type TaskUserDto = {
  id: string
  name: string
}

export type ListSortOrder = 'asc' | 'desc'

export type PagedResponse<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// ---------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------

export type LabelDto = {
  id: string
  name: string
  color: string
  /** How many tasks currently carry the label (list view only; 0 elsewhere). */
  taskCount: number
  updatedAt: string
}

// ---------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------

export type ProjectMemberDto = {
  id: string
  name: string
  email: string
}

export type ProjectListItemDto = {
  id: string
  key: string
  name: string
  description: string | null
  icon: string
  owner: TaskUserDto | null
  /** ISO 8601 date; server-set to the creation date (no user input). */
  startDate: string | null
  memberCount: number
  taskCount: number
  /** Tasks not in a terminal status (done / cancelled). */
  openTaskCount: number
  isInbox: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ProjectDetailDto = ProjectListItemDto & {
  members: ProjectMemberDto[]
}

export const PROJECT_SORTABLE_FIELDS = ['name', 'createdAt'] as const
export type ProjectSortField = (typeof PROJECT_SORTABLE_FIELDS)[number]

export const PROJECT_ARCHIVED_FILTERS = ['active', 'archived', 'all'] as const
export type ProjectArchivedFilter = (typeof PROJECT_ARCHIVED_FILTERS)[number]

// ---------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------

export type MilestoneDto = {
  id: string
  projectId: string
  name: string
  description: string | null
  status: MilestoneStatus
  dueDate: string | null
  taskCount: number
  doneTaskCount: number
  /** 0–100 integer, derived from task completion; 0 when no tasks. */
  progress: number
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------

/** A `role` audience a task is assigned to. Its current members are resolved
 *  server-side when computing "whose task this is". */
export type TaskAssignmentTargetDto = {
  kind: TaskAssignmentTargetKind
  role: { id: string; name: string } | null
}

/** The parent a subtask hangs off, resolved for the breadcrumb / row chip.
 *  Always in the same project as the subtask. */
export type TaskParentRefDto = {
  id: string
  number: number
  title: string
  status: TaskStatus
}

export type TaskListItemDto = {
  id: string
  projectId: string
  projectKey: string
  projectName: string
  projectIcon: string
  parentTaskId: string | null
  parent: TaskParentRefDto | null
  /** Direct subtasks that still count as work (cancelled ones excluded from
   *  both numbers) — the Linear-style "1/3" child-progress counter. */
  subtaskCount: number
  subtaskDoneCount: number
  /** Per-project sequential number (e.g. 42 → "ENG-42"). */
  number: number
  title: string
  status: TaskStatus
  priority: TaskPriority
  assignees: TaskUserDto[]
  assignmentTargets: TaskAssignmentTargetDto[]
  /** Whoever assigned the task (its creator) — the designated reviewer. */
  reviewer: TaskUserDto | null
  milestoneId: string | null
  milestoneName: string | null
  dueDate: string | null
  dueTime: string | null
  recurrence: TaskRecurrenceDto | null
  completedAt: string | null
  /** Board ordering key (ascending) within the project. */
  rank: number
  commentCount: number
  labels: LabelDto[]
  createdAt: string
  updatedAt: string
}

export type TaskDetailDto = TaskListItemDto & {
  reporter: TaskUserDto | null
  description: string
  descriptionPlaintext: string
  /** DIRECT subtasks, in board order. */
  subtasks: TaskListItemDto[]
}

export const TASK_SORTABLE_FIELDS = ['createdAt', 'dueDate', 'priority', 'status', 'title'] as const
export type TaskSortField = (typeof TASK_SORTABLE_FIELDS)[number]

/** The full board for a project — every non-archived task, ordered by rank and
 *  grouped client-side by status. Not paginated (a board shows all). */
export type TaskBoardResponse = {
  tasks: TaskListItemDto[]
}

// ---------------------------------------------------------------------
// Task comments
// ---------------------------------------------------------------------

export type TaskCommentDto = {
  id: string
  taskId: string
  /** Sanitised rich HTML. */
  body: string
  plaintext: string
  author: TaskUserDto | null
  createdAt: string
  updatedAt: string
  /** updatedAt meaningfully later than createdAt. */
  isEdited: boolean
}

// ---------------------------------------------------------------------
// Documentation pages
// ---------------------------------------------------------------------

/** A node in the project's doc tree (title + hierarchy only). */
export type ProjectDocTreeItemDto = {
  id: string
  parentId: string | null
  title: string
  position: number
}

export type ProjectDocDto = {
  id: string
  projectId: string
  parentId: string | null
  title: string
  body: string
  plaintext: string
  position: number
  author: TaskUserDto | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------
// Assignable people / roles
// ---------------------------------------------------------------------

export type AssignableUserDto = {
  id: string
  name: string
  email: string
}

export type TaskTargetOptionDto = {
  id: string
  name: string
}

export type TaskAssignmentOptionsDto = {
  roles: TaskTargetOptionDto[]
}

// ---------------------------------------------------------------------
// Team — organization-scoped view of who a user may see tasks for.
// Visibility = self ∪ everyone in the caller's visible organization scope.
// ---------------------------------------------------------------------

export type TeamMemberDto = {
  id: string
  name: string
  email: string
  /** The member's assigned role names (their job title(s)). */
  roleNames: string[]
  /** The caller themselves (listed first). */
  isSelf: boolean
  /** Incomplete (non-terminal) tasks currently assigned to this person. */
  openTaskCount: number
}

export type TeamMembersResponse = {
  members: TeamMemberDto[]
}

export const TEAM_TASK_VIEWS = ['board', 'list'] as const
export type TeamTaskView = (typeof TEAM_TASK_VIEWS)[number]

// ---------------------------------------------------------------------
// My Tasks — cross-project views
// ---------------------------------------------------------------------

/**
 * Every view except `completed` shows incomplete tasks only:
 * - `all`       — every open task across the scope's live projects, newest first
 * - `today`     — due today or overdue, in the caller's timezone
 * - `upcoming`  — any due date, soonest first
 * - `assigned`  — assigned to the calling user (directly or through a role)
 * - `completed` — finished work, most recently completed first
 */
export const MY_TASK_VIEWS = ['all', 'today', 'upcoming', 'assigned', 'completed'] as const
export type MyTaskView = (typeof MY_TASK_VIEWS)[number]

// ---------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------

/**
 * What puts a task on a calendar day:
 * - `scheduled` — its `dueDate` (+ optional `dueTime`): the plan. Every status
 *   is included; completed ones are marked, not hidden.
 * - `done` — when it was completed (`completedAt`, resolved to a calendar day +
 *   wall-clock time in the caller's `tz`): the record of work done.
 */
export const TASK_CALENDAR_MODES = ['scheduled', 'done'] as const
export type TaskCalendarMode = (typeof TASK_CALENDAR_MODES)[number]

/** Widest window one request may span. A month grid needs 42 days. */
export const TASK_CALENDAR_MAX_RANGE_DAYS = 62
/** Hard row cap — the response says it was cut rather than silently dropping. */
export const TASK_CALENDAR_MAX_ITEMS = 500

export type TaskCalendarItemDto = TaskListItemDto & {
  /** The day this task occupies, YYYY-MM-DD. */
  calendarDate: string
  /** Wall-clock "HH:MM" it sits at, or null for the all-day lane. */
  calendarTime: string | null
}

export type TaskCalendarResponse = {
  mode: TaskCalendarMode
  from: string
  to: string
  items: TaskCalendarItemDto[]
  /** The window held more than TASK_CALENDAR_MAX_ITEMS tasks. */
  truncated: boolean
}

// ---------------------------------------------------------------------
// Quick add — one-line task entry ("Pay rent tomorrow at 3pm #Finance").
// Parsing runs server-side too, so preview and persisted interpretation
// can never drift.
// ---------------------------------------------------------------------

/** Bumped when the quick-add grammar changes behaviour. */
export const QUICK_ADD_PARSER_VERSION = 3

export type QuickAddTokenType =
  | 'project'
  | 'assignee'
  | 'label'
  | 'priority'
  | 'recurrence'
  | 'date'
  | 'time'

/** One span of the input the parser recognised and removed from the title.
 *  `corrected` is set when the span was a tolerated misspelling. */
export type QuickAddRecognizedTokenDto = {
  /** The span exactly as the user typed it. */
  text: string
  type: QuickAddTokenType
  /** Span in `originalText` (UTF-16 offsets, `end` exclusive). */
  start: number
  end: number
  /** Normalised meaning, for diagnostics (e.g. "weekly:tuesday", "15:00"). */
  normalized?: string
  /** Canonical spelling when the span was a tolerated typo. */
  corrected?: string
}

export type QuickAddProjectMatchDto = {
  id: string
  key: string
  name: string
  icon: string
  isInbox: boolean
}

export type QuickAddLabelMatchDto = {
  id: string
  name: string
  color: string
}

/**
 * A note the parser raises instead of guessing. Structured rather than a plain
 * sentence so the message stays translatable: the UI renders
 * `t('tasks.quickAdd.warning.<code>', params)`.
 */
export type QuickAddWarningDto = {
  code: QuickAddWarningCode
  params?: Record<string, string | number>
}

export const QUICK_ADD_WARNING_CODES = [
  'noTitle',
  'multipleProjects',
  'multipleAssignees',
  'typoCorrected',
  'multiWeekdayRepeat',
  'repeatException',
  'intervalRepeat',
  'yearlyRepeat',
  'quarterlyRepeat',
  'weekendRepeat',
  'repeatEndCondition',
  'invalidDayOfMonth',
  'timeNeedsMinutes',
  'invalidTime',
  'invalidDate',
  'ambiguousDate',
  'invalidDay',
  'projectNotFound',
  'projectAmbiguous',
  'assigneeNotFound',
  'assigneeAmbiguous',
  'labelNotFound',
  'labelAmbiguous',
] as const
export type QuickAddWarningCode = (typeof QUICK_ADD_WARNING_CODES)[number]

export type QuickAddParseResultDto = {
  originalText: string
  /** The input with recognised tokens removed; unrecognised text stays. */
  title: string
  project: QuickAddProjectMatchDto | null
  projectQuery: string | null
  assignee: TaskUserDto | null
  assigneeQuery: string | null
  labels: QuickAddLabelMatchDto[]
  labelQueries: string[]
  dueDate: string | null
  dueTime: string | null
  recurrence: TaskRecurrenceDto | null
  /** Explicit `p1`–`p4` priority token (p1 = urgent), or null. */
  priority: TaskPriority | null
  recognizedTokens: QuickAddRecognizedTokenDto[]
  /** Notes about ambiguous dates, unsupported repeats, typo corrections,
   *  unknown projects and so on. Nothing is guessed silently. */
  warnings: QuickAddWarningDto[]
  parserVersion: number
}
