import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { staffLeaveRequestDecisionSchema } from '../../../data/validators'
import { decideLeaveRequest } from '../decision'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.leave_requests.manage'] },
}

export async function POST(req: Request) {
  return decideLeaveRequest(req, {
    commandId: 'staff.leave-requests.reject',
    errorKey: 'staff.leaveRequests.errors.reject',
    errorFallback: 'Failed to reject leave request.',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Reject leave request',
  methods: {
    POST: {
      summary: 'Reject leave request',
      description: 'Rejects a leave request with an optional comment.',
      requestBody: {
        contentType: 'application/json',
        schema: staffLeaveRequestDecisionSchema,
      },
      responses: [
        { status: 200, description: 'Leave request rejected', schema: z.object({ ok: z.literal(true), id: z.string().uuid().nullable() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
