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
import { taskCompleteRequestSchema } from '../../../../data/validators'
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
    const body = taskCompleteRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.tasks.complete',
      input: { ...request.scope, id, tz: body.tz },
      resourceKind: 'tasks.task',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<TaskService>(request, 'tasksTaskService')
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.tasks.complete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'Complete a task',
  methods: {
    PATCH: {
      summary: 'Tick a task off',
      description:
        'A plain task becomes `done`. A recurring task instead advances to its next occurrence and returns to `pending`, so there is only ever one row per recurring commitment. Pass the caller\'s `tz` so "next occurrence" is computed against their today.',
      requestBody: { contentType: 'application/json', schema: taskCompleteRequestSchema },
      responses: [{ status: 200, description: 'The task after completion.', schema: taskDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
