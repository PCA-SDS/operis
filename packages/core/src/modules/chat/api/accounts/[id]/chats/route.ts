import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveChatAccountConnector } from '../../../../lib/accountConnector'
import { canAccessAccount, loadAccount } from '../../../../lib/accounts'
import { chatAccountReadRateLimit } from '../../../../lib/rateLimits'
import { enforceChatRateLimit, jsonOk, resolveChatRequest, toChatErrorResponse } from '../../../shared'
import { accountChatListSchema, CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS } from '../../../openapi'

const logger = createLogger('chat').child({ component: 'account-chats' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.accounts.connect_own'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * The chats on the caller's own personal WhatsApp, for choosing one to move to
 * the company. Read live from the network each time and never stored: names
 * only, never a message. Anyone else's account is the same 404 as none.
 */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatAccountReadRateLimit, { failClosed: false })
    if (limited) return limited

    const em = request.em.fork()
    const account = await loadAccount(em, request.scope, id)
    const own =
      account?.ownerType === 'user' &&
      account.ownerUserId === request.userId &&
      (await canAccessAccount(request.container, request.scope, request.userId, account))
    if (!account || !own) throw notFound(request.messages.accountNotFound)
    if (account.status !== 'connected') throw conflict(request.messages.accountNotConnected)

    const connector = resolveChatAccountConnector(request.container)
    let items
    try {
      items = await connector.listChats(
        { em, container: request.container },
        {
          id: account.id,
          network: account.network,
          ownerType: account.ownerType,
          ownerUserId: account.ownerUserId ?? null,
          scope: request.scope,
        },
      )
    } catch (error) {
      if (error instanceof CrudHttpError) throw error
      logger.error('could not list a personal account’s chats', {
        accountId: account.id,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new CrudHttpError(503, { error: request.messages.accountUnreachable })
    }
    return jsonOk({ items })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.listChats')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'The chats on a personal account',
  methods: {
    GET: {
      summary: 'List the chats on your personal WhatsApp',
      description:
        'The caller’s own connected personal account only. Read live from WhatsApp for choosing a chat to move to the company — names only, never a message, and nothing is stored. A chat already moved carries its conversation id.',
      responses: [{ status: 200, description: 'The chats.', schema: accountChatListSchema }],
      errors: [
        ...COMMON_ERRORS,
        { status: 409, description: 'The account is not connected' },
        { status: 503, description: 'The network could not be reached' },
        ...RATE_LIMITED_ERRORS,
      ],
    },
  },
}
