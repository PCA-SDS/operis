import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatLinkCustomerSchema } from '../../../../../../data/validators'
import { chatConversationCreateRateLimit } from '../../../../../../lib/rateLimits'
import type { LinkContactCustomerInput } from '../../../../../../commands/crm'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../../../../../shared'
import {
  CHAT_TAG,
  COMMON_ERRORS,
  contactCustomerResponseSchema,
  RATE_LIMITED_ERRORS,
} from '../../../../../openapi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['chat.send'] },
}

const paramsSchema = z.object({ id: z.string().uuid(), contactId: z.string().uuid() })

/**
 * Link an outsider in this client conversation to the CRM record they are, or
 * unlink them with `null`. The command decides who may: a colleague here who
 * can answer the client, linking a record the CRM lets them open.
 */
export async function PUT(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id, contactId } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatConversationCreateRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatLinkCustomerSchema.parse(await req.json())
    const outcome = await runChatCommand<
      LinkContactCustomerInput,
      { externalContactId: string; customerEntityId: string | null }
    >({
      request,
      req,
      commandId: 'chat.externalContacts.linkCustomer',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        externalContactId: contactId,
        customerEntityId: body.customerEntityId,
      },
      resourceKind: 'chat.conversation',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response
    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.externalContacts.linkCustomer')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'An outsider’s CRM record',
  methods: {
    PUT: {
      summary: 'Link an outsider to a CRM person or company, or unlink them',
      description:
        'Colleagues in the client conversation who may answer the client — participants and managers. `customerEntityId` must name a live CRM person or company in the caller’s organization that the caller may open in the CRM; otherwise 404, the same whether it is missing or hidden. `null` unlinks. The link belongs to the contact, so every conversation with them shows it.',
      responses: [{ status: 200, description: 'The contact and the record it is now linked to.', schema: contactCustomerResponseSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
