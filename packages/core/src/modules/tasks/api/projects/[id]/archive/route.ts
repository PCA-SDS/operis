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
import { projectArchiveRequestSchema } from '../../../../data/validators'
import type { ProjectService } from '../../../../services/projectService'
import { COMMON_ERRORS, TASKS_TAG, projectDetailSchema } from '../../../openapi'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['tasks.projects.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = projectArchiveRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))

    const outcome = await runGuardedCommand({
      request,
      req,
      commandId: 'tasks.projects.archive',
      input: { ...request.scope, id, archived: body.archived },
      resourceKind: 'tasks.project',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    const service = resolveService<ProjectService>(request, 'tasksProjectService')
    return jsonOk(await service.getDetail(request.em, request.scope, id))
  } catch (error) {
    return toErrorResponse(error, 'tasks.projects.archive')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'Archive or restore a project',
  methods: {
    PATCH: {
      summary: 'Archive or restore a project',
      description: 'Archiving hides the project from the default list without deleting anything.',
      requestBody: { contentType: 'application/json', schema: projectArchiveRequestSchema },
      responses: [{ status: 200, description: 'The updated project.', schema: projectDetailSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
