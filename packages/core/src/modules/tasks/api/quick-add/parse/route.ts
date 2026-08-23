import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { jsonOk, resolveService, resolveTasksRequest, toErrorResponse } from '../../shared'
import { quickAddParseRequestSchema } from '../../../data/validators'
import type { QuickAddService } from '../../../services/quickAddService'
import { COMMON_ERRORS, TASKS_TAG, quickAddParseResultSchema } from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['tasks.create'] },
}

export async function POST(req: Request) {
  try {
    const resolved = await resolveTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const body = quickAddParseRequestSchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))
    const service = resolveService<QuickAddService>(request, 'tasksQuickAddService')
    return jsonOk(await service.parse(request.em, request.scope, body))
  } catch (error) {
    return toErrorResponse(error, 'tasks.quickAdd.parse')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: TASKS_TAG,
  summary: 'Parse a one-line quick-add string',
  methods: {
    POST: {
      summary: 'Interpret quick-add text',
      description:
        'Reads a line like "Ship release @amir tomorrow 3pm +urgent #Ops p1" into structured fields, resolving `#project`, `@assignee` and `+label` against the caller\'s scope. Nothing is guessed: an ambiguous or unsupported span stays in the title and comes back as a warning code the client renders in the user\'s language. The client then creates the task through the normal create endpoint, so every server-side validation still applies.',
      requestBody: { contentType: 'application/json', schema: quickAddParseRequestSchema },
      responses: [{ status: 200, description: 'The interpretation.', schema: quickAddParseResultSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
