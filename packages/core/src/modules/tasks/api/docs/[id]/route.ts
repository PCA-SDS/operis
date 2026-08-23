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
import { docUpdateRequestSchema } from '../../../data/validators'
import type { DocService } from '../../../services/docService'
import { COMMON_ERRORS, TASKS_TAG, docSchema, okSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.docs.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['tasks.docs.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['tasks.docs.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<DocService>(request, 'tasksDocService')
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.docs.detail')
  }
}

export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = docUpdateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.docs.update',
      input: { ...body, ...request.scope, id },
      resourceKind: 'tasks.doc',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<DocService>(request, 'tasksDocService')
    request.em.clear()
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.docs.update')
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
      commandId: 'tasks.docs.delete',
      input: { ...request.scope, id },
      resourceKind: 'tasks.doc',
      resourceId: id,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk({ ok: true })
  } catch (error) {
    return toErrorResponse(error, 'tasks.docs.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'A single documentation page',
  methods: {
    GET: {
      summary: 'Read a page',
      responses: [{ status: 200, description: 'The page.', schema: docSchema }],
      errors: [...COMMON_ERRORS],
    },
    PATCH: {
      summary: 'Update a page',
      requestBody: { contentType: 'application/json', schema: docUpdateRequestSchema },
      responses: [{ status: 200, description: 'The updated page.', schema: docSchema }],
      errors: [...COMMON_ERRORS],
    },
    DELETE: {
      summary: 'Delete a page',
      description: 'Sub-pages survive and move up one level.',
      responses: [{ status: 200, description: 'Deleted.', schema: okSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
