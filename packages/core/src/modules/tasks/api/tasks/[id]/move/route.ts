import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  toErrorResponse,
} from '../../../shared'
import { taskMoveRequestSchema } from '../../../../data/validators'
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
    const body = taskMoveRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.tasks.move',
      input: { ...body, ...request.scope, id },
      resourceKind: 'tasks.task',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<TaskService>(request, 'tasksTaskService')
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.tasks.move')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'Move a task on the board',
  methods: {
    PATCH: {
      summary: 'Move a task to a status and position',
      description:
        'Positions the task directly after `afterTaskId` in the target column; `null` puts it at the top. The server computes the rank between the neighbours, so two clients dragging at once cannot collide on an integer position.',
      requestBody: { contentType: 'application/json', schema: taskMoveRequestSchema },
      responses: [{ status: 200, description: 'The moved task.', schema: taskDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
