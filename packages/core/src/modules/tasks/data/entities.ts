import { Entity, Enum, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import {
  MILESTONE_STATUSES,
  PROJECT_DEFAULT_ICON,
  TASK_PRIORITIES,
  TASK_RECURRENCE_FREQUENCIES,
  TASK_STATUSES,
  TASK_ASSIGNMENT_TARGET_KINDS,
  type MilestoneStatus,
  type TaskAssignmentTargetKind,
  type TaskPriority,
  type TaskRecurrenceFrequency,
  type TaskStatus,
} from './types'

/**
 * A scope's work project. `tenantId` + `organizationId` are the scoping root;
 * children scope through this row. `key` is a short uppercase prefix (e.g.
 * "ENG") used to label tasks, unique per scope. `taskSeq` is the monotonic
 * counter backing per-project task numbers (ENG-1, ENG-2, …).
 */
@Entity({ tableName: 'tasks_projects' })
@Index({ name: 'tasks_projects_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'tasks_projects_scope_archived_idx', properties: ['tenantId', 'organizationId', 'archivedAt'] })
@Index({ name: 'tasks_projects_owner_idx', properties: ['ownerUserId'] })
@Unique({ name: 'tasks_projects_scope_key_uq', properties: ['tenantId', 'organizationId', 'key'] })
export class TasksProject {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  key!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  /** Emoji shown as the project's icon. */
  @Property({ type: 'text', default: PROJECT_DEFAULT_ICON })
  icon: string = PROJECT_DEFAULT_ICON

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  /** Server-set to the creation date on create (no user input). */
  @Property({ name: 'start_date', type: 'date', nullable: true })
  startDate?: Date | null

  /** Soft archive; non-null hides the project from the default list. */
  @Property({ name: 'archived_at', type: Date, nullable: true })
  archivedAt?: Date | null

  /**
   * The scope's hidden Inbox project (one per tenant + organization). Lazily
   * created, excluded from project lists; rename/archive/delete are rejected.
   */
  @Property({ name: 'is_inbox', type: 'boolean', default: false })
  isInbox: boolean = false

  /** Monotonic per-project task counter; incremented in the create-task tx. */
  @Property({ name: 'task_seq', type: 'integer', default: 0 })
  taskSeq: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** Project membership join. */
@Entity({ tableName: 'tasks_project_members' })
@Index({ name: 'tasks_project_members_project_idx', properties: ['projectId'] })
@Index({ name: 'tasks_project_members_user_idx', properties: ['userId'] })
@Unique({ name: 'tasks_project_members_uq', properties: ['projectId', 'userId'] })
export class TasksProjectMember {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * A dated goal within a project. Progress is derived at query time from the
 * tasks pointing at it (no denormalised counter).
 */
@Entity({ tableName: 'tasks_milestones' })
@Index({ name: 'tasks_milestones_project_idx', properties: ['projectId'] })
@Index({ name: 'tasks_milestones_scope_idx', properties: ['tenantId', 'organizationId'] })
export class TasksMilestone {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Enum({ items: () => [...MILESTONE_STATUSES], type: 'text', name: 'status' })
  status: MilestoneStatus = 'planned'

  @Property({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * A unit of work. `number` is the per-project sequential id (rendered with the
 * project key: ENG-42). `rank` is the board ordering key (ascending); a move
 * sets it to a midpoint between neighbours. Description is rich HTML plus a
 * plaintext mirror (for search + previews).
 */
@Entity({ tableName: 'tasks_tasks' })
@Index({ name: 'tasks_tasks_project_idx', properties: ['projectId'] })
@Index({ name: 'tasks_tasks_board_idx', properties: ['projectId', 'status', 'rank'] })
@Index({ name: 'tasks_tasks_project_milestone_idx', properties: ['projectId', 'milestoneId'] })
@Index({ name: 'tasks_tasks_parent_idx', properties: ['parentTaskId'] })
@Index({ name: 'tasks_tasks_reviewer_idx', properties: ['reviewerUserId'] })
@Index({ name: 'tasks_tasks_reporter_idx', properties: ['reporterUserId'] })
@Index({ name: 'tasks_tasks_due_date_idx', properties: ['dueDate'] })
@Index({ name: 'tasks_tasks_status_due_idx', properties: ['status', 'dueDate'] })
@Index({ name: 'tasks_tasks_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'tasks_tasks_project_number_uq', properties: ['projectId', 'number'] })
export class TasksTask {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'milestone_id', type: 'uuid', nullable: true })
  milestoneId?: string | null

  /**
   * Parent task. A task may be a subtask of another task in the SAME project,
   * nested to any depth. Deleting a parent deletes its whole subtree. Cycles
   * are rejected by the service (`assertNoSubtaskCycle`).
   */
  @Property({ name: 'parent_task_id', type: 'uuid', nullable: true })
  parentTaskId?: string | null

  @Property({ type: 'integer' })
  number!: number

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', default: '' })
  description: string = ''

  @Property({ name: 'description_plaintext', type: 'text', default: '' })
  descriptionPlaintext: string = ''

  @Enum({ items: () => [...TASK_STATUSES], type: 'text', name: 'status' })
  status: TaskStatus = 'backlog'

  @Enum({ items: () => [...TASK_PRIORITIES], type: 'text', name: 'priority' })
  priority: TaskPriority = 'none'

  /** Whoever assigned the task (its creator) — the designated reviewer. */
  @Property({ name: 'reviewer_user_id', type: 'uuid', nullable: true })
  reviewerUserId?: string | null

  @Property({ name: 'reporter_user_id', type: 'uuid', nullable: true })
  reporterUserId?: string | null

  @Property({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: Date | null

  /** Optional wall-clock due time "HH:MM" (24h) on the due date. Stored as a
   *  timezone-neutral string. */
  @Property({ name: 'due_time', type: 'text', nullable: true })
  dueTime?: string | null

  /** Recurrence rule. Completing a recurring task advances dueDate to the next
   *  occurrence instead of marking it done (no duplicate future rows). */
  @Enum({ items: () => [...TASK_RECURRENCE_FREQUENCIES], type: 'text', name: 'recurrence_freq', nullable: true })
  recurrenceFreq?: TaskRecurrenceFrequency | null

  /** 0 (Sunday) – 6 (Saturday); set for weekly recurrence only. */
  @Property({ name: 'recurrence_weekday', type: 'integer', nullable: true })
  recurrenceWeekday?: number | null

  /** 1–31 anchor day for monthly recurrence; shorter months clamp to their last
   *  day but later months return to the anchor. */
  @Property({ name: 'recurrence_day_of_month', type: 'integer', nullable: true })
  recurrenceDayOfMonth?: number | null

  /** When the task last entered `done`; cleared on reopen / leaving done. */
  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  /** Board ordering key; double precision so a move can bisect two neighbours. */
  @Property({ type: 'double', default: 0 })
  rank: number = 0

  @Property({ name: 'archived_at', type: Date, nullable: true })
  archivedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Explicit task ↔ user assignee join. A task can have many assignees; a user
 * can be on many tasks. Dynamic role audiences are NOT expanded here — see
 * `TasksTaskAssignmentTarget`.
 */
@Entity({ tableName: 'tasks_task_assignees' })
@Index({ name: 'tasks_task_assignees_task_idx', properties: ['taskId'] })
@Index({ name: 'tasks_task_assignees_user_idx', properties: ['userId'] })
@Unique({ name: 'tasks_task_assignees_uq', properties: ['taskId', 'userId'] })
export class TasksTaskAssignee {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * A dynamic assignment audience: everyone holding a `role`. Its current members
 * are resolved server-side when computing "whose task this is", so
 * role-membership changes propagate automatically.
 */
@Entity({ tableName: 'tasks_task_assignment_targets' })
@Index({ name: 'tasks_task_assignment_targets_task_idx', properties: ['taskId'] })
@Index({ name: 'tasks_task_assignment_targets_role_idx', properties: ['roleId'] })
@Unique({ name: 'tasks_task_assignment_targets_uq', properties: ['taskId', 'roleId'] })
export class TasksTaskAssignmentTarget {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Enum({ items: () => [...TASK_ASSIGNMENT_TARGET_KINDS], type: 'text', name: 'kind' })
  kind: TaskAssignmentTargetKind = 'role'

  @Property({ name: 'role_id', type: 'uuid' })
  roleId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/** A threaded comment on a task. Author is set at creation and preserved as a
 *  plain id, so removing a user never destroys the thread. */
@Entity({ tableName: 'tasks_task_comments' })
@Index({ name: 'tasks_task_comments_task_idx', properties: ['taskId', 'createdAt'] })
@Index({ name: 'tasks_task_comments_author_idx', properties: ['authorUserId'] })
export class TasksTaskComment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ type: 'text' })
  body!: string

  @Property({ name: 'body_plaintext', type: 'text' })
  bodyPlaintext!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * A documentation / knowledge page inside a project. Self-referential
 * `parentId` gives a tree; `position` orders siblings. Body is rich HTML plus a
 * plaintext mirror. Deleting a parent re-parents children to null so a page
 * delete never cascades away a subtree.
 */
@Entity({ tableName: 'tasks_project_docs' })
@Index({ name: 'tasks_project_docs_project_idx', properties: ['projectId', 'position'] })
@Index({ name: 'tasks_project_docs_parent_idx', properties: ['parentId'] })
@Index({ name: 'tasks_project_docs_author_idx', properties: ['authorUserId'] })
export class TasksProjectDoc {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', default: '' })
  body: string = ''

  @Property({ name: 'body_plaintext', type: 'text', default: '' })
  bodyPlaintext: string = ''

  @Property({ type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** A per-scope label catalog shared across the scope's projects. Tasks
 *  reference labels through `TasksTaskLabel`. */
@Entity({ tableName: 'tasks_labels' })
@Index({ name: 'tasks_labels_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'tasks_labels_scope_name_uq', properties: ['tenantId', 'organizationId', 'name'] })
export class TasksLabel {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', default: '#64748B' })
  color: string = '#64748B'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** Task ↔ label join. Cross-scope references are blocked at the service layer
 *  (a label's scope must match the task's project scope). */
@Entity({ tableName: 'tasks_task_labels' })
@Index({ name: 'tasks_task_labels_task_idx', properties: ['taskId'] })
@Index({ name: 'tasks_task_labels_label_idx', properties: ['labelId'] })
@Unique({ name: 'tasks_task_labels_uq', properties: ['taskId', 'labelId'] })
export class TasksTaskLabel {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ name: 'label_id', type: 'uuid' })
  labelId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
