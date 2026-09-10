import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { invoicePaymentConfirmationPublicPreviewSchema } from '../../../../data/validators'
import { createInvoiceOperationId, invoicePublicErrors, invoicePublicTag } from '../../../openapi'
import { preparePublicRequest, logger, tokenParamsSchema, type RouteContext } from './shared'

export const metadata = { GET: { requireAuth: false } }

export async function GET(req: Request, routeContext: RouteContext = {}) {
  try {
    const prepared = await preparePublicRequest(req, routeContext)
    if ('response' in prepared) return prepared.response
    const result = await prepared.service.getPublicPreview(prepared.token)
    return NextResponse.json(invoicePaymentConfirmationPublicPreviewSchema.parse(result))
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Public payment confirmation preview failed', { err: error })
    return NextResponse.json({ error: 'Unable to process payment confirmation' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: invoicePublicTag,
  summary: 'Preview a payment confirmation',
  methods: {
    GET: {
      operationId: createInvoiceOperationId('paymentConfirmationPublic', 'preview'),
      summary: 'Preview a public payment confirmation',
      pathParams: tokenParamsSchema,
      responses: [{ status: 200, description: 'Safe payment confirmation preview', schema: invoicePaymentConfirmationPublicPreviewSchema }],
      errors: invoicePublicErrors,
    },
  },
}
