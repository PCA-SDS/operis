import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resourcesResourceTagAssignmentSchema } from '../../../../data/validators'
import { changeResourceTag } from '../assignment'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
}

export async function POST(req: Request) {
  return changeResourceTag(req, {
    commandId: 'resources.resourceTags.assign',
    successStatus: 201,
    failureLog: 'Tag assign failed',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Resources',
  summary: 'Assign resource tag',
  methods: {
    POST: {
      summary: 'Assign resource tag',
      description: 'Assigns a tag to a resources resource.',
      requestBody: {
        contentType: 'application/json',
        schema: resourcesResourceTagAssignmentSchema,
      },
      responses: [
        { status: 201, description: 'Tag assignment created', schema: z.object({ id: z.string().uuid().nullable() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
