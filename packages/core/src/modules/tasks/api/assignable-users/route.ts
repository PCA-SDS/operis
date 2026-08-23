import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { jsonOk, resolveService, resolveTasksRequest, toErrorResponse } from '../shared'
import type { ProjectService } from '../../services/projectService'
import { COMMON_ERRORS, TASKS_TAG, assignableUserSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<ProjectService>(request, 'tasksProjectService')
    return jsonOk({ items: await service.assignableUsers(request.em, request.scope) })
  } catch (error) {
    return toErrorResponse(error, 'tasks.assignableUsers')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'People a task can be assigned to',
  methods: {
    GET: {
      summary: 'List assignable people',
      description:
        "The organization's own users plus tenant-level users who carry no organization. Never crosses a tenant boundary.",
      responses: [
        {
          status: 200,
          description: 'Assignable people.',
          schema: z.object({ items: z.array(assignableUserSchema) }),
        },
      ],
      errors: [...COMMON_ERRORS],
    },
  },
}
