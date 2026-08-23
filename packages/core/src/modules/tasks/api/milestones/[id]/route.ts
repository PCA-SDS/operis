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
import { milestoneUpdateRequestSchema } from '../../../data/validators'
import type { MilestoneService } from '../../../services/milestoneService'
import { COMMON_ERRORS, TASKS_TAG, milestoneSchema, okSchema } from '../../openapi'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['tasks.milestones.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['tasks.milestones.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = milestoneUpdateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.milestones.update',
      input: { ...body, ...request.scope, id },
      resourceKind: 'tasks.milestone',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<MilestoneService>(request, 'tasksMilestoneService')
    request.em.clear()
    const milestone = await service.requireMilestone(request.em, request.scope, id)
    const items = await service.listByProject(request.em, request.scope, milestone.projectId)
    return jsonOk(items.find((item) => item.id === id) ?? null)
  } catch (error) {
    return toErrorResponse(error, 'tasks.milestones.update')
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
      commandId: 'tasks.milestones.delete',
      input: { ...request.scope, id },
      resourceKind: 'tasks.milestone',
      resourceId: id,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk({ ok: true })
  } catch (error) {
    return toErrorResponse(error, 'tasks.milestones.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'A single milestone',
  methods: {
    PATCH: {
      summary: 'Update a milestone',
      requestBody: { contentType: 'application/json', schema: milestoneUpdateRequestSchema },
      responses: [{ status: 200, description: 'The updated milestone.', schema: milestoneSchema }],
      errors: [...COMMON_ERRORS],
    },
    DELETE: {
      summary: 'Delete a milestone',
      description: 'Its tasks stay; they simply lose the grouping.',
      responses: [{ status: 200, description: 'Deleted.', schema: okSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
