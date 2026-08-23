import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  searchParamsToObject,
  toErrorResponse,
} from '../../shared'
import { taskCalendarQuerySchema } from '../../../data/validators'
import type { MyTasksService } from '../../../services/myTasksService'
import { COMMON_ERRORS, TASKS_TAG, calendarResponseSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const query = taskCalendarQuerySchema.parse(searchParamsToObject(req.url))
    const service = resolveService<MyTasksService>(request, 'tasksMyTasksService')
    return jsonOk(await service.calendar(request.em, request.scope, request.userId, query))
  } catch (error) {
    return toErrorResponse(error, 'tasks.calendar')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'Calendar window over the caller\'s tasks',
  methods: {
    GET: {
      summary: 'Read a date-range window of the caller\'s tasks',
      description:
        '`scheduled` places tasks on their due date (the plan); `done` places them on the day they were completed, resolved to the caller\'s wall clock (the record). The window is capped, and the response says when it was cut rather than silently dropping rows.',
      query: taskCalendarQuerySchema,
      responses: [{ status: 200, description: 'The window.', schema: calendarResponseSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
