import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatSetMemberRoleSchema } from '../../../../../data/validators'
import { chatConversationCreateRateLimit } from '../../../../../lib/rateLimits'
import type { RemoveSpaceMemberInput, SetSpaceMemberRoleInput } from '../../../../../commands/spaces'
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
  memberRoleResponseSchema,
  RATE_LIMITED_ERRORS,
  removeMemberResponseSchema,
} from '../../../../openapi'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['chat.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['chat.send'] },
}

const paramsSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() })

/**
 * Remove someone from a space, or leave it.
 *
 * One route for both, because they are the same write: deleting a participant
 * row. Which authorization applies is decided by the command from the session —
 * removing another person needs ownership, removing yourself never does — so a
 * member cannot escalate by pointing this at somebody else's id.
 *
 * Guarded by `chat.view` rather than `chat.send`: leaving a space is something a
 * read-only member must always be able to do, and gating it on the ability to
 * write would trap them in it.
 *
 * Deleting the row is the entire revocation. Read access, unread state and
 * realtime delivery all hang off it, and the SSE audience is recomputed from
 * these rows on every emit — so there is no window in which a removed member
 * keeps receiving messages, and no refresh is required on their side.
 */
export async function DELETE(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id, userId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatConversationCreateRateLimit, { failClosed: true })
    if (limited) return limited

    const outcome = await runChatCommand<
      RemoveSpaceMemberInput,
      { removed: string; spaceDeleted: boolean }
    >({
      request,
      req,
      commandId: 'chat.spaces.removeMember',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        userId,
      },
      resourceKind: 'chat.conversation',
      resourceId: id,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.spaces.removeMember')
  }
}

/**
 * Promote a member to owner, or step one back down.
 *
 * The promotion half is what keeps "the last owner cannot leave" from being a
 * dead end — there is always a way to create the second owner that rule asks
 * for. Both halves are owner-only and both are guarded by the same owner count,
 * so a space cannot be left without an administrator either by leaving or by
 * everyone demoting themselves.
 */
export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id, userId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatConversationCreateRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatSetMemberRoleSchema.parse(await req.json())
    const outcome = await runChatCommand<
      SetSpaceMemberRoleInput,
      { userId: string; role: 'owner' | 'member' }
    >({
      request,
      req,
      commandId: 'chat.spaces.setMemberRole',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        userId,
        role: body.role,
      },
      resourceKind: 'chat.conversation',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.spaces.setMemberRole')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'One member of a space',
  methods: {
    DELETE: {
      summary: 'Remove a member, or leave the space',
      description:
        'Removing another person requires ownership; removing yourself never does. The last owner cannot leave while other members remain — promote someone first — unless they are also the last member, in which case the space is soft-deleted with them. Messages the removed person sent are kept: they are rows in the transcript, not a property of membership.',
      responses: [
        { status: 200, description: 'Who was removed, and whether the space went with them.', schema: removeMemberResponseSchema },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
    PATCH: {
      summary: 'Change a member’s role',
      description:
        'Owners only. Demoting the last owner is refused, so a space always has someone able to manage it.',
      responses: [{ status: 200, description: 'The resulting role.', schema: memberRoleResponseSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
