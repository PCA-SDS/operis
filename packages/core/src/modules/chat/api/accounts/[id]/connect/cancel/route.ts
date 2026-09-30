import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatAccountWriteRateLimit } from '../../../../../lib/rateLimits'
import type { AccountActionInput } from '../../../../../commands/accounts'
import { enforceChatRateLimit, jsonOk, resolveChatRequest, runChatCommand, toChatErrorResponse } from '../../../../shared'
import { accountResponseSchema, CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS } from '../../../../openapi'
import { readAccountForCaller } from '../../../shared'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/** Stop a login in progress. Converges: with nothing running it changes nothing. */
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
      commandId: 'chat.accounts.cancelConnect',
      input: { tenantId: request.scope.tenantId, organizationId: request.scope.organizationId, accountId: id },
      resourceKind: 'chat.messaging_account',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk({ account: await readAccountForCaller(request, id) })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.cancelConnect')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Cancel connecting a messaging account',
  methods: {
    POST: {
      summary: 'Cancel a login in progress',
      description: 'The code on screen stops working. An account that was never connected goes back to not connected.',
      responses: [{ status: 200, description: 'The account.', schema: accountResponseSchema }],
      errors: [...COMMON_ERRORS, { status: 503, description: 'The network could not be reached' }, ...RATE_LIMITED_ERRORS],
    },
  },
}
