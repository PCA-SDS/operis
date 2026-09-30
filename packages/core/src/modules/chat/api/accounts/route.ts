import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatAccountCreateSchema } from '../../data/validators'
import { chatAccountReadRateLimit, chatAccountWriteRateLimit } from '../../lib/rateLimits'
import { resolveChatAccountConnector } from '../../lib/accountConnector'
import {
  callerHasChatFeatures,
  CONNECT_OWN_ACCOUNT_FEATURE,
  listAccountsForCaller,
  MANAGE_ACCOUNTS_FEATURE,
  toAccountDtos,
} from '../../lib/accounts'
import type { CreateAccountInput } from '../../commands/accounts'
import { enforceChatRateLimit, jsonOk, resolveChatRequest, runChatCommand, toChatErrorResponse } from '../shared'
import { accountListSchema, accountResponseSchema, CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS } from '../openapi'
import { readAccountForCaller } from './shared'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

/**
 * The messaging accounts the caller may manage — the company's, with
 * `chat.accounts.manage`, and their own personal ones, with
 * `chat.accounts.connect_own` — and what this deployment can connect.
 */
export async function GET(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatAccountReadRateLimit, { failClosed: false })
    if (limited) return limited

    const [canManageCompany, canConnectOwn] = await Promise.all([
      callerHasChatFeatures(request.container, request.userId, request.scope, [MANAGE_ACCOUNTS_FEATURE]),
      callerHasChatFeatures(request.container, request.userId, request.scope, [CONNECT_OWN_ACCOUNT_FEATURE]),
    ])
    const connector = resolveChatAccountConnector(request.container)
    const accounts = await listAccountsForCaller(request.container, request.em, request.scope, request.userId)

    return jsonOk({
      items: await toAccountDtos(request.em, request.scope, accounts),
      networks: connector.networks(),
      personalAccounts: connector.supportsPersonalAccounts(),
      canManageCompany,
      canConnectOwn,
    })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.list')
  }
}

export async function POST(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatAccountWriteRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatAccountCreateSchema.parse(await req.json())
    const outcome = await runChatCommand<CreateAccountInput, { accountId: string }>({
      request,
      req,
      commandId: 'chat.accounts.create',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        network: body.network,
        name: body.name,
        ownerType: body.ownerType,
        memberUserIds: body.memberUserIds,
      },
      resourceKind: 'chat.messaging_account',
      operation: 'create',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk({ account: await readAccountForCaller(request, outcome.result.accountId) })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.accounts.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Messaging accounts',
  methods: {
    GET: {
      summary: 'List the messaging accounts the caller may manage',
      description:
        "Company accounts need `chat.accounts.manage`; personal ones are the caller's own and need `chat.accounts.connect_own`. Also says which networks this deployment can connect and whether personal accounts are available.",
      responses: [{ status: 200, description: 'The accounts and what can be connected.', schema: accountListSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
    POST: {
      summary: 'Add a messaging account',
      description:
        'Creates it unconnected. A company account needs a team of at least one active colleague, who are seated in every chat that comes in through it. A person may have one personal account per network.',
      responses: [{ status: 200, description: 'The new account.', schema: accountResponseSchema }],
      errors: [...COMMON_ERRORS, { status: 409, description: 'A personal account on that network already exists' }, ...RATE_LIMITED_ERRORS],
    },
  },
}
