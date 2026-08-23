import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { TasksProject, TasksProjectDoc } from '../data/entities'
import {
  docCreateCommandSchema,
  docDeleteCommandSchema,
  docUpdateCommandSchema,
  type ProjectDocCreateInput,
  type ProjectDocDeleteInput,
  type ProjectDocUpdateInput,
} from '../data/validators'
import { loadTasksMessages } from '../lib/messages'
import { assertNoDocCycle } from '../lib/taskValidation'
import {
  docEvents,
  docIndexer,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  forkEm,
  readEm,
  scopeOf,
} from './shared'

type DocSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  parentId: string | null
  authorUserId: string | null
  title: string
  body: string
  bodyPlaintext: string
  position: number
}

type DocUndoPayload = { before?: DocSnapshot | null; after?: DocSnapshot | null }

async function loadSnapshot(em: EntityManager, id: string): Promise<DocSnapshot | null> {
  const doc = await em.findOne(TasksProjectDoc, { id })
  if (!doc) return null
  return {
    id: doc.id,
    tenantId: doc.tenantId,
    organizationId: doc.organizationId,
    projectId: doc.projectId,
    parentId: doc.parentId ?? null,
    authorUserId: doc.authorUserId ?? null,
    title: doc.title,
    body: doc.body,
    bodyPlaintext: doc.bodyPlaintext,
    position: doc.position,
  }
}

async function nextPosition(
  em: EntityManager,
  projectId: string,
  parentId: string | null,
): Promise<number> {
  const db = em.getKysely<any>() as any
  let query = db
    .selectFrom('tasks_project_docs')
    .select((eb: any) => eb.fn.max('position').as('max_position'))
    .where('project_id', '=', projectId)
    .where('deleted_at', 'is', null)
  query = parentId ? query.where('parent_id', '=', parentId) : query.where('parent_id', 'is', null)
  const row = (await query.executeTakeFirst()) as { max_position: number | null } | undefined
  return (row?.max_position ?? -1) + 1
}

const createDocCommand: CommandHandler<ProjectDocCreateInput, { docId: string }> = {
  id: 'tasks.docs.create',
  async execute(rawInput, ctx) {
    const parsed = docCreateCommandSchema.parse(rawInput)
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

    if (parsed.parentId) {
      const parent = await em.findOne(TasksProjectDoc, {
        id: parsed.parentId,
        projectId: project.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!parent) throw badRequest(messages.docWrongProject)
    }

    const doc = em.create(TasksProjectDoc, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      projectId: project.id,
      parentId: parsed.parentId ?? null,
      authorUserId: ctx.auth?.sub ?? parsed.authorUserId ?? null,
      title: parsed.title,
      body: sanitizeRichTextHtml(parsed.body ?? ''),
      bodyPlaintext: parsed.plaintext ?? '',
      position: await nextPosition(em, project.id, parsed.parentId ?? null),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(doc)
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'created',
      entity: doc,
      identifiers: { id: doc.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
      indexer: docIndexer,
      events: docEvents,
    })

    return { docId: doc.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(forkEm(ctx), result.docId),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as DocSnapshot | undefined
    return {
      actionLabel: translate('tasks.audit.docs.create', 'Create project page'),
      resourceKind: 'tasks.doc',
      resourceId: result.docId,
      parentResourceKind: 'tasks.project',
      parentResourceId: snapshot?.projectId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot ?? null } satisfies DocUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const id = logEntry?.resourceId ?? null
    if (!id) return
    const em = forkEm(ctx)
    const doc = await em.findOne(TasksProjectDoc, { id })
    if (!doc) return
    em.remove(doc)
    await em.flush()
  },
}

const updateDocCommand: CommandHandler<ProjectDocUpdateInput, { docId: string }> = {
  id: 'tasks.docs.update',
  async prepare(rawInput, ctx) {
    const parsed = docUpdateCommandSchema.parse(rawInput)
    const snapshot = await loadSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = docUpdateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const doc = await em.findOne(TasksProjectDoc, {
      id: parsed.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!doc) throw notFound(messages.docNotFound)

    if (parsed.parentId !== undefined && parsed.parentId !== null) {
      const siblings = await em.find(
        TasksProjectDoc,
        {
          projectId: doc.projectId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        { fields: ['id', 'parentId'] },
      )
      if (!siblings.some((row) => row.id === parsed.parentId)) throw badRequest(messages.docWrongProject)
      await assertNoDocCycle(
        new Map(siblings.map((row) => [row.id, row.parentId ?? null])),
        doc.id,
        parsed.parentId,
        messages,
      )
    }

    if (parsed.title !== undefined) doc.title = parsed.title
    if (parsed.body !== undefined) doc.body = sanitizeRichTextHtml(parsed.body)
    if (parsed.plaintext !== undefined) doc.bodyPlaintext = parsed.plaintext
    if (parsed.parentId !== undefined) {
      doc.parentId = parsed.parentId ?? null
      doc.position = await nextPosition(em, doc.projectId, doc.parentId)
    }
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: doc,
      identifiers: { id: doc.id, organizationId: doc.organizationId, tenantId: doc.tenantId },
      indexer: docIndexer,
      events: docEvents,
    })

    return { docId: doc.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(forkEm(ctx), result.docId),
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as DocSnapshot | undefined
    if (!before) return null
    const after = snapshots.after as DocSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.docs.update', 'Update project page'),
      resourceKind: 'tasks.doc',
      resourceId: before.id,
      parentResourceKind: 'tasks.project',
      parentResourceId: before.projectId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: { undo: { before, after: after ?? null } satisfies DocUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<DocUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const doc = await em.findOne(TasksProjectDoc, { id: before.id })
    if (!doc) return
    doc.title = before.title
    doc.body = before.body
    doc.bodyPlaintext = before.bodyPlaintext
    doc.parentId = before.parentId
    doc.position = before.position
    await em.flush()
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: doc,
      identifiers: { id: doc.id, organizationId: doc.organizationId, tenantId: doc.tenantId },
      indexer: docIndexer,
      events: docEvents,
    })
  },
}

const deleteDocCommand: CommandHandler<ProjectDocDeleteInput, { docId: string }> = {
  id: 'tasks.docs.delete',
  async prepare(rawInput, ctx) {
    const parsed = docDeleteCommandSchema.parse(rawInput)
    const snapshot = await loadSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = docDeleteCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const doc = await em.findOne(TasksProjectDoc, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!doc) throw notFound(messages.docNotFound)

    // Sub-pages survive and move up a level: deleting one page must never take
    // an unrelated subtree with it.
    const db = em.getKysely<any>() as any
    await db
      .updateTable('tasks_project_docs')
      .set({ parent_id: doc.parentId ?? null })
      .where('parent_id', '=', doc.id)
      .execute()
    doc.deletedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'deleted',
      entity: doc,
      identifiers: { id: doc.id, organizationId: doc.organizationId, tenantId: doc.tenantId },
      indexer: docIndexer,
      events: docEvents,
    })

    return { docId: doc.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as DocSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.docs.delete', 'Delete project page'),
      resourceKind: 'tasks.doc',
      resourceId: before.id,
      parentResourceKind: 'tasks.project',
      parentResourceId: before.projectId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies DocUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<DocUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const doc = await em.findOne(TasksProjectDoc, { id: before.id })
    if (!doc) return
    doc.deletedAt = null
    await em.flush()
  },
}

registerCommand(createDocCommand)
registerCommand(updateDocCommand)
registerCommand(deleteDocCommand)
