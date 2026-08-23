import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  toErrorResponse,
} from '../../../shared'
import type { TaskService } from '../../../../services/taskService'
import { COMMON_ERRORS, TASKS_TAG, taskDetailSchema } from '../../../openapi'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['tasks.edit'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.tasks.reopen',
      input: { ...request.scope, id },
      resourceKind: 'tasks.task',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<TaskService>(request, 'tasksTaskService')
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.tasks.reopen')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'Reopen a task',
  methods: {
    PATCH: {
      summary: 'Reopen a finished or cancelled task',
      description: 'Returns the task to `pending` at the bottom of that column and clears its completion time.',
      responses: [{ status: 200, description: 'The reopened task.', schema: taskDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
