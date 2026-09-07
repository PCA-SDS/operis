import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatReactionSchema } from '../../../../../../data/validators'
import { chatSendRateLimit } from '../../../../../../lib/rateLimits'
import type { ToggleReactionInput } from '../../../../../../commands/engagement'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../../../../../shared'
import { CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS, reactionToggleSchema } from '../../../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.send'] },
}

const paramsSchema = z.object({ id: z.string().uuid(), messageId: z.string().uuid() })

/**
 * Add or remove the caller's own reaction.
 *
 * One endpoint rather than an add and a delete: the UI has a single control and
 * pressing it twice must land back where it started, so the server owns "did I
 * already react" instead of the client guessing and the two disagreeing.
 *
 * There is no user parameter — the reaction is always the caller's, so this
 * cannot be used to react on somebody else's behalf.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id, messageId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    // Metered on the send bucket: it is a write that fans out an event, and a
    // reaction is exactly as spammable as a message.
    const limited = await enforceChatRateLimit(request, chatSendRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatReactionSchema.parse(await req.json())
    const outcome = await runChatCommand<ToggleReactionInput, { emoji: string; reacted: boolean }>({
      request,
      req,
      commandId: 'chat.messages.toggleReaction',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        messageId,
        emoji: body.emoji,
      },
      resourceKind: 'chat.message',
      resourceId: messageId,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.messages.toggleReaction')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Reactions on a message',
  methods: {
    POST: {
      summary: 'Toggle the caller’s reaction',
      description:
        'Adds the emoji if the caller has not used it on this message, removes it if they have. The reaction is always the caller’s own. The message must belong to the named conversation and the caller must be a member of it; a forged message id from another conversation, space or organization is a 404, and a composite foreign key makes it unstorable regardless.',
      responses: [
        { status: 200, description: 'The emoji and whether it is now set.', schema: reactionToggleSchema },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
