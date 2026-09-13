import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { SetTypingInput } from '../../../../commands/conversations'
import { chatTypingRateLimit } from '../../../../lib/rateLimits'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../../../shared'
import { CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS, typingResponseSchema } from '../../../openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({ typing: z.boolean() })

/**
 * Say that the caller is typing, or has stopped.
 *
 * Gated on `chat.view` rather than `chat.send`, which looks wrong for a second
 * and is not: a reader who cannot send has nothing to announce, and the command
 * refuses a non-participant anyway. Requiring `chat.send` would make the gate
 * disagree with the composer's own, which is already hidden for that person.
 *
 * There is no user parameter — the notification is always the caller's, so this
 * cannot be used to make somebody else appear to be typing.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    // Fails OPEN, unlike a send. Losing a keystroke signal under load is
    // invisible; refusing one with a 429 that the client then has to reason
    // about is not, and there is nothing here worth protecting that hard.
    const limited = await enforceChatRateLimit(request, chatTypingRateLimit, { failClosed: false })
    if (limited) return limited

    const body = bodySchema.parse(await readJsonSafe(req, {}))
    const input: SetTypingInput = {
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
      conversationId: id,
      typing: body.typing,
    }

    const outcome = await runChatCommand<SetTypingInput, { typing: boolean }>({
      request,
      req,
      commandId: 'chat.conversations.setTyping',
      input,
      resourceKind: 'chat.conversation',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversations.setTyping')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Typing notification',
  methods: {
    POST: {
      summary: 'Announce that the caller is typing',
      description:
        'Fans a notification out to everyone else in the conversation and mirrors it to the messaging system. Nothing is stored: the notification expires on its own, so a client that stops sending stops appearing to type.',
      responses: [{ status: 200, description: 'The state that was announced.', schema: typingResponseSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
