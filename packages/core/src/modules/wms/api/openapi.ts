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

const buildWmsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'WMS',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated organization.`,
})

export function createWmsCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildWmsCrudOpenApi(options)
}
