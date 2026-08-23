import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  toErrorResponse,
} from '../../shared'
import { taskUpdateRequestSchema } from '../../../data/validators'
import type { TaskService } from '../../../services/taskService'
import { COMMON_ERRORS, TASKS_TAG, okSchema, taskDetailSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['tasks.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['tasks.delete'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<TaskService>(request, 'tasksTaskService')
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.tasks.detail')
  }
}

export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = taskUpdateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.tasks.update',
      input: { ...body, ...request.scope, id },
      resourceKind: 'tasks.task',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<TaskService>(request, 'tasksTaskService')
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.tasks.update')
  }
}

export async function DELETE(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.tasks.delete',
      input: { ...request.scope, id },
      resourceKind: 'tasks.task',
      resourceId: id,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk({ ok: true })
  } catch (error) {
    return toErrorResponse(error, 'tasks.tasks.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'A single task',
  methods: {
    GET: {
      summary: 'Read a task with its subtasks',
      responses: [{ status: 200, description: 'The task.', schema: taskDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
    PATCH: {
      summary: 'Update a task',
      description:
        'Only the provided fields change. `assigneeIds`, `assignmentTargets` and `labelIds` each replace their whole set when present. Clearing `dueDate` also clears the due time and recurrence unless the same request sets them.',
      requestBody: { contentType: 'application/json', schema: taskUpdateRequestSchema },
      responses: [{ status: 200, description: 'The updated task.', schema: taskDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
    DELETE: {
      summary: 'Delete a task and its subtree',
      responses: [{ status: 200, description: 'Deleted.', schema: okSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
