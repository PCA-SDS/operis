import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  chatConversationListQuerySchema,
  chatCreateConversationSchema,
} from '../../data/validators'
import { chatConversationCreateRateLimit } from '../../lib/rateLimits'
import type {
  EnsureDirectConversationInput,
  EnsureDirectConversationResult,
} from '../../commands/conversations'
import {
  chatService,
  enforceChatRateLimit,
  jsonOk,
  readContext,
  resolveChatRequest,
  runChatCommand,
  searchParamsToObject,
  toChatErrorResponse,
} from '../shared'
import {
  CHAT_TAG,
  COMMON_ERRORS,
  conversationListSchema,
  conversationSchema,
  RATE_LIMITED_ERRORS,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  POST: { requireAuth: true, requireFeatures: ['chat.send'] },
}

/** The caller's own conversations, most recently active first. */
export async function GET(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const query = chatConversationListQuerySchema.parse(searchParamsToObject(req.url))
    const result = await chatService(request).listConversations(readContext(request), {
      limit: query.limit,
    })
    return jsonOk(result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversations.list')
  }
}

/**
 * Open the conversation with someone, creating it only if it does not exist.
 *
 * Idempotent by design: pressing "message" twice, or both people doing it at the
 * same moment, converges on the same conversation id.
 */
export async function POST(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatConversationCreateRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatCreateConversationSchema.parse(await req.json())
    const input: EnsureDirectConversationInput = {
      tenantId: request.scope.tenantId,
      organizationId: request.scope.organizationId,
      userId: body.userId,
    }

    const outcome = await runChatCommand<EnsureDirectConversationInput, EnsureDirectConversationResult>({
      request,
      req,
      commandId: 'chat.conversations.ensureDirect',
      input,
      resourceKind: 'chat.conversation',
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    const conversation = await chatService(request).getConversation(
      readContext(request),
      outcome.result.conversationId,
    )
    return jsonOk(conversation)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.conversations.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Direct conversations',
  methods: {
    GET: {
      summary: 'List the caller’s conversations',
      description:
        'The caller’s most recently active conversations, up to `limit`. Deliberately a bounded top-N rather than a cursor walk: `last_message_at` is rewritten by every send, so a descending keyset would silently skip a conversation that got bumped between two page fetches. `hasMore` reports whether more exist; ask for a larger limit to see them. Only conversations the caller participates in, in their own tenant and organization.',
      responses: [{ status: 200, description: 'Conversations.', schema: conversationListSchema }],
      errors: [...COMMON_ERRORS],
    },
    POST: {
      summary: 'Open (or create) the direct conversation with someone',
      description:
        'Returns the one canonical conversation between the caller and the given user. A unique index on the sorted user pair makes repeated or concurrent calls converge on the same row. The target must be an active member of the caller’s own organization.',
      responses: [{ status: 200, description: 'The conversation.', schema: conversationSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
