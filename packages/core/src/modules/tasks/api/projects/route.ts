import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  jsonOk,
  resolveService,
  resolveTasksRequest,
  runGuardedCommand,
  searchParamsToObject,
  toErrorResponse,
} from '../shared'
import { projectCreateRequestSchema, projectListQuerySchema } from '../../data/validators'
import type { ProjectService } from '../../services/projectService'
import {
  COMMON_ERRORS,
  TASKS_TAG,
  errorSchema,
  pagedSchema,
  projectDetailSchema,
  projectListItemSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tasks.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['tasks.projects.manage'] },
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const query = projectListQuerySchema.parse(searchParamsToObject(req.url))
    const service = resolveService<ProjectService>(request, 'tasksProjectService')
    return jsonOk(await service.list(request.em, request.scope, query))
  } catch (error) {
    return toErrorResponse(error, 'tasks.projects.list')
  }
}

export async function POST(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = projectCreateRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand<typeof body & typeof request.scope, { projectId: string }>({
      request,
      req,
      commandId: 'tasks.projects.create',
      input: { ...body, ...request.scope },
      resourceKind: 'tasks.project',
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<ProjectService>(request, 'tasksProjectService')
    return jsonOk(await service.getDetail(request.em, request.scope, outcome.result.projectId))
  } catch (error) {
    return toErrorResponse(error, 'tasks.projects.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'Projects',
  methods: {
    GET: {
      summary: 'List projects',
      description:
        'Projects in the caller\'s tenant and organization. The hidden Inbox project is never listed.',
      query: projectListQuerySchema,
      responses: [
        { status: 200, description: 'Paged projects.', schema: pagedSchema(projectListItemSchema) },
      ],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Create a project',
      requestBody: { contentType: 'application/json', schema: projectCreateRequestSchema },
      responses: [{ status: 200, description: 'The created project.', schema: projectDetailSchema }],
      errors: [
        { status: 400, description: 'Validation failed or the key is taken', schema: errorSchema },
        ...COMMON_ERRORS.filter((entry) => entry.status !== 400),
      ],
    },
  },
}
