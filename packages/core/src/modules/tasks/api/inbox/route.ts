import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { jsonOk, resolveService, resolveTasksRequest, toErrorResponse } from '../shared'
import type { ProjectService } from '../../services/projectService'
import { COMMON_ERRORS, TASKS_TAG, projectDetailSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<ProjectService>(request, 'tasksProjectService')
    return jsonOk(await service.ensureInbox(request.em, request.scope))
  } catch (error) {
    return toErrorResponse(error, 'tasks.inbox')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'The scope\'s Inbox project',
  methods: {
    GET: {
      summary: 'Read (and lazily create) the Inbox project',
      description:
        'Quick Add drops project-less tasks here. The project is created on first read and is hidden from project lists.',
      responses: [{ status: 200, description: 'The Inbox project.', schema: projectDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
