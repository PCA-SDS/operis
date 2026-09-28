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

const buildCurrenciesCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Currencies',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated organization.`,
})

export function createCurrenciesCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildCurrenciesCrudOpenApi(options)
}
