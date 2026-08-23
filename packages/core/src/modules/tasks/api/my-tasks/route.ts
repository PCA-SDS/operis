import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  searchParamsToObject,
  toErrorResponse,
} from '../shared'
import { myTasksQuerySchema } from '../../data/validators'
import type { MyTasksService } from '../../services/myTasksService'
import { COMMON_ERRORS, TASKS_TAG, pagedSchema, taskListItemSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const query = myTasksQuerySchema.parse(searchParamsToObject(req.url))
    const service = resolveService<MyTasksService>(request, 'tasksMyTasksService')
    return jsonOk(await service.list(request.em, request.scope, request.userId, query))
  } catch (error) {
    return toErrorResponse(error, 'tasks.myTasks')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'Cross-project personal task views',
  methods: {
    GET: {
      summary: 'List tasks for one of the personal views',
      description:
        'Every view except `completed` shows incomplete tasks only. `today` needs the caller\'s `tz` to resolve "today"; `assigned` covers both direct assignment and role audiences the caller belongs to.',
      query: myTasksQuerySchema,
      responses: [{ status: 200, description: 'Paged tasks.', schema: pagedSchema(taskListItemSchema) }],
      errors: [...COMMON_ERRORS],
    },
  },
}
