import { Collection } from '@mikro-orm/core'
import { Check, Entity, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export const INVOICE_DIRECTIONS = ['AR', 'AP'] as const
export type InvoiceDirection = (typeof INVOICE_DIRECTIONS)[number]

export const INVOICE_STATUSES = ['ACTIVE', 'CANCELLED', 'REPLACEMENT', 'ADJUSTMENT', 'REPLACED', 'ADJUSTED'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_ORIGINS = ['GOVERNMENT_PORTAL', 'MANUAL'] as const
export type InvoiceOrigin = (typeof INVOICE_ORIGINS)[number]

export const INVOICE_SETTLEMENT_STATUSES = ['UNSETTLED', 'PARTIALLY_PAID', 'SETTLED'] as const
export type InvoiceSettlementStatus = (typeof INVOICE_SETTLEMENT_STATUSES)[number]

export const INVOICE_INSTALLMENT_STATUSES = ['PENDING', 'PAID'] as const
export type InvoiceInstallmentStatus = (typeof INVOICE_INSTALLMENT_STATUSES)[number]

export const INVOICE_PAYMENT_CONFIRMATION_STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED'] as const
export type InvoicePaymentConfirmationStatus = (typeof INVOICE_PAYMENT_CONFIRMATION_STATUSES)[number]

export const INVOICE_SYNC_JOB_STATES = ['QUEUED', 'AUTHENTICATING', 'FETCHING', 'PERSISTING', 'DONE', 'FAILED'] as const
export type InvoiceSyncJobState = (typeof INVOICE_SYNC_JOB_STATES)[number]

export const INVOICE_SYNC_JOB_FAILURE_CATEGORIES = [
  'AUTH_FAILED',
  'ACCOUNT_LOCKED',
  'PORTAL_UNREACHABLE',
  'INTERNAL_ERROR',
] as const
export type InvoiceSyncJobFailureCategory = (typeof INVOICE_SYNC_JOB_FAILURE_CATEGORIES)[number]

export const INVOICE_CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'SGD', 'AUD', 'JPY', 'CNY', 'KRW', 'THB', 'VND'] as const
export type InvoiceCurrencyCode = (typeof INVOICE_CURRENCY_CODES)[number]

@Entity({ tableName: 'invoice_companies' })
@Index({ name: 'invoice_companies_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'invoice_companies_name_idx', properties: ['organizationId', 'tenantId', 'name'] })
@Unique({ name: 'invoice_companies_tax_code_scope_unique', properties: ['organizationId', 'tenantId', 'taxCode'] })
@Check({
  name: 'invoice_companies_default_due_days_check',
  expression: `"default_due_days" is null or ("default_due_days" >= 0 and "default_due_days" <= 3650)`,
})
export class InvoiceCompany {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'tax_code', type: 'text' })
  taxCode!: string

  @Property({ name: 'country_code', type: 'text', default: 'VN' })
  countryCode: string = 'VN'

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'default_due_days', type: 'integer', nullable: true, default: 30 })
  defaultDueDays?: number | null = 30

  @Property({ name: 'name_source_date', type: Date, nullable: true })
  nameSourceDate?: Date | null

  @Property({ name: 'search_text', type: 'text', default: '' })
  searchText: string = ''

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => Invoice, (invoice) => invoice.company)
  invoices = new Collection<Invoice>(this)

  @OneToMany(() => InvoiceCompanyEmail, (email) => email.company)
  emails = new Collection<InvoiceCompanyEmail>(this)
}

@Entity({ tableName: 'invoice_company_emails' })
@Index({ name: 'invoice_company_emails_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'invoice_company_emails_company_idx', properties: ['company'] })
@Unique({ name: 'invoice_company_emails_company_email_unique', properties: ['company', 'email'] })
export class InvoiceCompanyEmail {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => InvoiceCompany, { fieldName: 'company_id', deleteRule: 'cascade' })
  company!: InvoiceCompany

  @Property({ type: 'text' })
  email!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'invoice_auto_paid_tax_codes' })
@Index({ name: 'invoice_auto_paid_tax_codes_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'invoice_auto_paid_tax_codes_tax_code_scope_unique',
  properties: ['organizationId', 'tenantId', 'taxCode'],
})
export class InvoiceAutoPaidTaxCode {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'tax_code', type: 'text' })
  taxCode!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'invoice_invoices' })
@Index({ name: 'invoice_invoices_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'invoice_invoices_direction_idx', properties: ['organizationId', 'tenantId', 'direction'] })
@Index({ name: 'invoice_invoices_company_idx', properties: ['company', 'organizationId', 'tenantId'] })
@Index({ name: 'invoice_invoices_date_idx', properties: ['organizationId', 'tenantId', 'invoiceDate', 'id'] })
@Index({
  name: 'invoice_invoices_settlement_idx',
  properties: ['organizationId', 'tenantId', 'settlementStatus', 'invoiceDate'],
})
@Index({ name: 'invoice_invoices_due_date_idx', properties: ['organizationId', 'tenantId', 'dueDate'] })
@Index({ name: 'invoice_invoices_next_due_date_idx', properties: ['organizationId', 'tenantId', 'nextDueDate'] })
@Unique({ name: 'invoice_invoices_source_scope_unique', properties: ['organizationId', 'tenantId', 'sourceInvoiceId'] })
@Unique({ name: 'invoice_invoices_email_tracking_hash_unique', properties: ['emailTrackingTokenHash'] })
@Check({ name: 'invoice_invoices_origin_check', expression: `"origin" in ('GOVERNMENT_PORTAL', 'MANUAL')` })
@Check({ name: 'invoice_invoices_direction_check', expression: `"direction" in ('AR', 'AP')` })
@Check({
  name: 'invoice_invoices_invoice_status_check',
  expression: `"invoice_status" in ('ACTIVE', 'CANCELLED', 'REPLACEMENT', 'ADJUSTMENT', 'REPLACED', 'ADJUSTED')`,
})
@Check({
  name: 'invoice_invoices_settlement_status_check',
  expression: `"settlement_status" in ('UNSETTLED', 'PARTIALLY_PAID', 'SETTLED')`,
})
@Check({
  name: 'invoice_invoices_currency_code_check',
  expression: `"currency_code" in ('USD', 'EUR', 'GBP', 'SGD', 'AUD', 'JPY', 'CNY', 'KRW', 'THB', 'VND')`,
})
@Check({
  name: 'invoice_invoices_email_tracking_hash_check',
  expression: `"email_tracking_token_hash" is null or "email_tracking_token_hash" ~ '^[0-9a-f]{64}$'`,
})
export class Invoice {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'source_invoice_id', type: 'text' })
  sourceInvoiceId!: string

  @Property({ type: 'text', default: 'GOVERNMENT_PORTAL' })
  origin: InvoiceOrigin = 'GOVERNMENT_PORTAL'

  @Property({ type: 'text' })
  direction!: InvoiceDirection

  @ManyToOne(() => InvoiceCompany, { fieldName: 'company_id', deleteRule: 'restrict' })
  company!: InvoiceCompany

  @Property({ name: 'seller_tax_code', type: 'text', nullable: true })
  sellerTaxCode?: string | null

  @Property({ name: 'seller_name', type: 'text' })
  sellerName!: string

  @Property({ name: 'buyer_tax_code', type: 'text', nullable: true })
  buyerTaxCode?: string | null

  @Property({ name: 'buyer_name', type: 'text' })
  buyerName!: string

  @Property({ name: 'invoice_symbol', type: 'text', nullable: true })
  invoiceSymbol?: string | null

  @Property({ name: 'invoice_number', type: 'text' })
  invoiceNumber!: string

  @Property({ name: 'invoice_code', type: 'text', nullable: true })
  invoiceCode?: string | null

  @Property({ name: 'invoice_date', type: Date })
  invoiceDate!: Date

  @Property({ name: 'due_date', type: Date, nullable: true })
  dueDate?: Date | null

  @Property({ name: 'due_date_source', type: 'text', nullable: true })
  dueDateSource?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'VND' })
  currencyCode: InvoiceCurrencyCode = 'VND'

  @Property({ name: 'invoice_status', type: 'text', default: 'ACTIVE' })
  invoiceStatus: InvoiceStatus = 'ACTIVE'

  @Property({ name: 'net_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  netAmount?: string | null

  @Property({ name: 'vat_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  vatAmount?: string | null

  @Property({ name: 'gross_amount', type: 'numeric', precision: 18, scale: 4 })
  grossAmount!: string

  @Property({ name: 'has_received', type: 'boolean', default: false })
  hasReceived: boolean = false

  @Property({ name: 'has_paid', type: 'boolean', default: false })
  hasPaid: boolean = false

  @Property({ name: 'settlement_status', type: 'text', default: 'UNSETTLED' })
  settlementStatus: InvoiceSettlementStatus = 'UNSETTLED'

  @Property({ name: 'paid_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  paidAmount: string = '0'

  @Property({ name: 'outstanding_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  outstandingAmount: string = '0'

  @Property({ name: 'next_due_date', type: Date, nullable: true })
  nextDueDate?: Date | null

  @Property({ name: 'has_installment_plan', type: 'boolean', default: false })
  hasInstallmentPlan: boolean = false

  @Property({ name: 'non_recoverable', type: 'boolean', default: false })
  nonRecoverable: boolean = false

  @Property({ name: 'non_recoverable_note', type: 'text', nullable: true })
  nonRecoverableNote?: string | null

  @Property({ name: 'non_recoverable_at', type: Date, nullable: true })
  nonRecoverableAt?: Date | null

  @Property({ name: 'last_sent_at', type: Date, nullable: true })
  lastSentAt?: Date | null

  @Property({ name: 'email_tracking_token_hash', type: 'text', nullable: true })
  emailTrackingTokenHash?: string | null

  @Property({ name: 'opened_at', type: Date, nullable: true })
  openedAt?: Date | null

  @Property({ name: 'auto_settled', type: 'boolean', default: false })
  autoSettled: boolean = false

  @Property({ name: 'auto_pay_excluded', type: 'boolean', default: false })
  autoPayExcluded: boolean = false

  @Property({ name: 'search_text', type: 'text', default: '' })
  searchText: string = ''

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => InvoiceLineItem, (lineItem) => lineItem.invoice)
  lineItems = new Collection<InvoiceLineItem>(this)

  @OneToMany(() => InvoiceInstallment, (installment) => installment.invoice)
  installments = new Collection<InvoiceInstallment>(this)

  @OneToMany(() => InvoicePaymentConfirmation, (confirmation) => confirmation.invoice)
  paymentConfirmations = new Collection<InvoicePaymentConfirmation>(this)
}

@Entity({ tableName: 'invoice_invoice_line_items' })
@Index({ name: 'invoice_invoice_line_items_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'invoice_invoice_line_items_invoice_idx', properties: ['invoice'] })
@Unique({ name: 'invoice_invoice_line_items_invoice_line_unique', properties: ['invoice', 'lineNumber'] })
export class InvoiceLineItem {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Invoice, { fieldName: 'invoice_id', deleteRule: 'cascade' })
  invoice!: Invoice

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  unit?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  quantity?: string | null

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 4, nullable: true })
  unitPrice?: string | null

  @Property({ name: 'discount_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  discountAmount?: string | null

  @Property({ name: 'discount_percent', type: 'numeric', precision: 7, scale: 4, nullable: true })
  discountPercent?: string | null

  @Property({ name: 'vat_rate', type: 'numeric', precision: 7, scale: 4, nullable: true })
  vatRate?: string | null

  @Property({ name: 'vat_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  vatAmount?: string | null

  @Property({ name: 'line_total', type: 'numeric', precision: 18, scale: 4 })
  lineTotal!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'invoice_installments' })
@Index({ name: 'invoice_installments_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'invoice_installments_invoice_idx', properties: ['invoice'] })
@Index({ name: 'invoice_installments_due_date_idx', properties: ['organizationId', 'tenantId', 'dueDate'] })
@Unique({ name: 'invoice_installments_invoice_sequence_unique', properties: ['invoice', 'sequence'] })
@Check({ name: 'invoice_installments_status_check', expression: `"status" in ('PENDING', 'PAID')` })
@Check({
  name: 'invoice_installments_interest_rate_check',
  expression: `"interest_rate" >= 0 and "interest_rate" <= 100`,
})
export class InvoiceInstallment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Invoice, { fieldName: 'invoice_id', deleteRule: 'cascade' })
  invoice!: Invoice

  @Property({ type: 'integer' })
  sequence!: number

  @Property({ name: 'principal_amount', type: 'numeric', precision: 18, scale: 4 })
  principalAmount!: string

  @Property({ name: 'interest_rate', type: 'numeric', precision: 7, scale: 4, default: '0' })
  interestRate: string = '0'

  @Property({ name: 'interest_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  interestAmount: string = '0'

  @Property({ name: 'total_amount', type: 'numeric', precision: 18, scale: 4 })
  totalAmount!: string

  @Property({ name: 'due_date', type: Date })
  dueDate!: Date

  @Property({ type: 'text', default: 'PENDING' })
  status: InvoiceInstallmentStatus = 'PENDING'

  @Property({ name: 'paid_at', type: Date, nullable: true })
  paidAt?: Date | null

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => InvoicePaymentConfirmation, (confirmation) => confirmation.installment)
  paymentConfirmations = new Collection<InvoicePaymentConfirmation>(this)
}

@Entity({ tableName: 'invoice_payment_confirmations' })
@Index({ name: 'invoice_payment_confirmations_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'invoice_payment_confirmations_invoice_idx', properties: ['invoice'] })
@Index({ name: 'invoice_payment_confirmations_installment_idx', properties: ['installment'] })
@Unique({ name: 'invoice_payment_confirmations_token_hash_unique', properties: ['tokenHash'] })
@Check({
  name: 'invoice_payment_confirmations_status_check',
  expression: `"status" in ('PENDING', 'CONFIRMED', 'REJECTED')`,
})
@Check({ name: 'invoice_payment_confirmations_token_hash_check', expression: `"token_hash" ~ '^[0-9a-f]{64}$'` })
export class InvoicePaymentConfirmation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Invoice, { fieldName: 'invoice_id', deleteRule: 'cascade' })
  invoice!: Invoice

  @ManyToOne(() => InvoiceInstallment, { fieldName: 'installment_id', nullable: true, deleteRule: 'cascade' })
  installment?: InvoiceInstallment | null

  @Property({ name: 'recipient_email', type: 'text' })
  recipientEmail!: string

  @Property({ name: 'token_hash', type: 'text' })
  tokenHash!: string

  @Property({ type: 'text', default: 'PENDING' })
  status: InvoicePaymentConfirmationStatus = 'PENDING'

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'confirmed_at', type: Date, nullable: true })
  confirmedAt?: Date | null

  @Property({ name: 'rejected_at', type: Date, nullable: true })
  rejectedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'invoice_sync_jobs' })
@Index({ name: 'invoice_sync_jobs_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'invoice_sync_jobs_state_idx', properties: ['organizationId', 'tenantId', 'state'] })
@Index({ name: 'invoice_sync_jobs_started_at_idx', properties: ['organizationId', 'tenantId', 'startedAt'] })
@Unique({ name: 'invoice_sync_jobs_idempotency_scope_unique', properties: ['organizationId', 'tenantId', 'idempotencyKey'] })
@Check({
  name: 'invoice_sync_jobs_state_check',
  expression: `"state" in ('QUEUED', 'AUTHENTICATING', 'FETCHING', 'PERSISTING', 'DONE', 'FAILED')`,
})
@Check({
  name: 'invoice_sync_jobs_failure_category_check',
  expression: `"failure_category" is null or "failure_category" in ('AUTH_FAILED', 'ACCOUNT_LOCKED', 'PORTAL_UNREACHABLE', 'INTERNAL_ERROR')`,
})
@Check({ name: 'invoice_sync_jobs_progress_check', expression: `"progress" >= 0 and "progress" <= 100` })
export class InvoiceSyncJob {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'from_date', type: Date })
  fromDate!: Date

  @Property({ name: 'to_date', type: Date })
  toDate!: Date

  @Property({ name: 'scope_tax_codes', type: 'jsonb', default: [] })
  scopeTaxCodes: string[] = []

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'started_by_user_id', type: 'uuid', nullable: true })
  startedByUserId?: string | null

  @Property({ type: 'text', default: 'QUEUED' })
  state: InvoiceSyncJobState = 'QUEUED'

  @Property({ type: 'integer', default: 0 })
  progress: number = 0

  @Property({ name: 'progress_job_id', type: 'uuid', nullable: true })
  progressJobId?: string | null

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  counts: Record<string, unknown> = {}

  @Property({ name: 'failure_category', type: 'text', nullable: true })
  failureCategory?: InvoiceSyncJobFailureCategory | null

  @Property({ name: 'failure_message', type: 'text', nullable: true })
  failureMessage?: string | null

  @Property({ name: 'started_at', type: Date, onCreate: () => new Date() })
  startedAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null
}

@Entity({ tableName: 'invoice_company_registry' })
@Index({ name: 'invoice_company_registry_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'invoice_company_registry_fetched_at_idx', properties: ['organizationId', 'tenantId', 'fetchedAt'] })
@Unique({
  name: 'invoice_company_registry_lookup_unique',
  properties: ['organizationId', 'tenantId', 'countryCode', 'provider', 'identifier'],
})
export class InvoiceCompanyRegistry {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'country_code', type: 'text' })
  countryCode!: string

  @Property({ type: 'text' })
  identifier!: string

  @Property({ type: 'text' })
  provider!: string

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>

  @Property({ name: 'fetched_at', type: Date })
  fetchedAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
