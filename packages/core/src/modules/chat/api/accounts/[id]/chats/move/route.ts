import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatMoveAccountChatSchema } from '../../../../../data/validators'
import { chatAccountWriteRateLimit } from '../../../../../lib/rateLimits'
import type { MoveAccountChatInput } from '../../../../../commands/accounts'
import { enforceChatRateLimit, jsonOk, resolveChatRequest, runChatCommand, toChatErrorResponse } from '../../../../shared'
import { accountChatMoveResponseSchema, CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS } from '../../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.accounts.connect_own'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Move one chat from the caller's personal WhatsApp to the company. It becomes
 * a client conversation they own; what was said before stays theirs.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatAccountWriteRateLimit, { failClosed: true })
    if (limited) return limited

    const { chatId } = chatMoveAccountChatSchema.parse(await req.json())
    const outcome = await runChatCommand<MoveAccountChatInput, { conversationId: string }>({
      request,
      req,
      commandId: 'chat.accounts.moveChat',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        accountId: id,
        chatId,
      },
      resourceKind: 'chat.messaging_account',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.moveChat')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Move a personal chat to the company',
  methods: {
    POST: {
      summary: 'Move a chat from your personal WhatsApp to the company',
      description:
        'The caller’s own connected personal account only; `chatId` comes from the chat list. The chat becomes a client conversation the caller manages and can hand over. Only what is said from now on comes into Operis — nothing earlier is read. Replies in it leave from the caller’s WhatsApp. Moving a chat twice returns the same conversation.',
      responses: [{ status: 200, description: 'The conversation it became.', schema: accountChatMoveResponseSchema }],
      errors: [
        ...COMMON_ERRORS,
        { status: 409, description: 'The account is not connected' },
        { status: 503, description: 'The network could not be reached' },
        ...RATE_LIMITED_ERRORS,
      ],
    },
  },
}
