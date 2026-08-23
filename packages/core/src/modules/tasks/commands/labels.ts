import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { TasksLabel } from '../data/entities'
import { LABEL_DEFAULT_COLOR } from '../data/types'
import {
  labelCreateCommandSchema,
  labelDeleteCommandSchema,
  labelUpdateCommandSchema,
  type LabelCreateInput,
  type LabelDeleteInput,
  type LabelUpdateInput,
} from '../data/validators'
import { loadTasksMessages } from '../lib/messages'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  forkEm,
  labelEvents,
  labelIndexer,
  readEm,
  scopeOf,
} from './shared'

type LabelSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  color: string
}

type LabelUndoPayload = { before?: LabelSnapshot | null; after?: LabelSnapshot | null }

async function loadSnapshot(em: EntityManager, id: string): Promise<LabelSnapshot | null> {
  const label = await em.findOne(TasksLabel, { id })
  if (!label) return null
  return {
    id: label.id,
    tenantId: label.tenantId,
    organizationId: label.organizationId,
    name: label.name,
    color: label.color,
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505'
}

const createLabelCommand: CommandHandler<LabelCreateInput, { labelId: string }> = {
  id: 'tasks.labels.create',
  async execute(rawInput, ctx) {
    const parsed = labelCreateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const label = em.create(TasksLabel, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: parsed.name,
      color: parsed.color ?? LABEL_DEFAULT_COLOR,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(label)
    try {
      await em.flush()
    } catch (error) {
      if (isUniqueViolation(error)) throw badRequest(messages.labelNameTaken(parsed.name))
      throw error
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'created',
      entity: label,
      identifiers: { id: label.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
      indexer: labelIndexer,
      events: labelEvents,
    })

    return { labelId: label.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(forkEm(ctx), result.labelId),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as LabelSnapshot | undefined
    return {
      actionLabel: translate('tasks.audit.labels.create', 'Create label'),
      resourceKind: 'tasks.label',
      resourceId: result.labelId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot ?? null } satisfies LabelUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const id = logEntry?.resourceId ?? null
    if (!id) return
    const em = forkEm(ctx)
    const label = await em.findOne(TasksLabel, { id })
    if (!label) return
    em.remove(label)
    await em.flush()
  },
}

const updateLabelCommand: CommandHandler<LabelUpdateInput, { labelId: string }> = {
  id: 'tasks.labels.update',
  async prepare(rawInput, ctx) {
    const parsed = labelUpdateCommandSchema.parse(rawInput)
    const snapshot = await loadSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = labelUpdateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const label = await em.findOne(TasksLabel, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!label) throw notFound(messages.labelNotFound)

    if (parsed.name !== undefined) label.name = parsed.name
    if (parsed.color !== undefined) label.color = parsed.color
    try {
      await em.flush()
    } catch (error) {
      if (isUniqueViolation(error)) throw badRequest(messages.labelNameTaken(label.name))
      throw error
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: label,
      identifiers: { id: label.id, organizationId: label.organizationId, tenantId: label.tenantId },
      indexer: labelIndexer,
      events: labelEvents,
    })

    return { labelId: label.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(forkEm(ctx), result.labelId),
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as LabelSnapshot | undefined
    if (!before) return null
    const after = snapshots.after as LabelSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.labels.update', 'Update label'),
      resourceKind: 'tasks.label',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: { undo: { before, after: after ?? null } satisfies LabelUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<LabelUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const label = await em.findOne(TasksLabel, { id: before.id })
    if (!label) return
    label.name = before.name
    label.color = before.color
    await em.flush()
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: label,
      identifiers: { id: label.id, organizationId: label.organizationId, tenantId: label.tenantId },
      indexer: labelIndexer,
      events: labelEvents,
    })
  },
}

const deleteLabelCommand: CommandHandler<LabelDeleteInput, { labelId: string }> = {
  id: 'tasks.labels.delete',
  async prepare(rawInput, ctx) {
    const parsed = labelDeleteCommandSchema.parse(rawInput)
    const snapshot = await loadSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = labelDeleteCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const label = await em.findOne(TasksLabel, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!label) throw notFound(messages.labelNotFound)

    // Removing a label from the catalog takes it off every task that carried it.
    const db = em.getKysely<any>() as any
    await db.deleteFrom('tasks_task_labels').where('label_id', '=', label.id).execute()
    label.deletedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'deleted',
      entity: label,
      identifiers: { id: label.id, organizationId: label.organizationId, tenantId: label.tenantId },
      indexer: labelIndexer,
      events: labelEvents,
    })

    return { labelId: label.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as LabelSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.labels.delete', 'Delete label'),
      resourceKind: 'tasks.label',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies LabelUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<LabelUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const label = await em.findOne(TasksLabel, { id: before.id })
    if (!label) return
    label.deletedAt = null
    await em.flush()
  },
}

registerCommand(createLabelCommand)
registerCommand(updateLabelCommand)
registerCommand(deleteLabelCommand)
