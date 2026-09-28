import { cancelSchema } from '../../data/validators'
import { paymentGatewaysTag } from '../openapi'
import { runGatewayTransactionAction } from '../transactionAction'

export const metadata = {
  path: '/payment_gateways/cancel',
  POST: { requireAuth: true, requireFeatures: ['payment_gateways.manage'] },
}

export async function POST(req: Request) {
  return runGatewayTransactionAction(req, {
    schema: cancelSchema,
    perform: (service, data, scope) => service.cancelPayment(data.transactionId, data.reason, scope, data.operationId),
    failureMessage: 'Cancel failed',
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Cancel/void an authorized payment',
  methods: {
    POST: {
      summary: 'Cancel payment',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment cancelled' },
        { status: 409, description: 'Invalid payment status transition' },
        { status: 422, description: 'Invalid payload' },
        { status: 502, description: 'Gateway provider error' },
      ],
    },
  },
}
