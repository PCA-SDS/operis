import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatMessageSearchQuerySchema } from '../../data/validators'
import { chatSearchRateLimit } from '../../lib/rateLimits'
import {
  enforceChatRateLimit,
  chatService,
  jsonOk,
  readContext,
  resolveChatRequest,
  searchParamsToObject,
  toChatErrorResponse,
} from '../shared'
import {
  CHAT_TAG,
  COMMON_ERRORS,
  RATE_LIMITED_ERRORS,
  searchResultSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
}

/**
 * Search every conversation the caller currently belongs to.
 *
 * "Currently" is the whole point: membership is a join evaluated on this
 * request, not a permission baked into an index. Someone removed from a space a
 * second ago stops finding its messages on their next keystroke, with nothing
 * to reindex and no cache to invalidate.
 *
 * There is no conversation parameter and no organization parameter. Both come
 * from the session, so no request shape widens the scope — searching another
 * organization is not a thing this endpoint can be asked to do.
 */
export async function GET(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatSearchRateLimit, { failClosed: true })
    if (limited) return limited

    const input = chatMessageSearchQuerySchema.parse(searchParamsToObject(req.url))

    const result = await chatService(request).searchMessages(readContext(request), {
      query: input.q,
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
    return toChatErrorResponse(error, 'chat.search')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Search all chats',
  methods: {
    GET: {
      summary: 'Search messages across every conversation the caller belongs to',
      description:
        'Ranked across conversations, relevance first and recency only as a tie-breaker. Authorization is an inner join on participation rather than a filter applied to results, so a message the caller cannot read is never a candidate and cannot leak through a snippet or a count. The total is capped and reflects accessible matches only. Scope comes from the session; there is no parameter that widens it.',
      responses: [{ status: 200, description: 'Matching messages, most relevant first.', schema: searchResultSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
