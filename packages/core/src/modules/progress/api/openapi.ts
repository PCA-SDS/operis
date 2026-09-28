import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createOptionalMetaPagedListResponseSchema,
  defaultCreateResponseSchema as sharedDefaultCreateResponseSchema,
  defaultOkResponseSchema as sharedDefaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const defaultCreateResponseSchema = sharedDefaultCreateResponseSchema
export const defaultOkResponseSchema = sharedDefaultOkResponseSchema

export const createPagedListResponseSchema = createOptionalMetaPagedListResponseSchema

const buildProgressCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Progress',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated tenant.`,
})

export function createProgressCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildProgressCrudOpenApi(options)
}
