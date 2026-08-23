import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { jsonOk, resolveService, resolveTasksRequest, toErrorResponse } from '../shared'
import type { ProjectService } from '../../services/projectService'
import { COMMON_ERRORS, TASKS_TAG, assignmentOptionsSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<ProjectService>(request, 'tasksProjectService')
    return jsonOk(await service.assignmentOptions(request.em, request.scope))
  } catch (error) {
    return toErrorResponse(error, 'tasks.assignmentOptions')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'Role audiences a task can be assigned to',
  methods: {
    GET: {
      summary: 'List assignable roles',
      description:
        "Assigning a task to a role hands it to whoever holds that role at read time, so role changes propagate without touching the task.",
      responses: [
        { status: 200, description: 'Assignable roles.', schema: assignmentOptionsSchema },
      ],
      errors: [...COMMON_ERRORS],
    },
  },
}
