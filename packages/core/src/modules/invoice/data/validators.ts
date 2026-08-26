import { z } from 'zod'

import {
  INVOICE_CURRENCY_CODES,
  INVOICE_DIRECTIONS,
  INVOICE_INSTALLMENT_STATUSES,
  INVOICE_ORIGINS,
  INVOICE_PAYMENT_CONFIRMATION_STATUSES,
  INVOICE_SETTLEMENT_STATUSES,
  INVOICE_STATUSES,
  INVOICE_SYNC_JOB_FAILURE_CATEGORIES,
  INVOICE_SYNC_JOB_STATES,
} from './entities'

export const INVOICE_PAGE_SIZE_DEFAULT = 20
export const INVOICE_PAGE_SIZE_MAX = 100
export const INVOICE_PARTNER_PAGE_SIZE_DEFAULT = 20
export const INVOICE_LINE_ITEMS_MAX = 100
export const INVOICE_MANUAL_ISSUE_DATE_MIN = '2000-01-01'
export const INVOICE_MAX_DUE_DAYS = 3650
export const INVOICE_MANUAL_FORM_DEFAULT_DUE_DAYS = 45
export const INVOICE_PARTNER_DEFAULT_DUE_DAYS = 30
export const INVOICE_PAYMENT_CONFIRMATION_TOKEN_BYTES = 32
export const INVOICE_PUBLIC_TOKEN_HEX_LENGTH = 64
export const INVOICE_PAYMENT_CONFIRMATION_TTL_DAYS = 14
export const INVOICE_INSTALLMENT_COUNT_MIN = 2
export const INVOICE_INSTALLMENT_COUNT_MAX = 60
export const INVOICE_INSTALLMENT_INTEREST_RATE_MIN = 0
export const INVOICE_INSTALLMENT_INTEREST_RATE_MAX = 100
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

const uuid = () => z.string().uuid()
const nullableTrimmedString = (max: number) => z.string().trim().max(max).nullable().optional()

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

export const invoiceIdSchema = uuid()
export const invoiceCompanyIdSchema = uuid()
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

export const invoiceDueDaysSchema = z.coerce.number().int().min(0).max(INVOICE_MAX_DUE_DAYS)
export const invoiceClearableDueDaysSchema = invoiceDueDaysSchema.nullable()
export const invoiceLineNumberSchema = z.coerce.number().int().min(1).max(INVOICE_LINE_ITEMS_MAX)
export const invoiceInstallmentCountSchema = z.coerce
  .number()
  .int()
  .min(INVOICE_INSTALLMENT_COUNT_MIN)
  .max(INVOICE_INSTALLMENT_COUNT_MAX)
export const invoiceProgressSchema = z.coerce.number().int().min(0).max(100)
export const invoiceNonRecoverableNoteSchema = z.string().trim().max(INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH)
export const invoiceNullableNoteSchema = nullableTrimmedString(INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH)

export const invoicePublicTokenSchema = z
  .string()
  .regex(new RegExp(`^[0-9a-f]{${INVOICE_PUBLIC_TOKEN_HEX_LENGTH}}$`))
export const invoiceTokenHashSchema = invoicePublicTokenSchema
export const invoiceScopeTaxCodesSchema = z.array(invoiceTaxCodeSchema).max(100)
export const invoiceJsonRecordSchema = z.record(z.string(), z.unknown())
