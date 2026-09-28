import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { tagAssignmentSchema } from '../../../data/validators'
import { changeCustomerTag } from '../assignment'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

export async function POST(req: Request) {
  return changeCustomerTag(req, {
    commandId: 'customers.tags.assign',
    successStatus: 201,
    errorKey: 'customers.errors.assign_failed',
    errorFallback: 'Failed to assign tag',
  })
}

const tagAssignmentResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

const tagAssignmentErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Assign customer tag',
  methods: {
    POST: {
      summary: 'Assign tag to customer entity',
      description: 'Links a tag to a customer entity within the validated tenant / organization scope.',
      requestBody: {
        contentType: 'application/json',
        schema: tagAssignmentSchema,
      },
      responses: [
        { status: 201, description: 'Tag assigned to customer', schema: tagAssignmentResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation or assignment failed', schema: tagAssignmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: tagAssignmentErrorSchema },
        { status: 403, description: 'Insufficient tenant/organization access', schema: tagAssignmentErrorSchema },
      ],
    },
  },
}
