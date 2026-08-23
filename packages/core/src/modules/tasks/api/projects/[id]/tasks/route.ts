import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  searchParamsToObject,
  toErrorResponse,
} from '../../../shared'
import { taskCreateRequestSchema, taskListQuerySchema } from '../../../../data/validators'
import type { TaskService } from '../../../../services/taskService'
import { COMMON_ERRORS, TASKS_TAG, pagedSchema, taskDetailSchema, taskListItemSchema } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
  POST: { requireAuth: true, requireFeatures: ['tasks.create'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const query = taskListQuerySchema.parse(searchParamsToObject(req.url))
    const service = resolveService<TaskService>(request, 'tasksTaskService')
    return jsonOk(await service.listByProject(request.em, request.scope, id, query))
  } catch (error) {
    return toErrorResponse(error, 'tasks.tasks.list')
  }
}

export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = taskCreateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand<Record<string, unknown>, { taskId: string }>({
      request,
      req,
      commandId: 'tasks.tasks.create',
      input: { ...body, ...request.scope, projectId: id },
      resourceKind: 'tasks.task',
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<TaskService>(request, 'tasksTaskService')
    return jsonOk(await service.getDetail(request.em, request.scope, outcome.result.taskId))
  } catch (error) {
    return toErrorResponse(error, 'tasks.tasks.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: "A project's tasks",
  methods: {
    GET: {
      summary: 'List a project\'s tasks',
      query: taskListQuerySchema,
      responses: [{ status: 200, description: 'Paged tasks.', schema: pagedSchema(taskListItemSchema) }],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Create a task in a project',
      description:
        'Assigns the next `PROJ-n` reference. Setting `recurrence` without a `dueDate` schedules the first occurrence from today in the caller\'s timezone.',
      requestBody: { contentType: 'application/json', schema: taskCreateRequestSchema },
      responses: [{ status: 200, description: 'The created task.', schema: taskDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
