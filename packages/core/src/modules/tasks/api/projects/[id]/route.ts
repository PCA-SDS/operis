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
import { projectUpdateRequestSchema } from '../../../data/validators'
import type { ProjectService } from '../../../services/projectService'
import { COMMON_ERRORS, TASKS_TAG, okSchema, projectDetailSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.projects.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['tasks.projects.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['tasks.projects.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<ProjectService>(request, 'tasksProjectService')
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.projects.detail')
  }
}

export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = projectUpdateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.projects.update',
      input: { ...body, ...request.scope, id },
      resourceKind: 'tasks.project',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<ProjectService>(request, 'tasksProjectService')
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.projects.update')
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
      commandId: 'tasks.projects.delete',
      input: { ...request.scope, id },
      resourceKind: 'tasks.project',
      resourceId: id,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk({ ok: true })
  } catch (error) {
    return toErrorResponse(error, 'tasks.projects.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'A single project',
  methods: {
    GET: {
      summary: 'Read a project',
      responses: [{ status: 200, description: 'The project.', schema: projectDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
    PATCH: {
      summary: 'Update a project',
      description: 'Only the provided fields change. Passing `memberIds` replaces the whole member set.',
      requestBody: { contentType: 'application/json', schema: projectUpdateRequestSchema },
      responses: [{ status: 200, description: 'The updated project.', schema: projectDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
    DELETE: {
      summary: 'Delete a project',
      description: 'Soft-deletes the project along with its tasks, milestones and pages.',
      responses: [{ status: 200, description: 'Deleted.', schema: okSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
