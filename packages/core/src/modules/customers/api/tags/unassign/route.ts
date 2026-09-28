import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { tagAssignmentSchema } from '../../../data/validators'
import { changeCustomerTag } from '../assignment'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

export async function POST(req: Request) {
  return changeCustomerTag(req, {
    commandId: 'customers.tags.unassign',
    successStatus: 200,
    errorKey: 'customers.errors.unassign_failed',
    errorFallback: 'Failed to unassign tag',
  })
}

const tagUnassignResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

const tagUnassignErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Unassign customer tag',
  methods: {
    POST: {
      summary: 'Remove tag from customer entity',
      description: 'Detaches a tag from a customer entity within the validated tenant / organization scope.',
      requestBody: {
        contentType: 'application/json',
        schema: tagAssignmentSchema,
      },
      responses: [
        { status: 200, description: 'Tag unassigned from customer', schema: tagUnassignResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation or unassignment failed', schema: tagUnassignErrorSchema },
        { status: 401, description: 'Unauthorized', schema: tagUnassignErrorSchema },
        { status: 403, description: 'Insufficient tenant/organization access', schema: tagUnassignErrorSchema },
      ],
    },
  },
}
