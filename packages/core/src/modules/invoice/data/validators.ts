import { createHash } from 'node:crypto'
import { z } from 'zod'
import { emailSchema, moneyDecimalStringSchema } from '@open-mercato/shared/lib/validation'

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
export const INVOICE_EMAIL_TRACKING_TOKEN_BYTES = 32
export const INVOICE_PAYMENT_CONFIRMATION_TTL_DAYS = 7
export const INVOICE_INSTALLMENT_COUNT_MIN = 2
export const INVOICE_INSTALLMENT_COUNT_MAX = 60
export const INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH = 1000
export const invoiceNonRecoverableNoteSchema = z.string().trim().max(INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH)
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
export const INVOICE_PAYMENT_CONFIRMATION_PUBLIC_RATE_LIMIT_REQUESTS = 60
export const INVOICE_PAYMENT_CONFIRMATION_PUBLIC_RATE_LIMIT_WINDOW_SECONDS = 60

const uuid = () => z.string().uuid()
const nullableTrimmedString = (max: number) => z.string().trim().max(max).nullable().optional()
const optionalTrimmedString = (schema: z.ZodString) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }, schema.optional())
const nullableOptionalTrimmedString = (schema: z.ZodString) =>
  z.preprocess((value) => value === null ? undefined : value, optionalTrimmedString(schema))

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

/** Amounts stay decimal strings so the 4-dp arithmetic never round-trips through a JS number. */
export const invoiceMoneySchema = moneyDecimalStringSchema({ signed: true })
export const invoicePositiveMoneySchema = moneyDecimalStringSchema()
export const invoiceNonNegativeMoneySchema = invoicePositiveMoneySchema
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
export const invoiceEmailSchema = emailSchema()
export const invoiceSendSchema = z.object({
  email: invoiceEmailSchema,
}).strict()
export type InvoiceSendInput = z.infer<typeof invoiceSendSchema>
export const invoicePaymentConfirmationRequestSchema = z.object({
  invoiceId: invoiceIdSchema,
  recipientEmail: invoiceEmailSchema,
  installmentId: invoiceInstallmentIdSchema.optional(),
}).strict()
export type InvoicePaymentConfirmationRequestInput = z.infer<typeof invoicePaymentConfirmationRequestSchema>
export const invoiceIncomingPaymentConfirmationSchema = z.object({
  invoiceId: invoiceIdSchema,
}).strict()
export type InvoiceIncomingPaymentConfirmationInput = z.infer<typeof invoiceIncomingPaymentConfirmationSchema>
export const invoicePaymentConfirmationPublicPreviewSchema = z.object({
  status: invoicePaymentConfirmationStatusSchema,
  expiresAt: z.string().datetime(),
  payerName: z.string().nullable(),
  payeeName: z.string().nullable(),
  invoice: z.object({
    symbol: z.string().nullable(),
    number: invoiceNumberSchema,
    amount: invoiceMoneySchema,
    currencyCode: invoiceCurrencyCodeSchema,
  }).strict(),
  installment: z.object({
    sequence: z.number().int(),
    amount: invoiceMoneySchema,
    dueDate: z.string().datetime(),
  }).strict().nullable(),
}).strict()
export type InvoicePaymentConfirmationPublicPreview = z.infer<typeof invoicePaymentConfirmationPublicPreviewSchema>
export const invoicePaymentConfirmationPublicTransitionSchema = z.object({
  status: invoicePaymentConfirmationStatusSchema,
}).strict()
export type InvoicePaymentConfirmationPublicTransition = z.infer<typeof invoicePaymentConfirmationPublicTransitionSchema>
export const invoiceCompanyLookupCountrySchema = invoiceCountryCodeSchema
export const invoiceCompanyLookupIdentifierSchema = z.string().trim().min(1).max(80)

const singaporeRobWeights = [10, 4, 9, 3, 8, 2, 7, 1]
const singaporeRobAlphabet = 'XMKECAWLJDB'
const singaporeRocWeights = [10, 8, 6, 4, 9, 7, 5, 3, 1]
const singaporeRocAlphabet = 'ZKCMDNERGWH'
const singaporeOtherWeights = [4, 3, 5, 3, 10, 2, 2, 5, 7]
const singaporeOtherAlphabet = 'ABCDEFGHJKLMNPQRSTUVWX0123456789'
const singaporeOtherEntityTypes = new Set([
  'CC', 'CD', 'CH', 'CL', 'CM', 'CP', 'CS', 'CX', 'DP', 'FB', 'FC', 'FM', 'FN',
  'GA', 'GB', 'GS', 'HS', 'LL', 'LP', 'MB', 'MC', 'MD', 'MH', 'MM', 'MQ', 'NB',
  'NR', 'PA', 'PB', 'PF', 'RF', 'RP', 'SM', 'SS', 'TC', 'TU', 'VH', 'XL',
])

export function normalizeSingaporeUen(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase()
}

function singaporeCheckCharacter(
  value: string,
  weights: readonly number[],
  alphabet: string,
): string {
  const sum = weights.reduce((total, weight, index) => total + weight * Number(value.charAt(index)), 0)
  return alphabet.charAt(sum % 11)
}

function singaporeOtherCheckCharacter(value: string): string {
  const sum = singaporeOtherWeights.reduce((total, weight, index) => {
    const position = singaporeOtherAlphabet.indexOf(value.charAt(index))
    return position < 0 ? Number.NaN : total + weight * position
  }, 0)
  if (Number.isNaN(sum)) return ''
  return singaporeOtherAlphabet.charAt((((sum - 5) % 11) + 11) % 11)
}

export function isValidSingaporeUen(value: string, currentYear = new Date().getFullYear()): boolean {
  const uen = normalizeSingaporeUen(value)
  if (uen.length === 9) {
    return /^\d{8}$/.test(uen.slice(0, 8)) && uen.charAt(8) === singaporeCheckCharacter(uen, singaporeRobWeights, singaporeRobAlphabet)
  }
  if (uen.length !== 10) return false

  if (/^\d{9}$/.test(uen.slice(0, 9))) {
    return Number(uen.slice(0, 4)) <= currentYear && uen.charAt(9) === singaporeCheckCharacter(uen, singaporeRocWeights, singaporeRocAlphabet)
  }

  if (!/^\d{2}$/.test(uen.slice(1, 3)) || !'RST'.includes(uen.charAt(0))) return false
  if (uen.charAt(0) === 'T' && Number(uen.slice(1, 3)) > currentYear % 100) return false
  if (!singaporeOtherEntityTypes.has(uen.slice(3, 5)) || !/^\d{4}$/.test(uen.slice(5, 9))) return false
  return uen.charAt(9) === singaporeOtherCheckCharacter(uen)
}

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
const invoiceManualPositiveMoneySchema = moneyDecimalStringSchema({
  message: 'invoice.form.validation.positiveNumber',
}).refine((value) => Number(value) > 0, 'invoice.form.validation.positiveNumber')
const invoiceManualNonNegativeMoneySchema = moneyDecimalStringSchema({
  message: 'invoice.form.validation.nonNegativeNumber',
})
const invoiceManualPercentSchema = z.coerce
  .number({ error: 'invoice.form.validation.number' })
  .min(INVOICE_INSTALLMENT_INTEREST_RATE_MIN, 'invoice.form.validation.percentageRange')
  .max(INVOICE_INSTALLMENT_INTEREST_RATE_MAX, 'invoice.form.validation.percentageRange')
const invoiceManualOptionalMoneySchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}, invoiceManualNonNegativeMoneySchema.optional())
const invoiceManualNullableDateSchema = z.preprocess((value) => {
  if (value === null) return null
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}, invoiceDateSchema.nullable().optional())
export const invoiceManualLineItemInputSchema = z.object({
  name: z.string().trim().min(1, 'invoice.form.validation.lineNameRequired').max(500, 'invoice.form.validation.lineNameTooLong'),
  unit: z.string().trim().max(80, 'invoice.form.validation.unitTooLong').nullable().optional(),
  quantity: invoiceManualPositiveMoneySchema,
  unitPrice: invoiceManualPositiveMoneySchema,
  discountAmount: invoiceManualOptionalMoneySchema,
  discountPercent: invoiceManualPercentSchema.optional(),
  vatRate: invoiceManualPercentSchema.optional(),
}).strict().superRefine((item, ctx) => {
  if (item.discountAmount !== undefined && item.discountPercent !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discountPercent'],
      message: 'invoice.form.validation.discountModeExclusive',
    })
  }
})
export const invoiceManualWriteBaseSchema = z.object({
  partnerName: invoiceCompanyNameSchema,
  partnerCountryCode: invoiceCountryCodeSchema,
  partnerTaxCode: nullableOptionalTrimmedString(invoiceTaxCodeSchema),
  invoiceSymbol: invoiceSymbolSchema,
  invoiceNumber: invoiceNumberSchema,
  invoiceCode: invoiceCodeSchema,
  invoiceDate: invoiceDateSchema,
  dueDate: invoiceManualNullableDateSchema,
  currencyCode: invoiceCurrencyCodeSchema.default('VND'),
  lineItems: z.array(invoiceManualLineItemInputSchema)
    .min(1, 'invoice.form.validation.lineRequired')
    .max(INVOICE_LINE_ITEMS_MAX, 'invoice.form.validation.lineLimit'),
}).strip()

const validateManualInvoicePartner = (input: z.infer<typeof invoiceManualWriteBaseSchema>, ctx: z.RefinementCtx) => {
  if (input.partnerCountryCode === 'VN') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['partnerCountryCode'],
      message: 'Vietnamese partners are not supported for manual invoices',
    })
  }
}

export const invoiceManualWriteSchema = invoiceManualWriteBaseSchema.superRefine(validateManualInvoicePartner)
export const invoiceManualCreateSchema = invoiceManualWriteSchema
export const invoiceManualUpdateSchema = invoiceManualWriteSchema
export const invoiceDueDateUpdateSchema = z.object({
  // null clears the due date; ISO date string sets it.
  // Range/order validation requires the invoice row and happens in the service.
  dueDate: invoiceManualNullableDateSchema,
}).strict()
export type InvoiceDueDateUpdateInput = z.infer<typeof invoiceDueDateUpdateSchema>
export const invoiceSettlementUpdateSchema = z.object({
  settled: z.boolean(),
}).strict()
export type InvoiceSettlementUpdateInput = z.infer<typeof invoiceSettlementUpdateSchema>
export const invoiceNullableNoteSchema = nullableTrimmedString(INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH)
export const invoiceInstallmentInputSchema = z.object({
  principalAmount: invoicePositiveMoneySchema,
  interestRate: invoicePercentSchema,
  dueDate: invoiceDateSchema,
  note: invoiceNullableNoteSchema,
}).strict()
export const invoiceInstallmentPlanUpdateSchema = z.object({
  installments: z.array(invoiceInstallmentInputSchema)
    .min(INVOICE_INSTALLMENT_COUNT_MIN)
    .max(INVOICE_INSTALLMENT_COUNT_MAX),
}).strict()
export type InvoiceInstallmentPlanUpdateInput = z.infer<typeof invoiceInstallmentPlanUpdateSchema>
export const invoiceInstallmentStatusUpdateSchema = z.object({
  paid: z.boolean(),
}).strict()
export type InvoiceInstallmentStatusUpdateInput = z.infer<typeof invoiceInstallmentStatusUpdateSchema>
export const invoiceNonRecoverableUpdateSchema = z.object({
  nonRecoverable: z.boolean(),
  note: invoiceNonRecoverableNoteSchema.nullable().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.nonRecoverable && !input.note?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['note'],
      message: 'Non-recoverable note is required',
    })
  }
})
export type InvoiceNonRecoverableUpdateInput = z.infer<typeof invoiceNonRecoverableUpdateSchema>
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

export const invoiceScopeTaxCodesSchema = z.array(invoiceTaxCodeSchema).max(200)
export const invoiceVietnameseTaxCodeSchema = z.string().trim().regex(/^\d{10}(?:-\d{3})?$/)
export const invoiceSyncAcknowledgementsSchema = z.object({
  dueDatesRequireConfiguration: z.literal(true),
  settlementIsManual: z.literal(true),
}).strict()
export const invoiceSyncStartSchema = z.object({
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9_-]{8,80}$/),
  fromDate: invoiceDateStringSchema,
  toDate: invoiceDateStringSchema,
  scopeTaxCodes: invoiceScopeTaxCodesSchema.default([]),
  acknowledgements: invoiceSyncAcknowledgementsSchema,
}).strict()
export const invoiceSyncAuthenticateSchema = z.object({
  transactionId: uuid(),
  password: z.string().min(1).max(512),
  captchaSolution: z.string().trim().min(1).max(256),
}).strict()
export const invoiceSyncJobStatusSchema = z.object({
  jobId: uuid(), state: invoiceSyncJobStateSchema, progress: z.number().int().min(0).max(100),
  fromDate: z.string().datetime(), toDate: z.string().datetime(), scopeTaxCodes: z.array(invoiceTaxCodeSchema),
  counts: z.object({
    processed: z.number().int().nonnegative(), imported: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }).strict(),
  failureCategory: invoiceSyncJobFailureCategorySchema.nullable(), failureMessage: z.string().nullable(),
  progressJobId: uuid().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable(),
  startedBy: z.object({ id: uuid() }).nullable(),
  failureRequestId: uuid().nullable(),
}).strict()
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
  country: invoiceCompanyLookupCountrySchema.default('SG'),
}).strict()

export type InvoiceCompanyLookupProviderKey = z.infer<typeof invoiceCompanyLookupProviderSchema>
export type InvoiceCompanyLookupCompany = z.infer<typeof invoiceCompanyLookupCompanySchema>
export type InvoiceCompanyLookupResult = z.infer<typeof invoiceCompanyLookupResultSchema>
export type InvoiceCompanyLookupCachePayload = z.infer<typeof invoiceCompanyLookupCachePayloadSchema>
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>
export type InvoiceManualWriteInput = z.infer<typeof invoiceManualWriteSchema>
export type InvoiceManualLineItemInput = z.infer<typeof invoiceManualLineItemInputSchema>

export const invoiceForecastQuerySchema = z.object({
  // A bare calendar day, not a datetime: the forecast buckets on the UTC date and
  // a loose `new Date()` parse silently accepted "2026" and "12/31/2026", and
  // shifted an offset-bearing timestamp into the previous day's bucket.
  throughDate: invoiceDateStringSchema.optional(),
}).strict()
export type InvoiceForecastQueryInput = z.infer<typeof invoiceForecastQuerySchema>

export const invoiceSummaryQuerySchema = z.object({
  throughDate: invoiceDateStringSchema.optional(),
}).strict()
export type InvoiceSummaryQueryInput = z.infer<typeof invoiceSummaryQuerySchema>
