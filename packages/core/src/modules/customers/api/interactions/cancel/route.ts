import { z } from 'zod'
import { interactionCancelSchema } from '../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runInteractionLifecycleCommand } from '../lifecycle'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.interactions.manage'] },
}

export async function POST(req: Request) {
  return runInteractionLifecycleCommand(req, { commandId: 'customers.interactions.cancel', schema: interactionCancelSchema })
}

const okResponseSchema = z.object({ ok: z.boolean() })
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Cancel an interaction',
  methods: {
    POST: {
      summary: 'Cancel an interaction',
      description: 'Marks an interaction as canceled.',
      requestBody: { contentType: 'application/json', schema: interactionCancelSchema },
      responses: [
        { status: 200, description: 'Interaction canceled', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Interaction not found', schema: errorSchema },
      ],
    },
  },
}
