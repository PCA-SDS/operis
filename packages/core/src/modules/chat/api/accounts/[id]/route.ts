import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatAccountUpdateSchema } from '../../../data/validators'
import { chatAccountReadRateLimit, chatAccountWriteRateLimit } from '../../../lib/rateLimits'
import type { AccountActionInput, UpdateAccountInput } from '../../../commands/accounts'
import { enforceChatRateLimit, jsonOk, resolveChatRequest, runChatCommand, toChatErrorResponse } from '../../shared'
import { accountResponseSchema, CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS } from '../../openapi'
import { readAccountForCaller } from '../shared'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['chat.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/** One account, with the login step on screen while it connects — what the connect page polls. */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatAccountReadRateLimit, { failClosed: false })
    if (limited) return limited

    return jsonOk({ account: await readAccountForCaller(request, id) })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.get')
  }
}

export async function PATCH(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatAccountWriteRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatAccountUpdateSchema.parse(await req.json())
    const outcome = await runChatCommand<UpdateAccountInput, { accountId: string }>({
      request,
      req,
      commandId: 'chat.accounts.update',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        accountId: id,
        name: body.name,
        memberUserIds: body.memberUserIds,
        showSenderName: body.showSenderName,
      },
      resourceKind: 'chat.messaging_account',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk({ account: await readAccountForCaller(request, id) })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.update')
  }
}

export async function DELETE(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatAccountWriteRateLimit, { failClosed: true })
    if (limited) return limited

    const outcome = await runChatCommand<AccountActionInput, { accountId: string }>({
      request,
      req,
      commandId: 'chat.accounts.delete',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        accountId: id,
      },
      resourceKind: 'chat.messaging_account',
      resourceId: id,
      operation: 'delete',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk({ ok: true })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'A messaging account',
  methods: {
    GET: {
      summary: 'Read one messaging account',
      description:
        'Includes the QR code or pairing code to show while it connects. An account the caller may not manage is indistinguishable from a missing one.',
      responses: [{ status: 200, description: 'The account.', schema: accountResponseSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
    PATCH: {
      summary: 'Rename an account, change its team, or turn reply signatures on or off',
      description:
        'A new team applies to chats that arrive afterwards; open chats keep their people. Honours the optimistic-lock header.',
      responses: [{ status: 200, description: 'The updated account.', schema: accountResponseSchema }],
      errors: [...COMMON_ERRORS, { status: 409, description: 'Changed by someone else since it was read' }, ...RATE_LIMITED_ERRORS],
    },
    DELETE: {
      summary: 'Disconnect and remove a messaging account',
      description:
        'Logs it out of its network first; if the network cannot be reached, nothing is removed and the call answers 503. Its conversations stay.',
      responses: [{ status: 200, description: 'Removed.', schema: z.object({ ok: z.boolean() }) }],
      errors: [...COMMON_ERRORS, { status: 503, description: 'The network could not be reached' }, ...RATE_LIMITED_ERRORS],
    },
  },
}
