import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  chatTaskService,
  jsonOk,
  readContext,
  resolveChatTasksRequest,
  searchParamsToObject,
  toChatTasksErrorResponse,
} from '../../../shared'
import { chatTaskCardBatchQuerySchema } from '../../../../data/validators'
import { CHAT_TASKS_TAG, COMMON_ERRORS, cardBatchSchema } from '../../../openapi'

/**
 * `chat.view` alone, and that is deliberate.
 *
 * This route has to be reachable by a member who has NO task access, because the
 * answer it owes them is a card that says so. Gating it on `tasks.view` would refuse
 * the request outright, and a 403 in the middle of a transcript renders as a broken
 * row rather than as "a task is linked here that you cannot see" — the state the
 * whole per-viewer card model exists to produce.
 *
 * The task grant is therefore checked where it belongs: per task, inside
 * `hydrateTasks`, which short-circuits on a missing `tasks.view` and reads no task
 * row at all. Nothing is widened — a viewer without the grant gets
 * `available: false` and no task details in any field.
 *
 * Not `chat.send` either: looking at cards is not writing to the conversation.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatTasksRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value
    const query = chatTaskCardBatchQuerySchema.parse(searchParamsToObject(req.url))
    const items = await chatTaskService(request).cardsForMessages(
      readContext(request),
      id,
      query.messageIds,
    )
    return jsonOk({ items })
  } catch (error) {
    return toChatTasksErrorResponse(error, 'chat_tasks.conversations.cards')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TASKS_TAG,
  summary: 'Task cards for a page of a transcript',
  methods: {
    GET: {
      summary: 'Resolve the task cards on these messages',
      description:
        'One request per transcript page rather than one per card — a page holds up to fifty messages and a per-card request is the N+1 that makes scrolling slow. Message ids that carry no card are simply absent from the result. Each card is resolved for the calling viewer, so a colleague without task access receives `available: false` with no task details at all.',
      query: chatTaskCardBatchQuerySchema,
      responses: [{ status: 200, description: 'The cards on those messages.', schema: cardBatchSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
