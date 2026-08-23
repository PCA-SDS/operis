import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  toErrorResponse,
} from '../shared'
import { labelCreateRequestSchema } from '../../data/validators'
import type { LabelService } from '../../services/labelService'
import { COMMON_ERRORS, TASKS_TAG, labelSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.view'] },
  POST: { requireAuth: true, requireFeatures: ['tasks.labels.manage'] },
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<LabelService>(request, 'tasksLabelService')
    return jsonOk({ items: await service.list(request.em, request.scope) })
  } catch (error) {
    return toErrorResponse(error, 'tasks.labels.list')
  }
}

export async function POST(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = labelCreateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand<Record<string, unknown>, { labelId: string }>({
      request,
      req,
      commandId: 'tasks.labels.create',
      input: { ...body, ...request.scope },
      resourceKind: 'tasks.label',
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<LabelService>(request, 'tasksLabelService')
    const items = await service.list(request.em, request.scope)
    return jsonOk(items.find((item) => item.id === outcome.result.labelId) ?? null)
  } catch (error) {
    return toErrorResponse(error, 'tasks.labels.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'The label catalog',
  methods: {
    GET: {
      summary: 'List labels',
      description: 'Labels are a scope-level catalog shared across the scope\'s projects.',
      responses: [
        { status: 200, description: 'Labels.', schema: z.object({ items: z.array(labelSchema) }) },
      ],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Create a label',
      requestBody: { contentType: 'application/json', schema: labelCreateRequestSchema },
      responses: [{ status: 200, description: 'The created label.', schema: labelSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
