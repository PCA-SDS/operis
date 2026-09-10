import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { invoicePaymentConfirmationPublicTransitionSchema } from '../../../../../data/validators'
import { createInvoiceOperationId, invoicePublicErrors, invoicePublicTag } from '../../../../openapi'
import { preparePublicRequest, logger, tokenParamsSchema, type RouteContext } from '../shared'

export const metadata = { POST: { requireAuth: false } }

export async function POST(req: Request, routeContext: RouteContext = {}) {
  try {
    const prepared = await preparePublicRequest(req, routeContext)
    if ('response' in prepared) return prepared.response
    const result = await prepared.service.rejectPublic(prepared.token)
    return NextResponse.json(invoicePaymentConfirmationPublicTransitionSchema.parse(result))
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Public payment confirmation reject failed', { err: error })
    return NextResponse.json({ error: 'Unable to process payment confirmation' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoicePublicTag,
  summary: 'Reject a payment confirmation',
  methods: {
    POST: {
      operationId: createInvoiceOperationId('paymentConfirmationPublic', 'reject'),
      summary: 'Reject payment through a public link',
      pathParams: tokenParamsSchema,
      responses: [{ status: 200, description: 'Payment confirmation rejected', schema: invoicePaymentConfirmationPublicTransitionSchema }],
      errors: invoicePublicErrors,
    },
  },
}
