import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { jsonOk, resolveService, resolveTasksRequest, toErrorResponse } from '../../../shared'
import type { TaskService } from '../../../../services/taskService'
import { COMMON_ERRORS, TASKS_TAG, taskBoardSchema } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<TaskService>(request, 'tasksTaskService')
    return jsonOk(await service.board(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.board')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: "A project's board",
  methods: {
    GET: {
      summary: 'Read the whole board',
      description:
        'Every non-archived task in the project, ordered by rank. Not paginated — a Kanban shows all its columns at once.',
      responses: [{ status: 200, description: 'The board.', schema: taskBoardSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
