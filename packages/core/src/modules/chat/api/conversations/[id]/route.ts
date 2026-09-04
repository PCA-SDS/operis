import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatRenameConversationSchema } from '../../../data/validators'
import { chatConversationCreateRateLimit } from '../../../lib/rateLimits'
import type { RenameSpaceInput } from '../../../commands/spaces'
import {
  chatService,
  enforceChatRateLimit,
  jsonOk,
  readContext,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../../shared'
import {
  CHAT_TAG,
  COMMON_ERRORS,
  conversationSchema,
  RATE_LIMITED_ERRORS,
} from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['chat.send'] },
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

/**
 * Rename a space.
 *
 * Owners only, enforced by the command against the caller's own participant row
 * — there is no request shape that names a different actor. A direct
 * conversation is refused: its name is the other person, so there is nothing
 * here to set.
 */
export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatConversationCreateRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatRenameConversationSchema.parse(await req.json())
    const outcome = await runChatCommand<RenameSpaceInput, { title: string }>({
      request,
      req,
      commandId: 'chat.spaces.rename',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        title: body.title,
      },
      resourceKind: 'chat.conversation',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(await chatService(request).getConversation(readContext(request), id))
  } catch (error) {
    return toChatErrorResponse(error, 'chat.spaces.rename')
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
    PATCH: {
      summary: 'Rename a space',
      description:
        'Owners only. The caller’s role is read from their own participant row, so there is no payload that grants it. Renaming a direct conversation is a 400 — its name is the other person. A rename to the current name is a no-op and writes nothing, so pressing Save on an unchanged field does not post a system message or bump the space in everyone’s list.',
      responses: [{ status: 200, description: 'The renamed conversation.', schema: conversationSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
