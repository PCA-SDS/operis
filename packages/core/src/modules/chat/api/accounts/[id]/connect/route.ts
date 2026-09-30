import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatAccountConnectSchema } from '../../../../data/validators'
import { chatAccountWriteRateLimit } from '../../../../lib/rateLimits'
import type { ConnectAccountInput } from '../../../../commands/accounts'
import { enforceChatRateLimit, jsonOk, resolveChatRequest, runChatCommand, toChatErrorResponse } from '../../../shared'
import { accountResponseSchema, CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS } from '../../../openapi'
import { readAccountForCaller } from '../../shared'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Start connecting: answers at once with the first QR code (or the pairing
 * code for the phone number given). New codes replace it on the account as
 * WhatsApp rotates them; the page re-reads the account to show them.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatAccountWriteRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatAccountConnectSchema.parse(await req.json())
    const outcome = await runChatCommand<ConnectAccountInput, { accountId: string }>({
      request,
      req,
      commandId: 'chat.accounts.connect',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        accountId: id,
        flow: body.flow,
        phoneNumber: body.phoneNumber ?? null,
      },
      resourceKind: 'chat.messaging_account',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk({ account: await readAccountForCaller(request, id) })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.connect')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Connect a messaging account',
  methods: {
    POST: {
      summary: 'Start connecting a messaging account',
      description:
        "`qr` shows a code to scan in WhatsApp → Linked devices. `phone` takes the account's number in international format and shows an 8-character pairing code to type there instead. Starting again replaces a login in progress.",
      responses: [{ status: 200, description: 'The account, with the first code to show.', schema: accountResponseSchema }],
      errors: [
        ...COMMON_ERRORS,
        { status: 409, description: 'Already connected' },
        { status: 503, description: 'The network could not be reached' },
        ...RATE_LIMITED_ERRORS,
      ],
    },
  },
}
