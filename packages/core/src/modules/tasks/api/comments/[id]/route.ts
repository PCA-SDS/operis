import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  callerHasFeature,
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  toErrorResponse,
  type TasksRequestContext,
} from '../../shared'
import { commentWriteRequestSchema } from '../../../data/validators'
import { toCommentDto, type CommentService } from '../../../services/commentService'
import { loadPeopleByIds } from '../../../lib/people'
import { COMMON_ERRORS, TASKS_TAG, okSchema, taskCommentSchema } from '../../openapi'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['tasks.comments.create'] },
  DELETE: { requireAuth: true, requireFeatures: ['tasks.comments.create'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * A comment is the author's own words, so editing or deleting someone else's is
 * a separate, higher grant rather than part of "can comment".
 */
async function assertCanModify(
  request: TasksRequestContext,
  authorUserId: string | null,
): Promise<Response | null> {
  if (authorUserId && authorUserId === request.userId) return null
  if (await callerHasFeature(request, 'tasks.comments.manage')) return null
  const { t } = await resolveTranslations()
  return NextResponse.json(
    { error: t('tasks.errors.commentNotYours', 'You can only edit your own comments.') },
    { status: 403 },
  )
}

export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<CommentService>(request, 'tasksCommentService')

    const existing = await service.requireComment(request.em, request.scope, id)
    const denied = await assertCanModify(request, existing.authorUserId ?? null)
    if (denied) return denied

    const body = commentWriteRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))
    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.comments.update',
      input: { ...body, ...request.scope, id },
      resourceKind: 'tasks.comment',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    request.em.clear()
    const updated = await service.requireComment(request.em, request.scope, id)
    const people = await loadPeopleByIds(
      request.em,
      request.scope,
      updated.authorUserId ? [updated.authorUserId] : [],
    )
    return jsonOk(toCommentDto(updated, people))
  } catch (error) {
    return toErrorResponse(error, 'tasks.comments.update')
  }
}

export async function DELETE(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<CommentService>(request, 'tasksCommentService')

    const existing = await service.requireComment(request.em, request.scope, id)
    const denied = await assertCanModify(request, existing.authorUserId ?? null)
    if (denied) return denied

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.comments.delete',
      input: { ...request.scope, id },
      resourceKind: 'tasks.comment',
      resourceId: id,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk({ ok: true })
  } catch (error) {
    return toErrorResponse(error, 'tasks.comments.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'A single task comment',
  methods: {
    PATCH: {
      summary: 'Edit a comment',
      description: "Authors may edit their own comments; editing anyone else's needs `tasks.comments.manage`.",
      requestBody: { contentType: 'application/json', schema: commentWriteRequestSchema },
      responses: [{ status: 200, description: 'The updated comment.', schema: taskCommentSchema }],
      errors: [...COMMON_ERRORS],
    },
    DELETE: {
      summary: 'Delete a comment',
      responses: [{ status: 200, description: 'Deleted.', schema: okSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
