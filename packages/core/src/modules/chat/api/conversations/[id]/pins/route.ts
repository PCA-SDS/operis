import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatDirectoryRateLimit } from '../../../../lib/rateLimits'
import {
  chatService,
  enforceChatRateLimit,
  jsonOk,
  readContext,
  resolveChatRequest,
  toChatErrorResponse,
} from '../../../shared'
import { CHAT_TAG, COMMON_ERRORS, pinnedListSchema, RATE_LIMITED_ERRORS } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * The messages pinned in a conversation, most recently pinned first.
 *
 * Members only — the service runs the same participant check every conversation
 * read runs, so a conversation the caller is not in is a 404 and its pins cannot
 * be enumerated. Bodies come back as previews, not in full: the panel is a way
 * to find a message, and clicking through is what shows it.
 */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    // A read, so it fails open: a degraded limiter must not take the panel away.
    const limited = await enforceChatRateLimit(request, chatDirectoryRateLimit, { failClosed: false })
    if (limited) return limited

    return jsonOk(await chatService(request).listPinned(readContext(request), id))
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversations.listPinned')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Pinned messages in a conversation',
  methods: {
    GET: {
      summary: 'List pinned messages',
      description:
        'Members only; a conversation the caller does not belong to is indistinguishable from a missing one. Ordered by when each was pinned, most recent first, and returned as previews rather than full bodies.',
      responses: [{ status: 200, description: 'The pinned messages.', schema: pinnedListSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
