import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const emailTag = 'Email'
export const emailTemplatesTag = 'Email Templates'
export const emailSettingsTag = 'Email Settings'

export const emailErrorSchema = z.object({
  error: z.string(),
})

export const emailConflictErrorSchema = emailErrorSchema.extend({
  code: z.string().optional(),
  current: z.unknown().optional(),
})

export const emailCommonErrors = [
  { status: 400, description: 'Validation failed', schema: emailErrorSchema },
  { status: 401, description: 'Authentication required', schema: emailErrorSchema },
  { status: 403, description: 'Forbidden', schema: emailErrorSchema },
  { status: 404, description: 'Not found', schema: emailErrorSchema },
  { status: 409, description: 'The record changed since it was loaded', schema: emailConflictErrorSchema },
] as const

export function createPagedListResponseSchema(itemSchema: z.ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildEmailCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: emailTag,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated organization.`,
  makeUpdateRequestBodyDescription: ({ resourceLower }) =>
    `Fields to update on the target ${resourceLower}.`,
})

export function createEmailCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildEmailCrudOpenApi(options)
}

export function createEmailOperationId(area: string, action: string) {
  return `email.${area}.${action}`
}
