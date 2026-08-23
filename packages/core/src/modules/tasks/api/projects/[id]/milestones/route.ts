import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  toErrorResponse,
} from '../../../shared'
import { milestoneCreateRequestSchema } from '../../../../data/validators'
import type { MilestoneService } from '../../../../services/milestoneService'
import { COMMON_ERRORS, TASKS_TAG, milestoneSchema } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['tasks.milestones.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<MilestoneService>(request, 'tasksMilestoneService')
    return jsonOk({ items: await service.listByProject(request.em, request.scope, id) })
  } catch (error) {
    return toErrorResponse(error, 'tasks.milestones.list')
  }
}

export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = milestoneCreateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand<Record<string, unknown>, { milestoneId: string }>({
      request,
      req,
      commandId: 'tasks.milestones.create',
      input: { ...body, ...request.scope, projectId: id },
      resourceKind: 'tasks.milestone',
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<MilestoneService>(request, 'tasksMilestoneService')
    const items = await service.listByProject(request.em, request.scope, id)
    return jsonOk(items.find((item) => item.id === outcome.result.milestoneId) ?? null)
  } catch (error) {
    return toErrorResponse(error, 'tasks.milestones.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: "A project's milestones",
  methods: {
    GET: {
      summary: 'List milestones',
      description: 'Progress is derived from the tasks pointing at each milestone, never stored.',
      responses: [
        { status: 200, description: 'Milestones.', schema: z.object({ items: z.array(milestoneSchema) }) },
      ],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Create a milestone',
      requestBody: { contentType: 'application/json', schema: milestoneCreateRequestSchema },
      responses: [{ status: 200, description: 'The created milestone.', schema: milestoneSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
