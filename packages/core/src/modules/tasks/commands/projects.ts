import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { TasksProject, TasksProjectMember } from '../data/entities'
import { PROJECT_DEFAULT_ICON } from '../data/types'
import {
  projectArchiveCommandSchema,
  projectCreateCommandSchema,
  projectDeleteCommandSchema,
  projectUpdateCommandSchema,
  type ProjectArchiveInput,
  type ProjectCreateInput,
  type ProjectDeleteInput,
  type ProjectUpdateInput,
} from '../data/validators'
import { assertScopedUserIds } from '../lib/assignment'
import { loadTasksMessages } from '../lib/messages'
import { byId, normalizeText } from '../lib/values'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  forkEm,
  projectEvents,
  projectIndexer,
  readEm,
  scopeOf,
  todayUtcDate,
} from './shared'

type ProjectSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  key: string
  name: string
  description: string | null
  icon: string
  ownerUserId: string | null
  startDate: string | null
  archivedAt: string | null
  isInbox: boolean
  memberIds: string[]
}

type ProjectUndoPayload = { before?: ProjectSnapshot | null; after?: ProjectSnapshot | null }

async function loadProjectSnapshot(em: EntityManager, id: string): Promise<ProjectSnapshot | null> {
  const project = await em.findOne(TasksProject, { id })
  if (!project) return null
  const members = await em.find(TasksProjectMember, { projectId: id })
  return {
    id: project.id,
    tenantId: project.tenantId,
    organizationId: project.organizationId,
    key: project.key,
    name: project.name,
    description: project.description ?? null,
    icon: project.icon,
    ownerUserId: project.ownerUserId ?? null,
    startDate: project.startDate ? project.startDate.toISOString().slice(0, 10) : null,
    archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null,
    isInbox: project.isInbox,
    memberIds: members.map((member) => member.userId).sort(byId),
  }
}

/** Replace a project's member set. The owner is always a member — an owner who
 *  cannot see their own project would be a footgun, not a feature. */
async function syncMembers(
  em: EntityManager,
  project: TasksProject,
  memberIds: readonly string[],
  ownerUserId: string | null,
): Promise<void> {
  const desired = new Set(memberIds)
  if (ownerUserId) desired.add(ownerUserId)
  const existing = await em.find(TasksProjectMember, { projectId: project.id })
  const existingIds = new Set(existing.map((member) => member.userId))

  for (const member of existing) {
    if (!desired.has(member.userId)) em.remove(member)
  }
  for (const userId of desired) {
    if (existingIds.has(userId)) continue
    em.persist(
      em.create(TasksProjectMember, {
        tenantId: project.tenantId,
        organizationId: project.organizationId,
        projectId: project.id,
        userId,
        createdAt: new Date(),
      }),
    )
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code
  return code === '23505'
}

const createProjectCommand: CommandHandler<ProjectCreateInput, { projectId: string }> = {
  id: 'tasks.projects.create',
  async execute(rawInput, ctx) {
    const parsed = projectCreateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()

    const em = forkEm(ctx)
    const ownerUserId = parsed.ownerId ?? null
    const memberIds = await assertScopedUserIds(
      em,
      scope,
      [...(parsed.memberIds ?? []), ownerUserId],
      messages.unknownUsers,
    )

    const project = em.create(TasksProject, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      key: parsed.key,
      name: parsed.name,
      description: normalizeText(parsed.description),
      icon: parsed.icon ?? PROJECT_DEFAULT_ICON,
      ownerUserId,
      startDate: todayUtcDate(),
      isInbox: false,
      taskSeq: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    try {
      await withAtomicFlush(
        em,
        [
          () => {
            em.persist(project)
          },
          () => syncMembers(em, project, memberIds, ownerUserId),
        ],
        { transaction: true, label: 'tasks.projects.create' },
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw badRequest(messages.projectKeyTaken(parsed.key))
      throw error
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'created',
      entity: project,
      identifiers: { id: project.id, organizationId: project.organizationId, tenantId: project.tenantId },
      indexer: projectIndexer,
      events: projectEvents,
    })

    return { projectId: project.id }
  },
  captureAfter: async (_input, result, ctx) => loadProjectSnapshot(forkEm(ctx), result.projectId),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as ProjectSnapshot | undefined
    return {
      actionLabel: translate('tasks.audit.projects.create', 'Create project'),
      resourceKind: 'tasks.project',
      resourceId: result.projectId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot ?? null } satisfies ProjectUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const projectId = logEntry?.resourceId ?? null
    if (!projectId) return
    const em = forkEm(ctx)
    const project = await em.findOne(TasksProject, { id: projectId })
    if (!project) return
    em.remove(project)
    await em.flush()
  },
}

const updateProjectCommand: CommandHandler<ProjectUpdateInput, { projectId: string }> = {
  id: 'tasks.projects.update',
  async prepare(rawInput, ctx) {
    const parsed = projectUpdateCommandSchema.parse(rawInput)
    const snapshot = await loadProjectSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = projectUpdateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()

    const em = forkEm(ctx)
    const project = await em.findOne(TasksProject, {
      id: parsed.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!project) throw notFound(messages.projectNotFound)
    if (project.isInbox) throw badRequest(messages.inboxImmutable)

    const nextOwnerId = parsed.ownerId === undefined ? (project.ownerUserId ?? null) : parsed.ownerId
    if (parsed.ownerId !== undefined && parsed.ownerId) {
      await assertScopedUserIds(em, scope, [parsed.ownerId], messages.unknownUsers)
    }
    const memberIds =
      parsed.memberIds !== undefined
        ? await assertScopedUserIds(em, scope, [...parsed.memberIds, nextOwnerId], messages.unknownUsers)
        : null

    try {
      await withAtomicFlush(
        em,
        [
          () => {
            if (parsed.key !== undefined) project.key = parsed.key
            if (parsed.name !== undefined) project.name = parsed.name
            if (parsed.description !== undefined) project.description = normalizeText(parsed.description)
            if (parsed.icon !== undefined) project.icon = parsed.icon
            if (parsed.ownerId !== undefined) project.ownerUserId = parsed.ownerId ?? null
          },
          async () => {
            if (memberIds !== null) await syncMembers(em, project, memberIds, nextOwnerId)
          },
        ],
        { transaction: true, label: 'tasks.projects.update' },
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw badRequest(messages.projectKeyTaken(project.key))
      throw error
    }

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: project,
      identifiers: { id: project.id, organizationId: project.organizationId, tenantId: project.tenantId },
      indexer: projectIndexer,
      events: projectEvents,
    })

    return { projectId: project.id }
  },
  captureAfter: async (_input, result, ctx) => loadProjectSnapshot(forkEm(ctx), result.projectId),
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ProjectSnapshot | undefined
    if (!before) return null
    const after = snapshots.after as ProjectSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.projects.update', 'Update project'),
      resourceKind: 'tasks.project',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      changes:
        after
          ? buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
              'key',
              'name',
              'description',
              'icon',
              'ownerUserId',
              'memberIds',
            ])
          : {},
      payload: { undo: { before, after: after ?? null } satisfies ProjectUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ProjectUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const project = await em.findOne(TasksProject, { id: before.id })
    if (!project) return
    await withAtomicFlush(
      em,
      [
        () => {
          project.key = before.key
          project.name = before.name
          project.description = before.description
          project.icon = before.icon
          project.ownerUserId = before.ownerUserId
        },
        () => syncMembers(em, project, before.memberIds, before.ownerUserId),
      ],
      { transaction: true, label: 'tasks.projects.update.undo' },
    )
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: project,
      identifiers: { id: project.id, organizationId: project.organizationId, tenantId: project.tenantId },
      indexer: projectIndexer,
      events: projectEvents,
    })
  },
}

const archiveProjectCommand: CommandHandler<ProjectArchiveInput, { projectId: string; archived: boolean }> = {
  id: 'tasks.projects.archive',
  async prepare(rawInput, ctx) {
    const parsed = projectArchiveCommandSchema.parse(rawInput)
    const snapshot = await loadProjectSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = projectArchiveCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const messages = await loadTasksMessages()

    const em = forkEm(ctx)
    const project = await em.findOne(TasksProject, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!project) throw notFound(messages.projectNotFound)
    if (project.isInbox) throw badRequest(messages.inboxNotArchivable)

    project.archivedAt = parsed.archived ? new Date() : null
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: project,
      identifiers: { id: project.id, organizationId: project.organizationId, tenantId: project.tenantId },
      indexer: projectIndexer,
      events: { ...projectEvents, entity: 'project' },
    })

    return { projectId: project.id, archived: parsed.archived }
  },
  buildLog: async ({ result, snapshots }) => {
    const before = snapshots.before as ProjectSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: result.archived
        ? translate('tasks.audit.projects.archive', 'Archive project')
        : translate('tasks.audit.projects.restore', 'Restore project'),
      resourceKind: 'tasks.project',
      resourceId: result.projectId,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: { undo: { before: before ?? null } satisfies ProjectUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ProjectUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const project = await em.findOne(TasksProject, { id: before.id })
    if (!project) return
    project.archivedAt = before.archivedAt ? new Date(before.archivedAt) : null
    await em.flush()
  },
}

const deleteProjectCommand: CommandHandler<ProjectDeleteInput, { projectId: string }> = {
  id: 'tasks.projects.delete',
  async prepare(rawInput, ctx) {
    const parsed = projectDeleteCommandSchema.parse(rawInput)
    const snapshot = await loadProjectSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = projectDeleteCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const messages = await loadTasksMessages()

    const em = forkEm(ctx)
    const project = await em.findOne(TasksProject, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!project) throw notFound(messages.projectNotFound)
    if (project.isInbox) throw badRequest(messages.inboxNotDeletable)

    // Soft delete: the project's tasks, milestones and docs go with it, which is
    // what the confirmation dialog promises.
    const now = new Date()
    project.deletedAt = now
    await em.flush()
    await cascadeSoftDelete(em, project.id, now)

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'deleted',
      entity: project,
      identifiers: { id: project.id, organizationId: project.organizationId, tenantId: project.tenantId },
      indexer: projectIndexer,
      events: projectEvents,
    })

    return { projectId: project.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ProjectSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.projects.delete', 'Delete project'),
      resourceKind: 'tasks.project',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies ProjectUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ProjectUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const project = await em.findOne(TasksProject, { id: before.id })
    if (!project) return
    project.deletedAt = null
    await em.flush()
    await cascadeRestore(em, project.id)
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'created',
      entity: project,
      identifiers: { id: project.id, organizationId: project.organizationId, tenantId: project.tenantId },
      indexer: projectIndexer,
      events: projectEvents,
    })
  },
}

/** Soft-delete everything hanging off a project in one statement per table —
 *  a project with thousands of tasks must not become thousands of round trips. */
async function cascadeSoftDelete(em: EntityManager, projectId: string, at: Date): Promise<void> {
  const db = em.getKysely<any>() as any
  await db.updateTable('tasks_tasks').set({ deleted_at: at }).where('project_id', '=', projectId).where('deleted_at', 'is', null).execute()
  await db.updateTable('tasks_milestones').set({ deleted_at: at }).where('project_id', '=', projectId).where('deleted_at', 'is', null).execute()
  await db.updateTable('tasks_project_docs').set({ deleted_at: at }).where('project_id', '=', projectId).where('deleted_at', 'is', null).execute()
}

async function cascadeRestore(em: EntityManager, projectId: string): Promise<void> {
  const db = em.getKysely<any>() as any
  await db.updateTable('tasks_tasks').set({ deleted_at: null }).where('project_id', '=', projectId).execute()
  await db.updateTable('tasks_milestones').set({ deleted_at: null }).where('project_id', '=', projectId).execute()
  await db.updateTable('tasks_project_docs').set({ deleted_at: null }).where('project_id', '=', projectId).execute()
}

registerCommand(createProjectCommand)
registerCommand(updateProjectCommand)
registerCommand(archiveProjectCommand)
registerCommand(deleteProjectCommand)
