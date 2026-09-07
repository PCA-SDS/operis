import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatUnreadCountRateLimit } from '../../lib/rateLimits'
import {
  chatService,
  enforceChatRateLimit,
  jsonOk,
  readContext,
  resolveChatRequest,
  toChatErrorResponse,
} from '../shared'
import { CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS, unreadCountSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
}

/** The number behind the topbar badge: unread messages across every conversation. */
export async function GET(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    // Every session polls this from the topbar and it joins three tables, so it
    // is the cheapest endpoint to hammer and the most expensive per call. Fails
    // open: a degraded limiter must not blank the badge on every page.
    const limited = await enforceChatRateLimit(request, chatUnreadCountRateLimit, { failClosed: false })
    if (limited) return limited

    const unreadCount = await chatService(request).countUnread(readContext(request))
    return jsonOk({ unreadCount })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.unreadCount')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Unread chat messages',
  methods: {
    GET: {
      summary: 'Count the caller’s unread messages',
      description:
        'Derived from each conversation’s read cursor rather than a stored counter, so it cannot drift out of sync and is identical across the caller’s tabs and devices.',
      responses: [{ status: 200, description: 'Unread total.', schema: unreadCountSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
