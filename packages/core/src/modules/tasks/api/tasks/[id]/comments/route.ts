import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  searchParamsToObject,
  toErrorResponse,
} from '../../../shared'
import { commentListQuerySchema, commentWriteRequestSchema } from '../../../../data/validators'
import type { CommentService } from '../../../../services/commentService'
import { COMMON_ERRORS, TASKS_TAG, pagedSchema, taskCommentSchema } from '../../../openapi'
import { loadPeopleByIds } from '../../../../lib/people'
import { toCommentDto } from '../../../../services/commentService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
  POST: { requireAuth: true, requireFeatures: ['tasks.comments.create'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const query = commentListQuerySchema.parse(searchParamsToObject(req.url))
    const service = resolveService<CommentService>(request, 'tasksCommentService')
    return jsonOk(await service.list(request.em, request.scope, id, query))
  } catch (error) {
    return toErrorResponse(error, 'tasks.comments.list')
  }
}

export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = commentWriteRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand<Record<string, unknown>, { commentId: string }>({
      request,
      req,
      commandId: 'tasks.comments.create',
      input: { ...body, ...request.scope, taskId: id },
      resourceKind: 'tasks.comment',
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<CommentService>(request, 'tasksCommentService')
    const comment = await service.requireComment(request.em, request.scope, outcome.result.commentId)
    const people = await loadPeopleByIds(
      request.em,
      request.scope,
      comment.authorUserId ? [comment.authorUserId] : [],
    )
    return jsonOk(toCommentDto(comment, people))
  } catch (error) {
    return toErrorResponse(error, 'tasks.comments.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: "A task's comments",
  methods: {
    GET: {
      summary: 'List comments on a task',
      query: commentListQuerySchema,
      responses: [{ status: 200, description: 'Paged comments, newest first.', schema: pagedSchema(taskCommentSchema) }],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Comment on a task',
      description: 'The body is sanitised server-side and the author is taken from the session, never the payload.',
      requestBody: { contentType: 'application/json', schema: commentWriteRequestSchema },
      responses: [{ status: 200, description: 'The created comment.', schema: taskCommentSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
