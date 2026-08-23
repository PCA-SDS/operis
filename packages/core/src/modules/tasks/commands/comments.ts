import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { TasksTask, TasksTaskComment } from '../data/entities'
import {
  commentCreateCommandSchema,
  commentDeleteCommandSchema,
  commentUpdateCommandSchema,
  type TaskCommentCreateInput,
  type TaskCommentDeleteInput,
  type TaskCommentUpdateInput,
} from '../data/validators'
import { loadTasksMessages } from '../lib/messages'
import {
  commentEvents,
  commentIndexer,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  forkEm,
  readEm,
  scopeOf,
} from './shared'

type CommentSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  taskId: string
  authorUserId: string | null
  body: string
  bodyPlaintext: string
}

type CommentUndoPayload = { before?: CommentSnapshot | null; after?: CommentSnapshot | null }

async function loadSnapshot(em: EntityManager, id: string): Promise<CommentSnapshot | null> {
  const comment = await em.findOne(TasksTaskComment, { id })
  if (!comment) return null
  return {
    id: comment.id,
    tenantId: comment.tenantId,
    organizationId: comment.organizationId,
    taskId: comment.taskId,
    authorUserId: comment.authorUserId ?? null,
    body: comment.body,
    bodyPlaintext: comment.bodyPlaintext,
  }
}

const createCommentCommand: CommandHandler<TaskCommentCreateInput, { commentId: string }> = {
  id: 'tasks.comments.create',
  async execute(rawInput, ctx) {
    const parsed = commentCreateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const task = await em.findOne(TasksTask, {
      id: parsed.taskId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!task) throw notFound(messages.taskNotFound)

    const comment = em.create(TasksTaskComment, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      taskId: task.id,
      // Authorship is the server's to decide — a client that names someone else
      // as the author would be forging a comment.
      authorUserId: ctx.auth?.sub ?? parsed.authorUserId ?? null,
      body: sanitizeRichTextHtml(parsed.body),
      bodyPlaintext: parsed.plaintext,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(comment)
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'created',
      entity: comment,
      identifiers: { id: comment.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
      indexer: commentIndexer,
      events: commentEvents,
    })

    return { commentId: comment.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(forkEm(ctx), result.commentId),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as CommentSnapshot | undefined
    return {
      actionLabel: translate('tasks.audit.comments.create', 'Comment on task'),
      resourceKind: 'tasks.comment',
      resourceId: result.commentId,
      parentResourceKind: 'tasks.task',
      parentResourceId: snapshot?.taskId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot ?? null } satisfies CommentUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const id = logEntry?.resourceId ?? null
    if (!id) return
    const em = forkEm(ctx)
    const comment = await em.findOne(TasksTaskComment, { id })
    if (!comment) return
    em.remove(comment)
    await em.flush()
  },
}

const updateCommentCommand: CommandHandler<TaskCommentUpdateInput, { commentId: string }> = {
  id: 'tasks.comments.update',
  async prepare(rawInput, ctx) {
    const parsed = commentUpdateCommandSchema.parse(rawInput)
    const snapshot = await loadSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = commentUpdateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const comment = await em.findOne(TasksTaskComment, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!comment) throw notFound(messages.commentNotFound)

    comment.body = sanitizeRichTextHtml(parsed.body)
    comment.bodyPlaintext = parsed.plaintext
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: comment,
      identifiers: {
        id: comment.id,
        organizationId: comment.organizationId,
        tenantId: comment.tenantId,
      },
      indexer: commentIndexer,
      events: commentEvents,
    })

    return { commentId: comment.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(forkEm(ctx), result.commentId),
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as CommentSnapshot | undefined
    if (!before) return null
    const after = snapshots.after as CommentSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.comments.update', 'Edit task comment'),
      resourceKind: 'tasks.comment',
      resourceId: before.id,
      parentResourceKind: 'tasks.task',
      parentResourceId: before.taskId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: { undo: { before, after: after ?? null } satisfies CommentUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<CommentUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const comment = await em.findOne(TasksTaskComment, { id: before.id })
    if (!comment) return
    comment.body = before.body
    comment.bodyPlaintext = before.bodyPlaintext
    await em.flush()
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: comment,
      identifiers: {
        id: comment.id,
        organizationId: comment.organizationId,
        tenantId: comment.tenantId,
      },
      indexer: commentIndexer,
      events: commentEvents,
    })
  },
}

const deleteCommentCommand: CommandHandler<TaskCommentDeleteInput, { commentId: string }> = {
  id: 'tasks.comments.delete',
  async prepare(rawInput, ctx) {
    const parsed = commentDeleteCommandSchema.parse(rawInput)
    const snapshot = await loadSnapshot(readEm(ctx), parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = commentDeleteCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const messages = await loadTasksMessages()
    const em = forkEm(ctx)

    const comment = await em.findOne(TasksTaskComment, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!comment) throw notFound(messages.commentNotFound)

    comment.deletedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'deleted',
      entity: comment,
      identifiers: {
        id: comment.id,
        organizationId: comment.organizationId,
        tenantId: comment.tenantId,
      },
      indexer: commentIndexer,
      events: commentEvents,
    })

    return { commentId: comment.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as CommentSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('tasks.audit.comments.delete', 'Delete task comment'),
      resourceKind: 'tasks.comment',
      resourceId: before.id,
      parentResourceKind: 'tasks.task',
      parentResourceId: before.taskId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies CommentUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<CommentUndoPayload>(logEntry)?.before
    if (!before) return
    const em = forkEm(ctx)
    const comment = await em.findOne(TasksTaskComment, { id: before.id })
    if (!comment) return
    comment.deletedAt = null
    await em.flush()
  },
}

registerCommand(createCommentCommand)
registerCommand(updateCommentCommand)
registerCommand(deleteCommentCommand)
