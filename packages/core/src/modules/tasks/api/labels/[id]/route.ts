import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  toErrorResponse,
} from '../../shared'
import { labelUpdateRequestSchema } from '../../../data/validators'
import type { LabelService } from '../../../services/labelService'
import { COMMON_ERRORS, TASKS_TAG, labelSchema, okSchema } from '../../openapi'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['tasks.labels.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['tasks.labels.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = labelUpdateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.labels.update',
      input: { ...body, ...request.scope, id },
      resourceKind: 'tasks.label',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<LabelService>(request, 'tasksLabelService')
    request.em.clear()
    const items = await service.list(request.em, request.scope)
    return jsonOk(items.find((item) => item.id === id) ?? null)
  } catch (error) {
    return toErrorResponse(error, 'tasks.labels.update')
  }
}

export async function DELETE(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.labels.delete',
      input: { ...request.scope, id },
      resourceKind: 'tasks.label',
      resourceId: id,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk({ ok: true })
  } catch (error) {
    return toErrorResponse(error, 'tasks.labels.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'A single label',
  methods: {
    PATCH: {
      summary: 'Rename or recolour a label',
      requestBody: { contentType: 'application/json', schema: labelUpdateRequestSchema },
      responses: [{ status: 200, description: 'The updated label.', schema: labelSchema }],
      errors: [...COMMON_ERRORS],
    },
    DELETE: {
      summary: 'Delete a label',
      description: 'Removes it from the catalog and from every task that carried it.',
      responses: [{ status: 200, description: 'Deleted.', schema: okSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
