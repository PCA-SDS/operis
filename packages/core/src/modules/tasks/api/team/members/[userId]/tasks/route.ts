import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  searchParamsToObject,
  toErrorResponse,
} from '../../../../shared'
import { teamTasksQuerySchema } from '../../../../../data/validators'
import type { TeamService } from '../../../../../services/teamService'
import { COMMON_ERRORS, TASKS_TAG, pagedSchema, taskListItemSchema } from '../../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.team.view'] },
}

const paramsSchema = z.object({ userId: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { userId } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const query = teamTasksQuerySchema.parse(searchParamsToObject(req.url))
    const service = resolveService<TeamService>(request, 'tasksTeamService')
    return jsonOk(await service.memberTasks(request.em, request.scope, request.userId, userId, query))
  } catch (error) {
    return toErrorResponse(error, 'tasks.team.memberTasks')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: "One teammate's task list",
  methods: {
    GET: {
      summary: "Read a teammate's tasks as a paged list",
      query: teamTasksQuerySchema,
      responses: [{ status: 200, description: 'Paged tasks.', schema: pagedSchema(taskListItemSchema) }],
      errors: [...COMMON_ERRORS],
    },
  },
}
