import { refundSchema } from '../../data/validators'
import { paymentGatewaysTag } from '../openapi'
import { runGatewayTransactionAction } from '../transactionAction'

export const metadata = {
  path: '/payment_gateways/refund',
  POST: { requireAuth: true, requireFeatures: ['payment_gateways.refund'] },
}

export async function POST(req: Request) {
  return runGatewayTransactionAction(req, {
    schema: refundSchema,
    perform: (service, data, scope) => service.refundPayment(data.transactionId, data.amount, data.reason, scope, data.operationId),
    failureMessage: 'Refund failed',
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Refund a captured payment',
  methods: {
    POST: {
      summary: 'Refund payment',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment refunded' },
        { status: 409, description: 'Invalid payment status transition' },
        { status: 422, description: 'Invalid payload' },
        { status: 502, description: 'Gateway provider error' },
      ],
    },
  },
}
