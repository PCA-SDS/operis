import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatMarkReadSchema } from '../../../../data/validators'
import type { MarkConversationReadInput } from '../../../../commands/conversations'
import { chatReadCursorRateLimit } from '../../../../lib/rateLimits'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../../../shared'
import { CHAT_TAG, COMMON_ERRORS, markReadResponseSchema, RATE_LIMITED_ERRORS } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Advance the caller's read cursor for one conversation.
 *
 * There is no recipient parameter: the cursor that moves is always the caller's
 * own, so this cannot be used to mark someone else's conversation read.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    // A write like any other: it flushes a row and emits an SSE event, so it is
    // counted rather than left as the one unmetered mutation in the module.
    const limited = await enforceChatRateLimit(request, chatReadCursorRateLimit, { failClosed: true })
    if (limited) return limited

    const raw = await req.json().catch(() => ({}))
    const body = chatMarkReadSchema.parse(raw ?? {})
    const input: MarkConversationReadInput = {
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
      conversationId: id,
      readAt: body.readAt,
    }

    const outcome = await runChatCommand<MarkConversationReadInput, { lastReadAt: string }>({
      request,
      req,
      commandId: 'chat.conversations.markRead',
      input,
      resourceKind: 'chat.conversation',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversations.markRead')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Conversation read cursor',
  methods: {
    POST: {
      summary: 'Mark a conversation read',
      description:
        'Moves the caller’s own read cursor forward. The cursor never moves backwards, so a stale tab replaying an old position cannot resurrect messages already seen elsewhere.',
      responses: [{ status: 200, description: 'The resulting cursor.', schema: markReadResponseSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
