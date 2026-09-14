import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  chatTaskService,
  jsonOk,
  readContext,
  resolveChatTasksRequest,
  toChatTasksErrorResponse,
} from '../../../shared'
import { CHAT_TASKS_TAG, COMMON_ERRORS, sourceListSchema } from '../../../openapi'

/**
 * Where a task came from — reached from the task side, gated on the chat side.
 *
 * `chat.view` is in the metadata because the answer is chat data, but the grant is
 * not what decides anything: the service checks **current membership of each
 * conversation** and omits every link the caller is not in. Somebody holding
 * `tasks.*` and `chat.view` across the whole organization still sees nothing for a
 * task raised in a conversation they were never added to, and is not told one
 * exists.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view', 'tasks.view'] },
}

const paramsSchema = z.object({ taskId: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { taskId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    return jsonOk(await chatTaskService(request).sourcesForTask(readContext(request), taskId))
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.tasks.sources')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TASKS_TAG,
  summary: 'Conversations a task was raised from',
  methods: {
    GET: {
      summary: 'List the readable source conversations for a task',
      description:
        'Chat access is re-checked independently for every link, against membership as it stands now. A conversation the caller is not in is omitted entirely — never listed as hidden, because saying "there is a conversation you may not read" already says one exists. A recorded source message that has been deleted comes back as `messageId: null` rather than as a link that goes nowhere.',
      responses: [
        { status: 200, description: 'The readable sources, possibly none.', schema: sourceListSchema },
      ],
      errors: [...COMMON_ERRORS],
    },
  },
}
