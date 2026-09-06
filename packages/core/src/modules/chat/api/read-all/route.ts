import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { MarkAllConversationsReadInput } from '../../commands/conversations'
import { chatReadCursorRateLimit } from '../../lib/rateLimits'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../shared'
import { CHAT_TAG, COMMON_ERRORS, markAllReadResponseSchema, RATE_LIMITED_ERRORS } from '../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

/**
 * Catch up on every conversation at once — what "clear" means for chat.
 *
 * There is no recipient or conversation parameter: this only ever moves the
 * caller's own cursors, so it cannot be used to mark someone else read, and it
 * cannot reach a conversation the caller is not in.
 *
 * One request rather than one per conversation. Clearing a full inbox from the
 * topbar would otherwise be up to `MAX_CONVERSATION_PAGE_SIZE` round trips, each
 * paying its own guard, rate-limit check and event.
 */
export async function POST(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    // Metered like the single-conversation cursor: it is the same write, and
    // being the cheaper way to move many rows is a reason to count it, not skip it.
    const limited = await enforceChatRateLimit(request, chatReadCursorRateLimit, { failClosed: true })
    if (limited) return limited

    const input: MarkAllConversationsReadInput = {
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
    }

    const outcome = await runChatCommand<
      MarkAllConversationsReadInput,
      { conversationIds: string[]; lastReadAt: string }
    >({
      request,
      req,
      commandId: 'chat.conversations.markAllRead',
      input,
      resourceKind: 'chat.conversation',
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversations.markAllRead')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Read cursors for every conversation',
  methods: {
    POST: {
      summary: 'Mark every conversation read',
      description:
        'Moves the caller’s own read cursor forward in every conversation that currently has unread messages. Conversations already caught up are left untouched and emit no event.',
      responses: [
        {
          status: 200,
          description: 'The conversations whose cursor moved, and the cursor they moved to.',
          schema: markAllReadResponseSchema,
        },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
