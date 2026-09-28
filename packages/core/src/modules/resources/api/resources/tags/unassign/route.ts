import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resourcesResourceTagAssignmentSchema } from '../../../../data/validators'
import { changeResourceTag } from '../assignment'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
}

export async function POST(req: Request) {
  return changeResourceTag(req, {
    commandId: 'resources.resourceTags.unassign',
    successStatus: 200,
    failureLog: 'Tag unassign failed',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Resources',
  summary: 'Unassign resource tag',
  methods: {
    POST: {
      summary: 'Unassign resource tag',
      description: 'Removes a tag from a resources resource.',
      requestBody: {
        contentType: 'application/json',
        schema: resourcesResourceTagAssignmentSchema,
      },
      responses: [
        { status: 200, description: 'Tag assignment removed', schema: z.object({ id: z.string().uuid().nullable() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
