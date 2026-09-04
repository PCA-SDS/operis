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
import type { CreateSpaceInput } from '../../commands/spaces'
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
 * Create a conversation of either kind.
 *
 * One endpoint, because both produce the same resource and both are read back
 * through the same `getConversation`. The body is a discriminated union on
 * `kind`, which defaults to `direct` when absent — so a client that posts a bare
 * `{ userId }`, as every caller did before spaces existed, is unaffected.
 *
 * The direct branch is idempotent by design: pressing "message" twice, or both
 * people doing it at the same moment, converges on the same conversation id. The
 * space branch is not, and must not be — two spaces with the same name are two
 * different rooms, exactly as they are in every other product.
 */
export async function POST(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatConversationCreateRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatCreateConversationSchema.parse(await req.json())

    const outcome =
      body.kind === 'space'
        ? await runChatCommand<CreateSpaceInput, { conversationId: string }>({
            request,
            req,
            commandId: 'chat.spaces.create',
            input: {
              tenantId: request.scope.tenantId,
              organizationId: request.scope.organizationId,
              title: body.title,
              memberIds: body.memberIds,
            },
            resourceKind: 'chat.conversation',
            operation: 'create',
          })
        : await runChatCommand<EnsureDirectConversationInput, EnsureDirectConversationResult>({
            request,
            req,
            commandId: 'chat.conversations.ensureDirect',
            input: {
              tenantId: request.scope.tenantId,
              organizationId: request.scope.organizationId,
              userId: body.userId,
            },
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
      summary: 'Create a conversation — a direct message or a space',
      description:
        'A discriminated union on `kind`. `direct` (the default when `kind` is omitted, so pre-space clients are unaffected) returns the one canonical conversation between the caller and `userId`; a unique index on the sorted user pair makes repeated or concurrent calls converge on the same row. `space` creates a named group with the caller as owner and `memberIds` as members. Every named user, and the caller, must be an active member of the caller’s own organization; one that is not fails the whole request with a message that does not distinguish "no such user" from "another organization".',
      responses: [{ status: 200, description: 'The conversation.', schema: conversationSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
