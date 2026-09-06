import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatSendRateLimit } from '../../../../../../lib/rateLimits'
import type { PinMessageInput } from '../../../../../../commands/engagement'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../../../../../shared'
import { CHAT_TAG, COMMON_ERRORS, pinToggleSchema, RATE_LIMITED_ERRORS } from '../../../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.send'] },
  DELETE: { requireAuth: true, requireFeatures: ['chat.send'] },
}

const paramsSchema = z.object({ id: z.string().uuid(), messageId: z.string().uuid() })

async function run(
  req: Request,
  context: { params?: Record<string, unknown> },
  commandId: 'chat.messages.pin' | 'chat.messages.unpin',
) {
  const { id, messageId } = paramsSchema.parse(context.params)
  const resolved = await resolveChatRequest(req)
  if (!resolved.ok) return resolved.response
  const request = resolved.value

  // The send bucket, like reactions: this is a write that fans out an event.
  // It was metered on the conversation-CREATE bucket, which is named and tuned
  // for defending against directory walking — so pinning twenty messages spent
  // the budget for starting new conversations, and two unrelated limits shared
  // one counter.
  const limited = await enforceChatRateLimit(request, chatSendRateLimit, { failClosed: true })
  if (limited) return limited

  const outcome = await runChatCommand<PinMessageInput, { pinned: boolean }>({
    request,
    req,
    commandId,
    input: {
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
      conversationId: id,
      messageId,
    },
    resourceKind: 'chat.conversation',
    resourceId: id,
    operation: 'update',
  })
  if (!outcome.ok) return outcome.response
  return jsonOk(outcome.result)
}

/** Pin a message. In a space, owners only — a pin changes what every member sees. */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    return await run(req, context, 'chat.messages.pin')
  } catch (error) {
    return toChatErrorResponse(error, 'chat.messages.pin')
  }
}

export async function DELETE(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    return await run(req, context, 'chat.messages.unpin')
  } catch (error) {
    return toChatErrorResponse(error, 'chat.messages.unpin')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Pin state of a message',
  methods: {
    POST: {
      summary: 'Pin a message',
      description:
        'In a space, owners only: a pin changes what every member sees at the top of the conversation, which is the same class of decision as renaming it. Either participant may pin in a direct conversation. Pinning something already pinned is a no-op rather than a second entry.',
      responses: [{ status: 200, description: 'The resulting pin state.', schema: pinToggleSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
    DELETE: {
      summary: 'Unpin a message',
      description: 'Same permission as pinning. Unpinning something already unpinned converges rather than erroring.',
      responses: [{ status: 200, description: 'The resulting pin state.', schema: pinToggleSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
