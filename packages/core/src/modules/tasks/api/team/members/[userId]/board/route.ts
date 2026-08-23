import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { jsonOk, resolveService, resolveTasksRequest, toErrorResponse } from '../../../../shared'
import type { TeamService } from '../../../../../services/teamService'
import { COMMON_ERRORS, TASKS_TAG, taskBoardSchema } from '../../../../openapi'

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
    const service = resolveService<TeamService>(request, 'tasksTeamService')
    return jsonOk(await service.memberBoard(request.em, request.scope, request.userId, userId))
  } catch (error) {
    return toErrorResponse(error, 'tasks.team.memberBoard')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: "One teammate's board",
  methods: {
    GET: {
      summary: "Read a teammate's tasks as a board",
      description: 'Answers 403 when the target is outside the caller\'s organization.',
      responses: [{ status: 200, description: 'The board.', schema: taskBoardSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
