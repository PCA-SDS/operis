import { featureTogglesTag, checkNumberResponseSchema, featureToggleErrorSchema } from "../../openapi"
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { readFeatureToggleConfig } from "../readConfig"

export async function GET(req: Request) {
    return readFeatureToggleConfig(req, 'getNumberConfig')
}

const routeMetadata = {
    GET: { requireAuth: true },
}

export const metadata = routeMetadata

export const openApi: OpenApiRouteDoc = {
    tag: featureTogglesTag,
    summary: 'Check number toggle config',
    methods: {
        GET: {
            summary: 'Get number config',
            description: 'Gets the number configuration for a feature toggle.',
            query: z.object({
                identifier: z.string().describe('Feature toggle identifier'),
            }),
            responses: [
                { status: 200, description: 'Number config', schema: checkNumberResponseSchema },
            ],
            errors: [
                { status: 400, description: 'Bad Request', schema: featureToggleErrorSchema },
                { status: 401, description: 'Unauthorized', schema: featureToggleErrorSchema },
                { status: 404, description: 'Tenant not found', schema: featureToggleErrorSchema },
            ],
        },
    },
}
