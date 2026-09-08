import { createHash } from 'node:crypto'
import { z } from 'zod'

import {
  INVOICE_CURRENCY_CODES,
  INVOICE_DIRECTIONS,
  INVOICE_INSTALLMENT_INTEREST_RATE_MAX,
  INVOICE_INSTALLMENT_INTEREST_RATE_MIN,
  INVOICE_INSTALLMENT_STATUSES,
  INVOICE_MAX_DUE_DAYS,
  INVOICE_ORIGINS,
  INVOICE_PAYMENT_CONFIRMATION_STATUSES,
  INVOICE_PUBLIC_TOKEN_HEX_LENGTH,
  INVOICE_SETTLEMENT_STATUSES,
  INVOICE_STATUSES,
  INVOICE_SYNC_JOB_FAILURE_CATEGORIES,
  INVOICE_SYNC_JOB_STATES,
} from './entities'

// The database check constraints are the source of truth for these bounds, so
// they live next to the entities and are re-exported here for API validators.
export {
  INVOICE_INSTALLMENT_INTEREST_RATE_MAX,
  INVOICE_INSTALLMENT_INTEREST_RATE_MIN,
  INVOICE_MAX_DUE_DAYS,
  INVOICE_PUBLIC_TOKEN_HEX_LENGTH,
}

export const INVOICE_PAGE_SIZE_DEFAULT = 20
export const INVOICE_PAGE_SIZE_MAX = 100
export const INVOICE_PARTNER_PAGE_SIZE_DEFAULT = 20
export const INVOICE_LINE_ITEMS_MAX = 100
export const INVOICE_MANUAL_ISSUE_DATE_MIN = '2000-01-01'
export const INVOICE_MANUAL_FORM_DEFAULT_DUE_DAYS = 45
export const INVOICE_PARTNER_DEFAULT_DUE_DAYS = 30
export const INVOICE_PAYMENT_CONFIRMATION_TOKEN_BYTES = 32
export const INVOICE_PAYMENT_CONFIRMATION_TTL_DAYS = 14
export const INVOICE_INSTALLMENT_COUNT_MIN = 2
export const INVOICE_INSTALLMENT_COUNT_MAX = 60
export const INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH = 1000
export const INVOICE_SYNC_MAX_WINDOW_DAYS = 1825
export const INVOICE_SYNC_COOLDOWN_SECONDS = 300
export const INVOICE_SYNC_FAILED_AUTH_BACKOFF_SECONDS = 900
export const INVOICE_SYNC_MAX_AUTH_ATTEMPTS = 3
export const INVOICE_SYNC_ACTIVE_LOCK_TTL_SECONDS = 1800
export const INVOICE_SYNC_CAPTCHA_TTL_SECONDS = 180
export const INVOICE_SYNC_GDT_TOKEN_TTL_CAP_SECONDS = 82800
export const INVOICE_COMPANY_LOOKUP_CACHE_TTL_DAYS = 30
export const INVOICE_TRACKING_PIXEL_RATE_LIMIT_REQUESTS = 120
export const INVOICE_TRACKING_PIXEL_RATE_LIMIT_WINDOW_SECONDS = 60
export const INVOICE_COMPANY_LOOKUP_RATE_LIMIT_REQUESTS = 60
export const INVOICE_COMPANY_LOOKUP_RATE_LIMIT_WINDOW_SECONDS = 60

const uuid = () => z.string().uuid()
const nullableTrimmedString = (max: number) => z.string().trim().max(max).nullable().optional()
const optionalTrimmedString = (schema: z.ZodString) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }, schema.optional())

export const invoiceDirectionSchema = z.enum(INVOICE_DIRECTIONS)
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES)
export const invoiceOriginSchema = z.enum(INVOICE_ORIGINS)
export const invoiceSettlementStatusSchema = z.enum(INVOICE_SETTLEMENT_STATUSES)
export const invoiceInstallmentStatusSchema = z.enum(INVOICE_INSTALLMENT_STATUSES)
export const invoicePaymentConfirmationStatusSchema = z.enum(INVOICE_PAYMENT_CONFIRMATION_STATUSES)
export const invoiceSyncJobStateSchema = z.enum(INVOICE_SYNC_JOB_STATES)
export const invoiceSyncJobFailureCategorySchema = z.enum(INVOICE_SYNC_JOB_FAILURE_CATEGORIES)
export const invoiceCurrencyCodeSchema = z.enum(INVOICE_CURRENCY_CODES)

export const invoiceSettlementFilterSchema = z.enum(['settled', 'unsettled'])
export const invoiceRecoverabilityFilterSchema = z.enum(['all', 'recoverable', 'nonRecoverable'])
export const invoiceSortDirectionSchema = z.enum(['asc', 'desc'])
export const invoiceSortFieldSchema = z.enum([
  'invoiceDate',
  'dueDate',
  'invoiceNumber',
  'grossAmount',
  'settlementStatus',
  'invoiceStatus',
  'createdAt',
  'updatedAt',
])

export const invoiceIdSchema = uuid()
export const invoiceCompanyIdSchema = uuid()
export const invoiceCompanyEmailIdSchema = uuid()
export const invoiceLineItemIdSchema = uuid()
export const invoiceInstallmentIdSchema = uuid()
export const invoicePaymentConfirmationIdSchema = uuid()
export const invoiceSyncJobIdSchema = uuid()
export const invoiceProgressJobIdSchema = uuid()
export const invoiceTenantIdSchema = uuid()
export const invoiceOrganizationIdSchema = uuid()

export const invoiceTrustedScopeSchema = z.object({
  organizationId: invoiceOrganizationIdSchema,
  tenantId: invoiceTenantIdSchema,
})

export const invoicePageSchema = z.coerce.number().int().min(1).default(1)
export const invoicePageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(INVOICE_PAGE_SIZE_MAX)
  .default(INVOICE_PAGE_SIZE_DEFAULT)
export const invoicePartnerPageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(INVOICE_PAGE_SIZE_MAX)
  .default(INVOICE_PARTNER_PAGE_SIZE_DEFAULT)

export const invoiceSearchSchema = z.string().trim().max(200).optional()
export const invoiceDateSchema = z.coerce.date()
export const invoiceDateStringSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)
export const invoiceDateRangeSchema = z.object({
  fromDate: invoiceDateSchema,
  toDate: invoiceDateSchema,
})

export const invoiceMoneySchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,14}(\.\d{1,4})?$/)
export const invoicePositiveMoneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/)
export const invoiceNonNegativeMoneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/)
export const invoicePercentSchema = z.coerce
  .number()
  .min(INVOICE_INSTALLMENT_INTEREST_RATE_MIN)
  .max(INVOICE_INSTALLMENT_INTEREST_RATE_MAX)

export const invoiceTaxCodeSchema = z.string().trim().min(1).max(80)
export const invoiceCountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/)
export const invoiceCompanyNameSchema = z.string().trim().min(1).max(300)
export const invoiceNumberSchema = z.string().trim().min(1).max(120)
export const invoiceSymbolSchema = nullableTrimmedString(120)
export const invoiceCodeSchema = nullableTrimmedString(120)
export const invoiceSourceInvoiceIdSchema = z.string().trim().min(1).max(191)
export const invoiceProviderSchema = z.string().trim().min(1).max(80)
export const invoiceIdempotencyKeySchema = z.string().trim().min(1).max(191)
export const invoiceEmailSchema = z.string().trim().email().max(320)
export const invoiceCompanyLookupCountrySchema = invoiceCountryCodeSchema
export const invoiceCompanyLookupIdentifierSchema = z.string().trim().min(1).max(80)

export const invoiceDueDaysSchema = z.coerce.number().int().min(0).max(INVOICE_MAX_DUE_DAYS)
export const invoiceClearableDueDaysSchema = invoiceDueDaysSchema.nullable()
export const invoicePartnerDefaultDueDaysSchema = z.coerce.number().int().min(1).max(INVOICE_MAX_DUE_DAYS)
export const invoiceClearablePartnerDefaultDueDaysSchema = invoicePartnerDefaultDueDaysSchema.nullable()
export const invoicePartnerTermsUpdateSchema = z.object({
  defaultDueDays: invoiceClearablePartnerDefaultDueDaysSchema,
}).strict()
export const invoicePartnerListQuerySchema = z.object({
  page: invoicePageSchema,
  pageSize: invoicePartnerPageSizeSchema,
  search: invoiceSearchSchema,
})
export const invoiceListQuerySchema = z.object({
  page: invoicePageSchema,
  pageSize: invoicePageSizeSchema,
  direction: invoiceDirectionSchema.optional(),
  status: invoiceStatusSchema.optional(),
  settlement: invoiceSettlementFilterSchema.optional(),
  recoverability: invoiceRecoverabilityFilterSchema.default('all'),
  partnerId: invoiceCompanyIdSchema.optional(),
  fromDate: invoiceDateSchema.optional(),
  toDate: invoiceDateSchema.optional(),
  search: invoiceSearchSchema,
  sortField: invoiceSortFieldSchema.default('invoiceDate'),
  sortDir: invoiceSortDirectionSchema.default('desc'),
})
const invoiceManualOptionalMoneySchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}, invoiceNonNegativeMoneySchema.optional())
const invoiceManualNullableDateSchema = z.preprocess((value) => {
  if (value === null) return null
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}, invoiceDateSchema.nullable().optional())
export const invoiceManualLineItemInputSchema = z.object({
  name: z.string().trim().min(1).max(500),
  unit: nullableTrimmedString(80),
  quantity: invoiceNonNegativeMoneySchema,
  unitPrice: invoiceNonNegativeMoneySchema,
  discountAmount: invoiceManualOptionalMoneySchema,
  discountPercent: invoicePercentSchema.optional(),
  vatRate: invoicePercentSchema.optional(),
}).strict().superRefine((item, ctx) => {
  if (item.discountAmount !== undefined && item.discountPercent !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discountPercent'],
      message: 'Use discount amount or discount percent, not both',
    })
  }
})
export const invoiceManualWriteSchema = z.object({
  partnerName: invoiceCompanyNameSchema,
  partnerCountryCode: invoiceCountryCodeSchema,
  partnerTaxCode: optionalTrimmedString(invoiceTaxCodeSchema),
  invoiceSymbol: invoiceSymbolSchema,
  invoiceNumber: invoiceNumberSchema,
  invoiceCode: invoiceCodeSchema,
  invoiceDate: invoiceDateSchema,
  dueDate: invoiceManualNullableDateSchema,
  currencyCode: invoiceCurrencyCodeSchema.default('VND'),
  lineItems: z.array(invoiceManualLineItemInputSchema).min(1).max(INVOICE_LINE_ITEMS_MAX),
}).strip().superRefine((input, ctx) => {
  if (input.partnerCountryCode === 'VN') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['partnerCountryCode'],
      message: 'Vietnamese partners are not supported for manual invoices',
    })
  }
})
export const invoiceManualCreateSchema = invoiceManualWriteSchema
export const invoiceManualUpdateSchema = invoiceManualWriteSchema
export const invoicePartnerMatchQuerySchema = z.object({
  taxCode: optionalTrimmedString(invoiceTaxCodeSchema),
  name: optionalTrimmedString(invoiceCompanyNameSchema),
})
export const invoiceCompanyEmailListQuerySchema = z.object({
  companyId: invoiceCompanyIdSchema,
})
export const invoiceCompanyEmailRecordSchema = z.object({
  companyId: invoiceCompanyIdSchema,
  email: invoiceEmailSchema,
}).strict()
export const invoiceCompanyEmailDeleteQuerySchema = z.object({
  companyId: invoiceCompanyIdSchema,
})
export const invoiceAutoPaidTaxCodeIdSchema = uuid()
export const invoiceAutoPaidRuleUpsertSchema = z.object({
  taxCode: invoiceTaxCodeSchema,
}).strict()
export const invoiceAutoPaidRuleRemoveSchema = z.object({
  id: invoiceAutoPaidTaxCodeIdSchema,
}).strict()
export const invoiceAutoPaidReverseSchema = z.object({
  invoiceId: invoiceIdSchema,
}).strict()
export const invoiceAutoPaidCandidateDtoSchema = z.object({
  taxCode: invoiceTaxCodeSchema,
  invoiceCount: z.number().int().nonnegative(),
}).strict()
export const invoiceLineNumberSchema = z.coerce.number().int().min(1).max(INVOICE_LINE_ITEMS_MAX)
export const invoiceInstallmentCountSchema = z.coerce
  .number()
  .int()
  .min(INVOICE_INSTALLMENT_COUNT_MIN)
  .max(INVOICE_INSTALLMENT_COUNT_MAX)
export const invoiceProgressSchema = z.coerce.number().int().min(0).max(100)
export const invoiceNonRecoverableNoteSchema = z.string().trim().max(INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH)
export const invoiceNullableNoteSchema = nullableTrimmedString(INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH)

const invoiceHex64Schema = () =>
  z
    .string()
    .regex(new RegExp(`^[0-9a-f]{${INVOICE_PUBLIC_TOKEN_HEX_LENGTH}}$`))

export const invoicePublicTokenSchema = invoiceHex64Schema().brand<'InvoicePublicToken'>()
export const invoiceTokenHashSchema = invoiceHex64Schema().brand<'InvoiceTokenHash'>()
export type InvoicePublicToken = z.infer<typeof invoicePublicTokenSchema>
export type InvoiceTokenHash = z.infer<typeof invoiceTokenHashSchema>

export function hashInvoicePublicToken(token: InvoicePublicToken): InvoiceTokenHash {
  return invoiceTokenHashSchema.parse(createHash('sha256').update(token).digest('hex'))
}

export const invoiceScopeTaxCodesSchema = z.array(invoiceTaxCodeSchema).max(100)
export const invoiceJsonRecordSchema = z.record(z.string(), z.unknown())

export const invoiceCompanyLookupProviderSchema = z.enum(['vietqr', 'data_gov_sg'])
export const invoiceCompanyLookupCompanySchema = z.object({
  name: invoiceCompanyNameSchema,
  registrationNumber: invoiceCompanyLookupIdentifierSchema,
  taxCode: invoiceTaxCodeSchema.nullable(),
  address: z.string().trim().max(1000).nullable(),
  status: z.string().trim().max(120).nullable(),
  sourceUpdatedAt: z.string().datetime().nullable(),
}).strict()
export const invoiceCompanyLookupResultSchema = z.object({
  mode: z.enum(['registry', 'manual']),
  countryCode: invoiceCompanyLookupCountrySchema,
  identifier: invoiceCompanyLookupIdentifierSchema,
  provider: invoiceCompanyLookupProviderSchema.nullable(),
  fetchedAt: z.string().datetime().nullable(),
  stale: z.boolean(),
  company: invoiceCompanyLookupCompanySchema.nullable(),
}).strict()
export const invoiceCompanyLookupCachePayloadSchema = z.object({
  version: z.literal(1),
  normalized: invoiceCompanyLookupCompanySchema,
  rawProviderResponse: z.unknown(),
  providerFetchedAt: z.string().datetime(),
}).strict()
export const invoiceCompanyLookupRouteQuerySchema = z.object({
  country: invoiceCompanyLookupCountrySchema.default('VN'),
}).strict()

export type InvoiceCompanyLookupProviderKey = z.infer<typeof invoiceCompanyLookupProviderSchema>
export type InvoiceCompanyLookupCompany = z.infer<typeof invoiceCompanyLookupCompanySchema>
export type InvoiceCompanyLookupResult = z.infer<typeof invoiceCompanyLookupResultSchema>
export type InvoiceCompanyLookupCachePayload = z.infer<typeof invoiceCompanyLookupCachePayloadSchema>
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>
export type InvoiceManualWriteInput = z.infer<typeof invoiceManualWriteSchema>
export type InvoiceManualLineItemInput = z.infer<typeof invoiceManualLineItemInputSchema>
