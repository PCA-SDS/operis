import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import {
  TasksProject,
  TasksTask,
  TasksTaskAssignee,
  TasksTaskAssignmentTarget,
  TasksTaskLabel,
} from '../data/entities'
import type { TaskStatus } from '../data/types'
import {
  taskCompleteCommandSchema,
  taskCreateCommandSchema,
  taskDeleteCommandSchema,
  taskMoveCommandSchema,
  taskReopenCommandSchema,
  taskUpdateCommandSchema,
  type TaskCompleteInput,
  type TaskCreateInput,
  type TaskDeleteInput,
  type TaskMoveInput,
  type TaskReopenInput,
  type TaskUpdateInput,
} from '../data/validators'
import { emitTasksEvent } from '../events'
import { assertScopedUserIds, normalizeAssignmentTargets } from '../lib/assignment'
import { loadTasksMessages, type TasksMessages } from '../lib/messages'
import { bottomRank, rankForMove, RANK_STEP } from '../lib/rank'
import {
  advanceAfterCompletion,
  firstOccurrenceOnOrAfter,
  normalizeRecurrence,
  type TaskRecurrenceRule,
} from '../lib/recurrence'
import { assertMilestoneInProject, assertNoSubtaskCycle, assertTaskInProject } from '../lib/taskValidation'
import { byId, dateOrNull, isoDate, resolveTimeZone, todayInTimeZone } from '../lib/values'
import type { TasksScope } from '../lib/people'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  forkEm,
  readEm,
  scopeOf,
  taskEvents,
  taskIndexer,
} from './shared'

type TaskSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  milestoneId: string | null
  parentTaskId: string | null
  number: number
  title: string
  description: string
  descriptionPlaintext: string
  status: TaskStatus
  priority: string
  reviewerUserId: string | null
  reporterUserId: string | null
  dueDate: string | null
  dueTime: string | null
  recurrenceFreq: string | null
  recurrenceWeekday: number | null
  recurrenceDayOfMonth: number | null
  completedAt: string | null
  rank: number
  assigneeIds: string[]
  targetRoleIds: string[]
  labelIds: string[]
}

type TaskUndoPayload = { before?: TaskSnapshot | null; after?: TaskSnapshot | null }

async function loadTaskSnapshot(em: EntityManager, id: string): Promise<TaskSnapshot | null> {
  const task = await em.findOne(TasksTask, { id })
  if (!task) return null
  const [assignees, targets, labels] = await Promise.all([
    em.find(TasksTaskAssignee, { taskId: id }),
    em.find(TasksTaskAssignmentTarget, { taskId: id }),
    em.find(TasksTaskLabel, { taskId: id }),
  ])
  return {
    id: task.id,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    projectId: task.projectId,
    milestoneId: task.milestoneId ?? null,
    parentTaskId: task.parentTaskId ?? null,
    number: task.number,
    title: task.title,
    description: task.description,
    descriptionPlaintext: task.descriptionPlaintext,
    status: task.status,
    priority: task.priority,
    reviewerUserId: task.reviewerUserId ?? null,
    reporterUserId: task.reporterUserId ?? null,
    dueDate: isoDate(task.dueDate),
    dueTime: task.dueTime ?? null,
    recurrenceFreq: task.recurrenceFreq ?? null,
    recurrenceWeekday: task.recurrenceWeekday ?? null,
    recurrenceDayOfMonth: task.recurrenceDayOfMonth ?? null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    rank: task.rank,
    assigneeIds: assignees.map((row) => row.userId).sort(byId),
    targetRoleIds: targets.map((row) => row.roleId).sort(byId),
    labelIds: labels.map((row) => row.labelId).sort(byId),
  }
}

async function requireProject(
  em: EntityManager,
  scope: TasksScope,
  projectId: string,
  messages: TasksMessages,
): Promise<TasksProject> {
  const project = await em.findOne(TasksProject, {
    id: projectId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!project) throw notFound(messages.projectNotFound)
  return project
}

async function requireTask(
  em: EntityManager,
  scope: TasksScope,
  id: string,
  messages: TasksMessages,
): Promise<TasksTask> {
  const task = await em.findOne(TasksTask, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!task) throw notFound(messages.taskNotFound)
  return task
}

async function assertScopedLabelIds(
  em: EntityManager,
  scope: TasksScope,
  ids: readonly string[],
  messages: TasksMessages,
): Promise<string[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  const db = em.getKysely<any>() as any
  const rows = (await db
    .selectFrom('tasks_labels')
    .select('id')
    .where('id', 'in', unique)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .execute()) as Array<{ id: string }>
  if (rows.length !== unique.length) throw badRequest(messages.unknownLabels)
  return unique
}

/** The next rank at the bottom of a status column. */
async function nextBottomRank(
  em: EntityManager,
  scope: TasksScope,
  projectId: string,
  status: TaskStatus,
): Promise<number> {
  const db = em.getKysely<any>() as any
  const row = (await db
    .selectFrom('tasks_tasks')
    .select((eb: any) => eb.fn.max('rank').as('max_rank'))
    .where('project_id', '=', projectId)
    .where('status', '=', status)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('archived_at', 'is', null)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()) as { max_rank: number | null } | undefined
  return bottomRank(row?.max_rank ?? null)
}

const targetMessages = (messages: TasksMessages) => ({
  tooMany: messages.tooManyTargets,
  missingRole: messages.targetNeedsRole,
  unknownKind: messages.unknownTargetKind,
  unknownRole: messages.unknownRoles,
})

function replaceJoinRows<T extends { taskId: string }>(
  em: EntityManager,
  existing: readonly T[],
  desired: readonly string[],
  keyOf: (row: T) => string,
  create: (value: string) => T,
): void {
  const wanted = new Set(desired)
  for (const row of existing) {
    if (!wanted.has(keyOf(row))) em.remove(row)
    else wanted.delete(keyOf(row))
  }
  for (const value of wanted) em.persist(create(value))
}

const createTaskCommand: CommandHandler<TaskCreateInput, { taskId: string }> = {
  id: 'tasks.tasks.create',
  async execute(rawInput, ctx) {
    const parsed = taskCreateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const project = await requireProject(em, scope, parsed.projectId, messages)
    const status: TaskStatus = parsed.status ?? 'backlog'

    const [assigneeIds, targets, labelIds] = await Promise.all([
      assertScopedUserIds(em, scope, parsed.assigneeIds ?? [], messages.unknownUsers),
      normalizeAssignmentTargets(em, scope, parsed.assignmentTargets, targetMessages(messages)),
      assertScopedLabelIds(em, scope, parsed.labelIds ?? [], messages),
    ])
    if (parsed.milestoneId) {
      await assertMilestoneInProject(em, scope, project.id, parsed.milestoneId, messages)
    }
    if (parsed.parentTaskId) {
      await assertTaskInProject(em, scope, project.id, parsed.parentTaskId, messages)
    }

    // A recurrence without a due date still needs a first occurrence, otherwise
    // the task would repeat from nowhere.
    let dueDateIso = parsed.dueDate ?? null
    let rule: TaskRecurrenceRule | null = null
    if (parsed.recurrence) {
      const base = dueDateIso ?? todayInTimeZone(resolveTimeZone(parsed.tz))
      rule = normalizeRecurrence(parsed.recurrence, base)
      dueDateIso = dueDateIso ?? firstOccurrenceOnOrAfter(rule, base)
    }
    if (parsed.dueTime != null && dueDateIso === null) throw badRequest(messages.dueTimeNeedsDate)

    const reporterUserId = parsed.reporterUserId ?? ctx.auth?.sub ?? null
    const rank = await nextBottomRank(em, scope, project.id, status)

    let taskId = ''
    await em.transactional(async (tx) => {
      // Re-read the counter inside the transaction so two concurrent creates
      // cannot mint the same PROJ-n reference.
      const owner = await tx.findOne(TasksProject, { id: project.id }, { lockMode: 2 as never })
      if (!owner) throw notFound(messages.projectNotFound)
      owner.taskSeq += 1

      const task = tx.create(TasksTask, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        projectId: project.id,
        milestoneId: parsed.milestoneId ?? null,
        parentTaskId: parsed.parentTaskId ?? null,
        number: owner.taskSeq,
        title: parsed.title,
        description: sanitizeRichTextHtml(parsed.description ?? ''),
        descriptionPlaintext: parsed.descriptionPlaintext ?? '',
        status,
        priority: parsed.priority ?? 'none',
        reviewerUserId: reporterUserId,
        reporterUserId,
        dueDate: dateOrNull(dueDateIso),
        dueTime: parsed.dueTime ?? null,
        recurrenceFreq: rule?.freq ?? null,
        recurrenceWeekday: rule?.weekday ?? null,
        recurrenceDayOfMonth: rule?.dayOfMonth ?? null,
        completedAt: status === 'done' ? new Date() : null,
        rank,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      tx.persist(task)
      await tx.flush()
      taskId = task.id

      for (const userId of assigneeIds) {
        tx.persist(
          tx.create(TasksTaskAssignee, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            taskId: task.id,
            userId,
            createdAt: new Date(),
          }),
        )
      }
      for (const target of targets) {
        tx.persist(
          tx.create(TasksTaskAssignmentTarget, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            taskId: task.id,
            kind: 'role',
            roleId: target.roleId,
            createdAt: new Date(),
          }),
        )
      }
      for (const labelId of labelIds) {
        tx.persist(
          tx.create(TasksTaskLabel, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            taskId: task.id,
            labelId,
            createdAt: new Date(),
          }),
        )
      }
      await tx.flush()
    })

    const created = await em.findOne(TasksTask, { id: taskId })
    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'created',
      entity: created,
      identifiers: { id: taskId, organizationId: scope.organizationId, tenantId: scope.tenantId },
      indexer: taskIndexer,
      events: taskEvents,
    })

    if (created && (assigneeIds.length > 0 || targets.length > 0)) {
      await announceAssignment(ctx, created, {
        assigneeIds,
        roleIds: targets.map((target) => target.roleId),
      })
    }

    return { taskId }
  },
  captureAfter: async (_input, result, ctx) => loadTaskSnapshot(forkEm(ctx), result.taskId),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as TaskSnapshot | undefined
    return {
      actionLabel: translate('tasks.audit.tasks.create', 'Create task'),
      resourceKind: 'tasks.task',
      resourceId: result.taskId,
      parentResourceKind: snapshot?.projectId ? 'tasks.project' : null,
      parentResourceId: snapshot?.projectId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot ?? null } satisfies TaskUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const taskId = logEntry?.resourceId ?? null
    if (!taskId) return
    const em = forkEm(ctx)
    const task = await em.findOne(TasksTask, { id: taskId })
    if (!task) return
    em.remove(task)
    await em.flush()
  },
}

const updateTaskCommand: CommandHandler<TaskUpdateInput, { taskId: string }> = {
  id: 'tasks.tasks.update',
  async prepare(rawInput, ctx) {
    const parsed = taskUpdateCommandSchema.parse(rawInput)
    const snapshot = await loadTaskSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = taskUpdateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const task = await requireTask(em, scope, parsed.id, messages)

    const assigneeIds =
      parsed.assigneeIds !== undefined
        ? await assertScopedUserIds(em, scope, parsed.assigneeIds, messages.unknownUsers)
        : null
    const targets =
      parsed.assignmentTargets !== undefined
        ? await normalizeAssignmentTargets(em, scope, parsed.assignmentTargets, targetMessages(messages))
        : null
    const labelIds =
      parsed.labelIds !== undefined ? await assertScopedLabelIds(em, scope, parsed.labelIds, messages) : null

    if (parsed.milestoneId) {
      await assertMilestoneInProject(em, scope, task.projectId, parsed.milestoneId, messages)
    }
    if (parsed.parentTaskId) {
      await assertTaskInProject(em, scope, task.projectId, parsed.parentTaskId, messages)
      await assertNoSubtaskCycle(em, scope, task.projectId, task.id, parsed.parentTaskId, messages)
    }

    const dueDateIso = parsed.dueDate !== undefined ? parsed.dueDate : isoDate(task.dueDate)
    const previousStatus = task.status
    const statusChanged = parsed.status !== undefined && parsed.status !== task.status
    const nextRank = statusChanged
      ? await nextBottomRank(em, scope, task.projectId, parsed.status as TaskStatus)
      : null

    await withAtomicFlush(
      em,
      [
        () => {
          if (parsed.title !== undefined) task.title = parsed.title
          if (parsed.description !== undefined) task.description = sanitizeRichTextHtml(parsed.description ?? '')
          if (parsed.descriptionPlaintext !== undefined) {
            task.descriptionPlaintext = parsed.descriptionPlaintext ?? ''
          }
          if (parsed.priority !== undefined) task.priority = parsed.priority
          if (parsed.milestoneId !== undefined) task.milestoneId = parsed.milestoneId ?? null
          if (parsed.parentTaskId !== undefined) task.parentTaskId = parsed.parentTaskId ?? null

          if (parsed.dueDate !== undefined) {
            task.dueDate = dateOrNull(parsed.dueDate)
            // Clearing the date clears what hangs off it, unless this same
            // request also set them explicitly.
            if (parsed.dueDate === null) {
              if (parsed.dueTime === undefined) task.dueTime = null
              if (parsed.recurrence === undefined) {
                task.recurrenceFreq = null
                task.recurrenceWeekday = null
                task.recurrenceDayOfMonth = null
              }
            }
          }
          if (parsed.dueTime !== undefined) {
            if (parsed.dueTime !== null && dueDateIso === null) throw badRequest(messages.dueTimeNeedsDate)
            task.dueTime = parsed.dueTime ?? null
          }
          if (parsed.recurrence !== undefined) {
            if (parsed.recurrence === null) {
              task.recurrenceFreq = null
              task.recurrenceWeekday = null
              task.recurrenceDayOfMonth = null
            } else {
              const base = dueDateIso ?? todayInTimeZone(resolveTimeZone(parsed.tz))
              const rule = normalizeRecurrence(parsed.recurrence, base)
              if (dueDateIso === null) task.dueDate = dateOrNull(firstOccurrenceOnOrAfter(rule, base))
              task.recurrenceFreq = rule.freq
              task.recurrenceWeekday = rule.weekday
              task.recurrenceDayOfMonth = rule.dayOfMonth
            }
          } else if (parsed.dueDate != null && task.recurrenceFreq) {
            // Moving a recurring task's due date re-anchors its rule to the new
            // weekday / day-of-month.
            const rule = normalizeRecurrence({ freq: task.recurrenceFreq }, parsed.dueDate)
            task.recurrenceWeekday = rule.weekday
            task.recurrenceDayOfMonth = rule.dayOfMonth
          }

          if (statusChanged) {
            task.status = parsed.status as TaskStatus
            task.rank = nextRank as number
            if (task.status === 'done') task.completedAt = new Date()
            else if (previousStatus === 'done') task.completedAt = null
          }
        },
        async () => {
          if (assigneeIds !== null) {
            const existing = await em.find(TasksTaskAssignee, { taskId: task.id })
            replaceJoinRows(
              em,
              existing,
              assigneeIds,
              (row) => row.userId,
              (userId) =>
                em.create(TasksTaskAssignee, {
                  tenantId: scope.tenantId,
                  organizationId: scope.organizationId,
                  taskId: task.id,
                  userId,
                  createdAt: new Date(),
                }),
            )
          }
          if (targets !== null) {
            const existing = await em.find(TasksTaskAssignmentTarget, { taskId: task.id })
            replaceJoinRows(
              em,
              existing,
              targets.map((target) => target.roleId),
              (row) => row.roleId,
              (roleId) =>
                em.create(TasksTaskAssignmentTarget, {
                  tenantId: scope.tenantId,
                  organizationId: scope.organizationId,
                  taskId: task.id,
                  kind: 'role',
                  roleId,
                  createdAt: new Date(),
                }),
            )
          }
          if (labelIds !== null) {
            const existing = await em.find(TasksTaskLabel, { taskId: task.id })
            replaceJoinRows(
              em,
              existing,
              labelIds,
              (row) => row.labelId,
              (labelId) =>
                em.create(TasksTaskLabel, {
                  tenantId: scope.tenantId,
                  organizationId: scope.organizationId,
                  taskId: task.id,
                  labelId,
                  createdAt: new Date(),
                }),
            )
          }
        },
      ],
      { transaction: true, label: 'tasks.tasks.update' },
    )

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      indexer: taskIndexer,
      events: taskEvents,
    })

    // A dedicated signal for "this landed on someone's plate". `tasks.task.updated`
    // fires on every edit, so notifying off it would mean a ping per keystroke-saved
    // field; this fires only when the audience actually changed.
    if (assigneeIds !== null || targets !== null) {
      await announceAssignment(ctx, task, {
        assigneeIds: assigneeIds ?? undefined,
        roleIds: targets?.map((target) => target.roleId),
      })
    }

    return { taskId: task.id }
  },
  captureAfter: async (_input, result, ctx) => loadTaskSnapshot(forkEm(ctx), result.taskId),
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TaskSnapshot | undefined
    if (!before) return null
    const after = snapshots.after as TaskSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.tasks.update', 'Update task'),
      resourceKind: 'tasks.task',
      resourceId: before.id,
      parentResourceKind: 'tasks.project',
      parentResourceId: before.projectId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      changes: after
        ? buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
            'title',
            'status',
            'priority',
            'dueDate',
            'dueTime',
            'milestoneId',
            'parentTaskId',
            'assigneeIds',
            'targetRoleIds',
            'labelIds',
          ])
        : {},
      payload: { undo: { before, after: after ?? null } satisfies TaskUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<TaskUndoPayload>(logEntry)?.before
    if (!before) return
    await restoreTaskFromSnapshot(ctx, before)
  },
}

const moveTaskCommand: CommandHandler<TaskMoveInput, { taskId: string }> = {
  id: 'tasks.tasks.move',
  async prepare(rawInput, ctx) {
    const parsed = taskMoveCommandSchema.parse(rawInput)
    const snapshot = await loadTaskSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = taskMoveCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const task = await requireTask(em, scope, parsed.id, messages)
    const previousStatus = task.status

    const column = await em.find(
      TasksTask,
      {
        projectId: task.projectId,
        status: parsed.status,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        archivedAt: null,
        deletedAt: null,
        id: { $ne: task.id },
      },
      { orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }] as never, fields: ['id', 'rank'] },
    )

    task.status = parsed.status
    task.rank = rankForMove(
      column.map((row) => ({ id: row.id, rank: row.rank })),
      parsed.afterTaskId ?? null,
    )
    if (parsed.status === 'done' && previousStatus !== 'done') task.completedAt = new Date()
    else if (parsed.status !== 'done' && previousStatus === 'done') task.completedAt = null
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      indexer: taskIndexer,
      events: taskEvents,
    })

    return { taskId: task.id }
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as TaskSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.tasks.move', 'Move task on the board'),
      resourceKind: 'tasks.task',
      resourceId: result.taskId,
      parentResourceKind: 'tasks.project',
      parentResourceId: before?.projectId ?? null,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: { undo: { before: before ?? null } satisfies TaskUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<TaskUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const task = await em.findOne(TasksTask, { id: before.id })
    if (!task) return
    task.status = before.status
    task.rank = before.rank
    task.completedAt = before.completedAt ? new Date(before.completedAt) : null
    await em.flush()
  },
}

const completeTaskCommand: CommandHandler<TaskCompleteInput, { taskId: string; recurring: boolean }> = {
  id: 'tasks.tasks.complete',
  async prepare(rawInput, ctx) {
    const parsed = taskCompleteCommandSchema.parse(rawInput)
    const snapshot = await loadTaskSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = taskCompleteCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const task = await requireTask(em, scope, parsed.id, messages)
    const recurring = !!task.recurrenceFreq

    if (recurring) {
      // A recurring task is never "done" — ticking it off rolls it to the next
      // occurrence, so there is exactly one row per recurring commitment.
      const today = todayInTimeZone(resolveTimeZone(parsed.tz))
      const nextIso = advanceAfterCompletion(
        {
          freq: task.recurrenceFreq!,
          weekday: task.recurrenceWeekday ?? null,
          dayOfMonth: task.recurrenceDayOfMonth ?? null,
        },
        isoDate(task.dueDate),
        today,
      )
      const rank =
        task.status === 'pending' ? task.rank : await nextBottomRank(em, scope, task.projectId, 'pending')
      task.dueDate = dateOrNull(nextIso)
      task.status = 'pending'
      task.completedAt = null
      task.rank = rank
    } else if (task.status !== 'done') {
      task.rank = await nextBottomRank(em, scope, task.projectId, 'done')
      task.status = 'done'
      task.completedAt = new Date()
    }
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      indexer: taskIndexer,
      events: taskEvents,
    })

    return { taskId: task.id, recurring }
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as TaskSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: result.recurring
        ? translate('tasks.audit.tasks.reschedule', 'Reschedule recurring task')
        : translate('tasks.audit.tasks.complete', 'Complete task'),
      resourceKind: 'tasks.task',
      resourceId: result.taskId,
      parentResourceKind: 'tasks.project',
      parentResourceId: before?.projectId ?? null,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: { undo: { before: before ?? null } satisfies TaskUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<TaskUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const task = await em.findOne(TasksTask, { id: before.id })
    if (!task) return
    task.status = before.status
    task.rank = before.rank
    task.dueDate = dateOrNull(before.dueDate)
    task.completedAt = before.completedAt ? new Date(before.completedAt) : null
    await em.flush()
  },
}

const reopenTaskCommand: CommandHandler<TaskReopenInput, { taskId: string }> = {
  id: 'tasks.tasks.reopen',
  async prepare(rawInput, ctx) {
    const parsed = taskReopenCommandSchema.parse(rawInput)
    const snapshot = await loadTaskSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = taskReopenCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const task = await requireTask(em, scope, parsed.id, messages)
    if (task.status === 'done' || task.status === 'cancelled') {
      task.rank = await nextBottomRank(em, scope, task.projectId, 'pending')
      task.status = 'pending'
      task.completedAt = null
      await em.flush()
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      indexer: taskIndexer,
      events: taskEvents,
    })

    return { taskId: task.id }
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as TaskSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.tasks.reopen', 'Reopen task'),
      resourceKind: 'tasks.task',
      resourceId: result.taskId,
      parentResourceKind: 'tasks.project',
      parentResourceId: before?.projectId ?? null,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: { undo: { before: before ?? null } satisfies TaskUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<TaskUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const task = await em.findOne(TasksTask, { id: before.id })
    if (!task) return
    task.status = before.status
    task.rank = before.rank
    task.completedAt = before.completedAt ? new Date(before.completedAt) : null
    await em.flush()
  },
}

const deleteTaskCommand: CommandHandler<TaskDeleteInput, { taskId: string }> = {
  id: 'tasks.tasks.delete',
  async prepare(rawInput, ctx) {
    const parsed = taskDeleteCommandSchema.parse(rawInput)
    const snapshot = await loadTaskSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = taskDeleteCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const task = await requireTask(em, scope, parsed.id, messages)
    const now = new Date()
    // Deleting a parent takes its whole subtree with it — that is what the
    // confirmation dialog says, and an orphaned subtask has no home to return to.
    const subtreeIds = await collectSubtreeIds(em, scope, task.projectId, task.id)
    const db = em.getKysely<any>() as any
    await db
      .updateTable('tasks_tasks')
      .set({ deleted_at: now })
      .where('id', 'in', subtreeIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .execute()
    await db
      .updateTable('tasks_task_comments')
      .set({ deleted_at: now })
      .where('task_id', 'in', subtreeIds)
      .where('deleted_at', 'is', null)
      .execute()
    em.clear()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'deleted',
      entity: task,
      identifiers: { id: task.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
      indexer: taskIndexer,
      events: taskEvents,
    })

    return { taskId: parsed.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TaskSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.tasks.delete', 'Delete task'),
      resourceKind: 'tasks.task',
      resourceId: before.id,
      parentResourceKind: 'tasks.project',
      parentResourceId: before.projectId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies TaskUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<TaskUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const subtreeIds = await collectSubtreeIds(em, scope, before.projectId, before.id, true)
    const db = em.getKysely<any>() as any
    await db
      .updateTable('tasks_tasks')
      .set({ deleted_at: null })
      .where('id', 'in', subtreeIds)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .execute()
    await db.updateTable('tasks_task_comments').set({ deleted_at: null }).where('task_id', 'in', subtreeIds).execute()
    em.clear()
    const task = await em.findOne(TasksTask, { id: before.id })
    if (!task) return
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'created',
      entity: task,
      identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
      indexer: taskIndexer,
      events: taskEvents,
    })
  },
}

/**
 * Tell the world a task's audience changed, so the notification subscriber can
 * reach the right people. Carries the resolved audience on the payload rather
 * than making every subscriber re-read the join tables, and names the actor so
 * nobody is notified about their own action.
 */
async function announceAssignment(
  ctx: CommandRuntimeContext,
  task: TasksTask,
  audience: { assigneeIds?: string[]; roleIds?: string[] },
): Promise<void> {
  await emitTasksEvent('tasks.task.assigned', {
    id: task.id,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    projectId: task.projectId,
    title: task.title,
    assigneeIds: audience.assigneeIds ?? [],
    roleIds: audience.roleIds ?? [],
    actorUserId: ctx.auth?.sub ?? null,
  })
}

/** The task plus every descendant, resolved from one read of the project's
 *  parent links rather than a recursive query per level. */
async function collectSubtreeIds(
  em: EntityManager,
  scope: TasksScope,
  projectId: string,
  rootId: string,
  includeDeleted = false,
): Promise<string[]> {
  const rows = await em.find(
    TasksTask,
    {
      projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    { fields: ['id', 'parentTaskId'] },
  )
  const childrenOf = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.parentTaskId) continue
    const bucket = childrenOf.get(row.parentTaskId)
    if (bucket) bucket.push(row.id)
    else childrenOf.set(row.parentTaskId, [row.id])
  }
  const collected: string[] = []
  const queue = [rootId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (collected.includes(current)) continue
    collected.push(current)
    queue.push(...(childrenOf.get(current) ?? []))
  }
  return collected
}

async function restoreTaskFromSnapshot(
  ctx: Parameters<NonNullable<CommandHandler<TaskUpdateInput, { taskId: string }>['undo']>>[0]['ctx'],
  before: TaskSnapshot,
): Promise<void> {
  const em = forkEm(ctx)
  const task = await em.findOne(TasksTask, { id: before.id })
  if (!task) return
  const scope = { tenantId: before.tenantId, organizationId: before.organizationId }

  await withAtomicFlush(
    em,
    [
      () => {
        task.title = before.title
        task.description = before.description
        task.descriptionPlaintext = before.descriptionPlaintext
        task.status = before.status
        task.priority = before.priority as TasksTask['priority']
        task.milestoneId = before.milestoneId
        task.parentTaskId = before.parentTaskId
        task.dueDate = dateOrNull(before.dueDate)
        task.dueTime = before.dueTime
        task.recurrenceFreq = before.recurrenceFreq as TasksTask['recurrenceFreq']
        task.recurrenceWeekday = before.recurrenceWeekday
        task.recurrenceDayOfMonth = before.recurrenceDayOfMonth
        task.completedAt = before.completedAt ? new Date(before.completedAt) : null
        task.rank = before.rank
      },
      async () => {
        const [assignees, targets, labels] = await Promise.all([
          em.find(TasksTaskAssignee, { taskId: task.id }),
          em.find(TasksTaskAssignmentTarget, { taskId: task.id }),
          em.find(TasksTaskLabel, { taskId: task.id }),
        ])
        replaceJoinRows(em, assignees, before.assigneeIds, (row) => row.userId, (userId) =>
          em.create(TasksTaskAssignee, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            taskId: task.id,
            userId,
            createdAt: new Date(),
          }),
        )
        replaceJoinRows(em, targets, before.targetRoleIds, (row) => row.roleId, (roleId) =>
          em.create(TasksTaskAssignmentTarget, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            taskId: task.id,
            kind: 'role',
            roleId,
            createdAt: new Date(),
          }),
        )
        replaceJoinRows(em, labels, before.labelIds, (row) => row.labelId, (labelId) =>
          em.create(TasksTaskLabel, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            taskId: task.id,
            labelId,
            createdAt: new Date(),
          }),
        )
      },
    ],
    { transaction: true, label: 'tasks.tasks.update.undo' },
  )

  await emitCrudUndoSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action: 'updated',
    entity: task,
    identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
    indexer: taskIndexer,
    events: taskEvents,
  })
}

export { RANK_STEP }

registerCommand(createTaskCommand)
registerCommand(updateTaskCommand)
registerCommand(moveTaskCommand)
registerCommand(completeTaskCommand)
registerCommand(reopenTaskCommand)
registerCommand(deleteTaskCommand)
