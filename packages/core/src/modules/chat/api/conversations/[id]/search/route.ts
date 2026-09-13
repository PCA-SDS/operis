import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatMessageSearchQuerySchema } from '../../../../data/validators'
import { chatSearchRateLimit } from '../../../../lib/rateLimits'
import {
  enforceChatRateLimit,
  chatService,
  jsonOk,
  readContext,
  resolveChatRequest,
  searchParamsToObject,
  toChatErrorResponse,
} from '../../../shared'
import {
  CHAT_TAG,
  COMMON_ERRORS,
  RATE_LIMITED_ERRORS,
  searchResultSchema,
} from '../../../openapi'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
}

/**
 * Search one conversation.
 *
 * Membership is checked before anything is read, so searching a conversation
 * you are not in is a 404 exactly like reading it — not an empty result set,
 * which would quietly confirm the conversation exists.
 *
 * The same service and the same ranking as the global search. The only
 * difference is one predicate, which is what keeps a message from ranking
 * differently depending on where it was searched from.
 */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatSearchRateLimit, { failClosed: true })
    if (limited) return limited

    const input = chatMessageSearchQuerySchema.parse(searchParamsToObject(req.url))

    const result = await chatService(request).searchMessages(readContext(request), {
      query: input.q,
      conversationId: id,
      filters: {
        senderUserIds: input.from,
        after: input.after,
        before: input.before,
        pinnedOnly: input.pinned === 'true',
      },
      limit: input.limit,
      cursor: input.cursor,
    })

    return jsonOk(result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversation.search')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Search this conversation',
  methods: {
    GET: {
      summary: 'Search messages within one conversation',
      description:
        'Scoped to the named conversation and nothing else. Membership is checked first, so a conversation the caller does not belong to answers 404 rather than an empty result — an empty result would confirm it exists. Ranking is identical to the cross-conversation search.',
      responses: [{ status: 200, description: 'Matching messages in this conversation.', schema: searchResultSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
