import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { jsonOk, resolveService, resolveTasksRequest, toErrorResponse } from '../../shared'
import type { TeamService } from '../../../services/teamService'
import { COMMON_ERRORS, TASKS_TAG, teamMembersSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.team.view'] },
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<TeamService>(request, 'tasksTeamService')
    return jsonOk(await service.listMembers(request.em, request.scope, request.userId))
  } catch (error) {
    return toErrorResponse(error, 'tasks.team.members')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'People whose tasks the caller may view',
  methods: {
    GET: {
      summary: 'List team members',
      description:
        "Everyone in the caller's organization, the caller first, each with the count of tasks still on their plate (direct assignment and role audiences combined, deduplicated).",
      responses: [{ status: 200, description: 'Team members.', schema: teamMembersSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
