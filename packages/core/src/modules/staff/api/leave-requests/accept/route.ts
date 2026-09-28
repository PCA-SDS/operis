import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { staffLeaveRequestDecisionSchema } from '../../../data/validators'
import { decideLeaveRequest } from '../decision'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.leave_requests.manage'] },
}

export async function POST(req: Request) {
  return decideLeaveRequest(req, {
    commandId: 'staff.leave-requests.accept',
    errorKey: 'staff.leaveRequests.errors.accept',
    errorFallback: 'Failed to approve leave request.',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Approve leave request',
  methods: {
    POST: {
      summary: 'Approve leave request',
      description: 'Approves a leave request and adds unavailability rules for the staff member.',
      requestBody: {
        contentType: 'application/json',
        schema: staffLeaveRequestDecisionSchema,
      },
      responses: [
        { status: 200, description: 'Leave request approved', schema: z.object({ ok: z.literal(true), id: z.string().uuid().nullable() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
