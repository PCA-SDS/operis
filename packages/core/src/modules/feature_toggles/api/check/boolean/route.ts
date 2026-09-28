import { featureTogglesTag, checkResponseSchema, featureToggleErrorSchema } from "../../openapi"
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { readFeatureToggleConfig } from "../readConfig"

export async function GET(req: Request) {
    return readFeatureToggleConfig(req, 'getBoolConfig')
}

const routeMetadata = {
    GET: { requireAuth: true },
}

export const metadata = routeMetadata

export const openApi: OpenApiRouteDoc = {
    tag: featureTogglesTag,
    summary: 'Check feature toggle status',
    methods: {
        GET: {
            summary: 'Check if feature is enabled',
            description: 'Checks if a feature toggle is enabled for the current context.',
            query: z.object({
                identifier: z.string().describe('Feature toggle identifier'),
            }),
            responses: [
                { status: 200, description: 'Feature status', schema: checkResponseSchema },
            ],
            errors: [
                { status: 400, description: 'Bad Request', schema: featureToggleErrorSchema },
                { status: 401, description: 'Unauthorized', schema: featureToggleErrorSchema },
                { status: 404, description: 'Tenant not found', schema: featureToggleErrorSchema },
            ],
        },
    },
}
