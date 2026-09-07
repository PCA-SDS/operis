import { z, type ZodTypeAny } from 'zod'
import type { OpenApiResponseDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultCreateResponseSchema as sharedDefaultCreateResponseSchema,
  defaultOkResponseSchema as sharedDefaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const invoiceTag = 'Invoice'
export const invoiceInvoicesTag = 'Invoice Invoices'
export const invoicePartnersTag = 'Invoice Partners'
export const invoiceSettingsTag = 'Invoice Settings'
export const invoiceSyncTag = 'Invoice Sync'
export const invoicePaymentConfirmationsTag = 'Invoice Payment Confirmations'
export const invoicePublicTag = 'Invoice Public'

export const defaultCreateResponseSchema = sharedDefaultCreateResponseSchema
export const defaultOkResponseSchema = sharedDefaultOkResponseSchema

export const invoiceErrorSchema = z.object({
  error: z.string(),
})

export const invoiceConflictErrorSchema = invoiceErrorSchema.extend({
  code: z.string().optional(),
  current: z.unknown().optional(),
})

export const invoiceCommonErrors = [
  { status: 400, description: 'Validation failed', schema: invoiceErrorSchema },
  { status: 401, description: 'Authentication required', schema: invoiceErrorSchema },
  { status: 403, description: 'Forbidden', schema: invoiceErrorSchema },
  { status: 404, description: 'Not found', schema: invoiceErrorSchema },
  { status: 409, description: 'The record changed since it was loaded', schema: invoiceConflictErrorSchema },
] as const satisfies readonly OpenApiResponseDoc[]

export const invoicePublicErrors = [
  ...invoiceCommonErrors,
  { status: 410, description: 'The public link is expired', schema: invoiceErrorSchema },
  { status: 429, description: 'Too many requests', schema: invoiceErrorSchema },
] as const satisfies readonly OpenApiResponseDoc[]

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildInvoiceCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: invoiceTag,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated organization.`,
  makeUpdateRequestBodyDescription: ({ resourceLower }) =>
    `Fields to update on the target ${resourceLower}.`,
})

export function createInvoiceCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildInvoiceCrudOpenApi(options)
}

export function createInvoiceOperationId(area: string, action: string) {
  return `invoice.${area}.${action}`
}
