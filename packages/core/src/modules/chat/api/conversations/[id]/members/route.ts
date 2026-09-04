import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatAddMembersSchema, chatMemberListQuerySchema } from '../../../../data/validators'
import { chatConversationCreateRateLimit, chatDirectoryRateLimit } from '../../../../lib/rateLimits'
import type { AddSpaceMembersInput } from '../../../../commands/spaces'
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
  addMembersResponseSchema,
  CHAT_TAG,
  COMMON_ERRORS,
  memberListSchema,
  RATE_LIMITED_ERRORS,
} from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  POST: { requireAuth: true, requireFeatures: ['chat.send'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Who is in this space.
 *
 * Answerable only about a conversation the caller is a member of — the service
 * runs the same participant check every other conversation read runs first, so a
 * space the caller is not in is a 404 and its membership cannot be enumerated.
 * Paged, so a large space is a details panel rather than a request for every
 * user in the organization.
 */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    // Metered on the directory bucket, and failing open like every other read:
    // refusing this over a Redis blip would break the details panel for a
    // request with no blast radius.
    const limited = await enforceChatRateLimit(request, chatDirectoryRateLimit, { failClosed: false })
    if (limited) return limited

    const query = chatMemberListQuerySchema.parse(searchParamsToObject(req.url))
    const members = await chatService(request).listMembers(readContext(request), id, {
      limit: query.limit,
      offset: query.offset,
      query: query.q,
    })
    return jsonOk(members)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.spaces.listMembers')
  }
}

/**
 * Add people to a space.
 *
 * Owners only. Every id is re-validated against the caller's own organization
 * server-side, so a forged id belonging to another tenant is refused before a
 * participant row exists — and the refusal reads the same whether the user is in
 * another organization, deactivated, or not a user at all.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatConversationCreateRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatAddMembersSchema.parse(await req.json())
    const outcome = await runChatCommand<AddSpaceMembersInput, { added: string[] }>({
      request,
      req,
      commandId: 'chat.spaces.addMembers',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        memberIds: body.memberIds,
      },
      resourceKind: 'chat.conversation',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.spaces.addMembers')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Space membership',
  methods: {
    GET: {
      summary: 'List the members of a space',
      description:
        'Members only; a space the caller does not belong to is indistinguishable from a missing one. Owners are listed first, then by join order. People who have left the organization are omitted rather than shown as blanks.',
      responses: [{ status: 200, description: 'A page of members.', schema: memberListSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
    POST: {
      summary: 'Add members to a space',
      description:
        'Owners only. Ids already in the space are ignored rather than refused, so two owners adding the same person at once — or a double-clicked button — converge on "they are in" instead of one of them failing. Any id that is not an active member of the caller’s own organization fails the whole request.',
      responses: [
        { status: 200, description: 'The members actually added.', schema: addMembersResponseSchema },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
