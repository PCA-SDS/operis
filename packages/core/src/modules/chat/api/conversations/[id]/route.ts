import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  chatService,
  jsonOk,
  readContext,
  resolveChatRequest,
  toChatErrorResponse,
} from '../../shared'
import { CHAT_TAG, COMMON_ERRORS, conversationSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * One conversation, as the caller sees it.
 *
 * A conversation the caller is not a participant of answers 404, exactly as a
 * nonexistent id does — telling the two apart would confirm which ids exist.
 */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    return jsonOk(await chatService(request).getConversation(readContext(request), id))
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversations.get')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'A single conversation',
  methods: {
    GET: {
      summary: 'Read one conversation',
      description:
        'Requires the caller to be a participant. A conversation in another tenant or organization, or one the caller does not belong to, is indistinguishable from a missing one.',
      responses: [{ status: 200, description: 'The conversation.', schema: conversationSchema }],
      errors: [...COMMON_ERRORS],
    },
  },
}
