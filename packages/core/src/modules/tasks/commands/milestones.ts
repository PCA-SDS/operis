import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { TasksMilestone, TasksProject } from '../data/entities'
import type { MilestoneStatus } from '../data/types'
import {
  milestoneCreateCommandSchema,
  milestoneDeleteCommandSchema,
  milestoneUpdateCommandSchema,
  type MilestoneCreateInput,
  type MilestoneDeleteInput,
  type MilestoneUpdateInput,
} from '../data/validators'
import { loadTasksMessages } from '../lib/messages'
import { dateOrNull, isoDate, normalizeText } from '../lib/values'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  forkEm,
  milestoneEvents,
  milestoneIndexer,
  readEm,
  scopeOf,
} from './shared'

type MilestoneSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  name: string
  description: string | null
  status: MilestoneStatus
  dueDate: string | null
}

type MilestoneUndoPayload = { before?: MilestoneSnapshot | null; after?: MilestoneSnapshot | null }

async function loadSnapshot(em: EntityManager, id: string): Promise<MilestoneSnapshot | null> {
  const milestone = await em.findOne(TasksMilestone, { id })
  if (!milestone) return null
  return {
    id: milestone.id,
    tenantId: milestone.tenantId,
    organizationId: milestone.organizationId,
    projectId: milestone.projectId,
    name: milestone.name,
    description: milestone.description ?? null,
    status: milestone.status,
    dueDate: isoDate(milestone.dueDate),
  }
}

const createMilestoneCommand: CommandHandler<MilestoneCreateInput, { milestoneId: string }> = {
  id: 'tasks.milestones.create',
  async execute(rawInput, ctx) {
    const parsed = milestoneCreateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const project = await em.findOne(TasksProject, {
      id: parsed.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!project) throw notFound(messages.projectNotFound)

    const milestone = em.create(TasksMilestone, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      projectId: project.id,
      name: parsed.name,
      description: normalizeText(parsed.description),
      status: parsed.status ?? 'planned',
      dueDate: dateOrNull(parsed.dueDate),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(milestone)
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'created',
      entity: milestone,
      identifiers: { id: milestone.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
      indexer: milestoneIndexer,
      events: milestoneEvents,
    })

    return { milestoneId: milestone.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(forkEm(ctx), result.milestoneId),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as MilestoneSnapshot | undefined
    return {
      actionLabel: translate('tasks.audit.milestones.create', 'Create milestone'),
      resourceKind: 'tasks.milestone',
      resourceId: result.milestoneId,
      parentResourceKind: 'tasks.project',
      parentResourceId: snapshot?.projectId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot ?? null } satisfies MilestoneUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const id = logEntry?.resourceId ?? null
    if (!id) return
    const em = forkEm(ctx)
    const milestone = await em.findOne(TasksMilestone, { id })
    if (!milestone) return
    em.remove(milestone)
    await em.flush()
  },
}

const updateMilestoneCommand: CommandHandler<MilestoneUpdateInput, { milestoneId: string }> = {
  id: 'tasks.milestones.update',
  async prepare(rawInput, ctx) {
    const parsed = milestoneUpdateCommandSchema.parse(rawInput)
    const snapshot = await loadSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = milestoneUpdateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const milestone = await em.findOne(TasksMilestone, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!milestone) throw notFound(messages.milestoneNotFound)

    if (parsed.name !== undefined) milestone.name = parsed.name
    if (parsed.description !== undefined) milestone.description = normalizeText(parsed.description)
    if (parsed.status !== undefined) milestone.status = parsed.status
    if (parsed.dueDate !== undefined) milestone.dueDate = dateOrNull(parsed.dueDate)
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: milestone,
      identifiers: {
        id: milestone.id,
        organizationId: milestone.organizationId,
        tenantId: milestone.tenantId,
      },
      indexer: milestoneIndexer,
      events: milestoneEvents,
    })

    return { milestoneId: milestone.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(forkEm(ctx), result.milestoneId),
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as MilestoneSnapshot | undefined
    if (!before) return null
    const after = snapshots.after as MilestoneSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.milestones.update', 'Update milestone'),
      resourceKind: 'tasks.milestone',
      resourceId: before.id,
      parentResourceKind: 'tasks.project',
      parentResourceId: before.projectId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      changes: after
        ? buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
            'name',
            'description',
            'status',
            'dueDate',
          ])
        : {},
      payload: { undo: { before, after: after ?? null } satisfies MilestoneUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<MilestoneUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const milestone = await em.findOne(TasksMilestone, { id: before.id })
    if (!milestone) return
    milestone.name = before.name
    milestone.description = before.description
    milestone.status = before.status
    milestone.dueDate = dateOrNull(before.dueDate)
    await em.flush()
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: milestone,
      identifiers: {
        id: milestone.id,
        organizationId: milestone.organizationId,
        tenantId: milestone.tenantId,
      },
      indexer: milestoneIndexer,
      events: milestoneEvents,
    })
  },
}

const deleteMilestoneCommand: CommandHandler<MilestoneDeleteInput, { milestoneId: string }> = {
  id: 'tasks.milestones.delete',
  async prepare(rawInput, ctx) {
    const parsed = milestoneDeleteCommandSchema.parse(rawInput)
    const snapshot = await loadSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = milestoneDeleteCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const milestone = await em.findOne(TasksMilestone, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!milestone) throw notFound(messages.milestoneNotFound)

    // Tasks in the milestone stay; they just lose the grouping.
    const db = em.getKysely<any>() as any
    await db
      .updateTable('tasks_tasks')
      .set({ milestone_id: null })
      .where('milestone_id', '=', milestone.id)
      .execute()
    milestone.deletedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'deleted',
      entity: milestone,
      identifiers: {
        id: milestone.id,
        organizationId: milestone.organizationId,
        tenantId: milestone.tenantId,
      },
      indexer: milestoneIndexer,
      events: milestoneEvents,
    })

    return { milestoneId: milestone.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as MilestoneSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.milestones.delete', 'Delete milestone'),
      resourceKind: 'tasks.milestone',
      resourceId: before.id,
      parentResourceKind: 'tasks.project',
      parentResourceId: before.projectId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies MilestoneUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<MilestoneUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const milestone = await em.findOne(TasksMilestone, { id: before.id })
    if (!milestone) return
    milestone.deletedAt = null
    await em.flush()
  },
}

registerCommand(createMilestoneCommand)
registerCommand(updateMilestoneCommand)
registerCommand(deleteMilestoneCommand)
