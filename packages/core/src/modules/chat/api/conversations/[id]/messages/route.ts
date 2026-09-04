import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatMessageListQuerySchema, chatSendMessageSchema } from '../../../../data/validators'
import { chatSendRateLimit } from '../../../../lib/rateLimits'
import type { SendChatMessageInput, SendChatMessageResult } from '../../../../commands/messages'
import {
  chatService,
  enforceChatRateLimit,
  jsonOk,
  readContext,
  resolveChatRequest,
  runChatCommand,
  searchParamsToObject,
  toChatErrorResponse,
} from '../../../shared'
import {
  CHAT_TAG,
  COMMON_ERRORS,
  messagePageSchema,
  RATE_LIMITED_ERRORS,
  sendMessageResponseSchema,
} from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  POST: { requireAuth: true, requireFeatures: ['chat.send'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * A page of history, newest page first, oldest-first within the page.
 *
 * Cursor-based so that a message arriving while someone scrolls back cannot make
 * the next page repeat or skip a row, and so opening a long conversation costs
 * one page rather than the whole transcript.
 */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const query = chatMessageListQuerySchema.parse(searchParamsToObject(req.url))
    const page = await chatService(request).listMessages(readContext(request), id, {
      cursor: query.cursor,
      limit: query.limit,
    })
    return jsonOk(page)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.messages.list')
  }
}

/** Send a message. Rate limited per user, and idempotent on `clientMessageId`. */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatSendRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatSendMessageSchema.parse(await req.json())
    const input: SendChatMessageInput = {
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
      conversationId: id,
      body: body.body,
      clientMessageId: body.clientMessageId,
      replyToMessageId: body.replyToMessageId,
    }

    const outcome = await runChatCommand<SendChatMessageInput, SendChatMessageResult>({
      request,
      req,
      commandId: 'chat.messages.send',
      input,
      resourceKind: 'chat.message',
      resourceId: id,
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.messages.send')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Messages in a conversation',
  methods: {
    GET: {
      summary: 'Read a page of messages',
      description:
        'Keyset pagination walking backwards from the newest message. Participants only; a conversation the caller does not belong to answers 404.',
      responses: [{ status: 200, description: 'A page of messages.', schema: messagePageSchema }],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Send a message',
      description:
        'Authorship comes from the session, never the payload. Supplying `clientMessageId` makes the send idempotent, so a retried request returns the message already stored instead of posting twice. `replyToMessageId` must name a live message in this same conversation: the command checks it, and a composite foreign key on `(reply_to_message_id, conversation_id)` makes a cross-conversation or cross-organization reference unstorable even if that check were removed.',
      responses: [{ status: 200, description: 'The stored message.', schema: sendMessageResponseSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
