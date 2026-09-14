import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  chatTaskAssignmentService,
  jsonOk,
  readContext,
  resolveChatTasksRequest,
  toChatTasksErrorResponse,
} from '../../../shared'
import { CHAT_TASKS_TAG, COMMON_ERRORS, composerContextSchema } from '../../../openapi'

/**
 * What the composer may offer, which is a read.
 *
 * `tasks.view` rather than `tasks.create`: a member who cannot create tasks still
 * opens this, sees `canCreate: false`, and is shown why — rather than meeting an
 * error after typing a task out.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view', 'tasks.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    return jsonOk(await chatTaskAssignmentService(request).composerContext(readContext(request), id))
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.conversations.composer')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TASKS_TAG,
  summary: 'Defaults for creating a task from a conversation',
  methods: {
    GET: {
      summary: 'Read the composer context',
      description:
        "The assignee a direct conversation defaults to, resolved from server-verified participant rows rather than from anything the client offers. A space has no default and reports `requiresExplicitAssignee: true`; `@everyone` is never expanded into a list of assignees. A counterpart who is inactive or not assignable in this organization comes back as `defaultAssignee: null` with a reason, so the composer can say which it is. Also reports the caller's own `tasks.create` and `tasks.assign` grants.",
      responses: [{ status: 200, description: 'The composer context.', schema: composerContextSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
