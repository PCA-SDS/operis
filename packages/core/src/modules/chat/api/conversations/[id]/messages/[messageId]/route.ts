import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatEditMessageSchema } from '../../../../../data/validators'
import { chatSendRateLimit } from '../../../../../lib/rateLimits'
import type {
  DeleteChatMessageInput,
  DeleteChatMessageResult,
  EditChatMessageInput,
  EditChatMessageResult,
} from '../../../../../commands/messages'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../../../../shared'
import {
  CHAT_TAG,
  COMMON_ERRORS,
  deleteMessageResponseSchema,
  editMessageResponseSchema,
  RATE_LIMITED_ERRORS,
} from '../../../../openapi'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['chat.send'] },
  DELETE: { requireAuth: true, requireFeatures: ['chat.send'] },
}

const paramsSchema = z.object({ id: z.string().uuid(), messageId: z.string().uuid() })

/**
 * Rewrite the body of a message you wrote.
 *
 * Metered on the send bucket, like reactions and pins: an edit is a write that
 * rebuilds a search document, replaces mention and link rows and fans out an
 * event, so it costs roughly what a send costs and must not have a budget of
 * its own to spend.
 */
export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id, messageId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatSendRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatEditMessageSchema.parse(await req.json())

    const outcome = await runChatCommand<EditChatMessageInput, EditChatMessageResult>({
      request,
      req,
      commandId: 'chat.messages.edit',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        messageId,
        body: body.body,
      },
      resourceKind: 'chat.message',
      resourceId: messageId,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.messages.edit')
  }
}

/** Take a message out of the conversation. Author always; space owners as moderation. */
export async function DELETE(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id, messageId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatSendRateLimit, { failClosed: true })
    if (limited) return limited

    const outcome = await runChatCommand<DeleteChatMessageInput, DeleteChatMessageResult>({
      request,
      req,
      commandId: 'chat.messages.delete',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        messageId,
      },
      resourceKind: 'chat.message',
      resourceId: messageId,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.messages.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'One message',
  methods: {
    PATCH: {
      summary: 'Edit a message',
      description:
        'The author only — not a space owner, and not the other person in a direct conversation. Rewriting somebody else’s words is never permitted, which is deliberately narrower than deletion. The body is re-validated exactly as a send is, so editing cannot be used to mention somebody a send would refuse or to address `@everyone` outside a space, and the search document, mention rows, link rows and conversation preview are rebuilt in the same transaction. An empty body is refused: that would be a deletion, and it would strand any attachments on a message with nothing left to read. System messages record membership changes and cannot be edited.',
      responses: [
        { status: 200, description: 'The rewritten message.', schema: editMessageResponseSchema },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
    DELETE: {
      summary: 'Delete a message',
      description:
        'The author always; in a space, an owner too, because removing a message is moderation and a space already has owners who decide what the shared conversation looks like. A direct conversation has no owner, so only the author may delete there. A soft delete: the message leaves the transcript, search, the unread mention count and the Shared panel, pins to it are removed, and a reply quoting it degrades to "Original message unavailable" rather than losing its reference. Deleting something already deleted converges rather than erroring. System messages cannot be deleted.',
      responses: [
        { status: 200, description: 'When the message was removed.', schema: deleteMessageResponseSchema },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
