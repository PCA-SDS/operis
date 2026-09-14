import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { SetConversationMutedInput } from '../../../../commands/conversations'
import { chatReadCursorRateLimit } from '../../../../lib/rateLimits'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../../../shared'
import { CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS, mutedResponseSchema } from '../../../openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({ muted: z.boolean() })

/**
 * Silence a conversation for the caller, or stop silencing it.
 *
 * `chat.view`, not `chat.send`: a read-only member has notifications to silence
 * just as much as anybody else.
 *
 * Shares the read-cursor bucket rather than growing one of its own — both are
 * small per-person bookkeeping writes on the same row, and a person toggles a
 * mute a handful of times a year.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatReadCursorRateLimit, { failClosed: true })
    if (limited) return limited

    const body = bodySchema.parse(await readJsonSafe(req, {}))
    const input: SetConversationMutedInput = {
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
      conversationId: id,
      muted: body.muted,
    }

    const outcome = await runChatCommand<SetConversationMutedInput, { muted: boolean }>({
      request,
      req,
      commandId: 'chat.conversations.setMuted',
      input,
      resourceKind: 'chat.conversation',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversations.setMuted')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Conversation mute',
  methods: {
    POST: {
      summary: 'Silence a conversation for the caller',
      description:
        'Suppresses notifications for this conversation and nothing else — the unread count still moves and the conversation still rises in the list.',
      responses: [{ status: 200, description: 'The resulting state.', schema: mutedResponseSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
