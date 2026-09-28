import { captureSchema } from '../../data/validators'
import { paymentGatewaysTag } from '../openapi'
import { runGatewayTransactionAction } from '../transactionAction'

export const metadata = {
  path: '/payment_gateways/capture',
  POST: { requireAuth: true, requireFeatures: ['payment_gateways.capture'] },
}

export async function POST(req: Request) {
  return runGatewayTransactionAction(req, {
    schema: captureSchema,
    perform: (service, data, scope) => service.capturePayment(data.transactionId, data.amount, scope, data.operationId),
    failureMessage: 'Capture failed',
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Capture an authorized payment',
  methods: {
    POST: {
      summary: 'Capture payment',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment captured' },
        { status: 409, description: 'Invalid payment status transition, cumulative capture ceiling exceeded, or conflicting capture operation' },
        { status: 422, description: 'Invalid payload' },
        { status: 502, description: 'Gateway provider error' },
      ],
    },
  },
}
