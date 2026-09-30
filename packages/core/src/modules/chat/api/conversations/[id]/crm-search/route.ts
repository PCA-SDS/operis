import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { searchParamsToObject } from '@open-mercato/shared/lib/http/query'
import { chatCrmSearchQuerySchema } from '../../../../data/validators'
import { hasAccess } from '../../../../lib/access'
import { customerHref, searchCustomers, viewableCustomerKinds } from '../../../../lib/crm'
import { chatDirectoryRateLimit } from '../../../../lib/rateLimits'
import { loadSpaceContext } from '../../../../lib/spaces'
import { enforceChatRateLimit, jsonOk, resolveChatRequest, toChatErrorResponse } from '../../../shared'
import { CHAT_TAG, COMMON_ERRORS, crmSearchResultSchema, RATE_LIMITED_ERRORS } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.send'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Find the CRM record to link an outsider to, from inside their conversation.
 *
 * Only for a colleague there who may link — one who can answer the client —
 * and only among the kinds of record the CRM lets them open. Without a CRM, or
 * without either permission, the answer is simply empty.
 */
export async function GET(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatDirectoryRateLimit, { failClosed: false })
    if (limited) return limited

    const { q } = chatCrmSearchQuerySchema.parse(searchParamsToObject(req.url))
    const { conversation, participant } = await loadSpaceContext(request.em, request.scope, id, request.userId)
    if (conversation.kind !== 'external' || !hasAccess(participant, 'participant')) {
      throw forbidden(request.messages.crmLinkNotAllowed)
    }

    const kinds = await viewableCustomerKinds(request.container, request.userId, request.scope)
    const found = await searchCustomers(request.em, request.container, request.scope, q, kinds)
    return jsonOk({
      items: found.map((record) => ({ ...record, href: customerHref(record.kind, record.id) })),
    })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.crm.search')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'CRM search for linking an outsider',
  methods: {
    GET: {
      summary: 'Search CRM people and companies',
      description:
        'For a colleague in the client conversation who may answer the client. Matches names and phone numbers among the kinds of record the caller may open in the CRM — people with `customers.people.view`, companies with `customers.companies.view` — in the caller’s organization. At most ten. Empty when the CRM is not installed.',
      query: chatCrmSearchQuerySchema,
      responses: [{ status: 200, description: 'Matching records.', schema: crmSearchResultSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
