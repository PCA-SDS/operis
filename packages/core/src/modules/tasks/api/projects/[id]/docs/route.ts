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
import { docCreateRequestSchema } from '../../../../data/validators'
import type { DocService } from '../../../../services/docService'
import { COMMON_ERRORS, TASKS_TAG, docSchema, docTreeItemSchema } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.docs.view'] },
  POST: { requireAuth: true, requireFeatures: ['tasks.docs.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const service = resolveService<DocService>(request, 'tasksDocService')
    return jsonOk({ items: await service.tree(request.em, request.scope, id) })
  } catch (error) {
    return toErrorResponse(error, 'tasks.docs.tree')
  }
}

export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = docCreateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand<Record<string, unknown>, { docId: string }>({
      request,
      req,
      commandId: 'tasks.docs.create',
      input: { ...body, ...request.scope, projectId: id },
      resourceKind: 'tasks.doc',
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<DocService>(request, 'tasksDocService')
    return jsonOk(await service.getDetail(request.em, request.scope, outcome.result.docId))
  } catch (error) {
    return toErrorResponse(error, 'tasks.docs.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: "A project's documentation pages",
  methods: {
    GET: {
      summary: 'Read the page tree',
      description: 'Titles and hierarchy only — page bodies are fetched one at a time.',
      responses: [
        {
          status: 200,
          description: 'The tree.',
          schema: z.object({ items: z.array(docTreeItemSchema) }),
        },
      ],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Create a page',
      requestBody: { contentType: 'application/json', schema: docCreateRequestSchema },
      responses: [{ status: 200, description: 'The created page.', schema: docSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
