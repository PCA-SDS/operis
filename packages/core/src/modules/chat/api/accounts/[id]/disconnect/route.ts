import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatAccountWriteRateLimit } from '../../../../lib/rateLimits'
import type { AccountActionInput } from '../../../../commands/accounts'
import { enforceChatRateLimit, jsonOk, resolveChatRequest, runChatCommand, toChatErrorResponse } from '../../../shared'
import { accountResponseSchema, CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS } from '../../../openapi'
import { readAccountForCaller } from '../../shared'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Log the account out of its network. Its conversations stay; nothing more
 * arrives or leaves until it is connected again.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
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
      commandId: 'chat.accounts.disconnect',
      input: { tenantId: request.scope.tenantId, organizationId: request.scope.organizationId, accountId: id },
      resourceKind: 'chat.messaging_account',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk({ account: await readAccountForCaller(request, id) })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.disconnect')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Disconnect a messaging account',
  methods: {
    POST: {
      summary: 'Disconnect a messaging account',
      description:
        'Logs it out of its network — WhatsApp removes it from Linked devices. Conversations stay; replying is refused until it is connected again. Honours the optimistic-lock header.',
      responses: [{ status: 200, description: 'The account.', schema: accountResponseSchema }],
      errors: [...COMMON_ERRORS, { status: 503, description: 'The network could not be reached' }, ...RATE_LIMITED_ERRORS],
    },
  },
}
