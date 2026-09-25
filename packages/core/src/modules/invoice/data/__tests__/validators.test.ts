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
} from '../entities'
import {
  INVOICE_MAX_DUE_DAYS,
  INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH,
  INVOICE_PAGE_SIZE_MAX,
  INVOICE_PUBLIC_TOKEN_HEX_LENGTH,
  INVOICE_SYNC_MAX_WINDOW_DAYS,
  invoiceCurrencyCodeSchema,
  invoiceDirectionSchema,
  invoiceDueDaysSchema,
  invoicePartnerTermsUpdateSchema,
  hashInvoicePublicToken,
  invoiceNonRecoverableNoteSchema,
  invoicePageSizeSchema,
  invoicePaymentConfirmationStatusSchema,
  invoicePaymentConfirmationRequestSchema,
  invoicePublicTokenSchema,
  invoiceInstallmentStatusSchema,
  invoiceManualLineItemInputSchema,
  invoiceOriginSchema,
  invoiceSettlementStatusSchema,
  invoiceStatusSchema,
  invoiceSyncJobFailureCategorySchema,
  invoiceSyncJobStateSchema,
  invoiceTokenHashSchema,
} from '../validators'

describe('invoice validators', () => {
  it('accepts all persisted enum values from entities', () => {
    for (const value of INVOICE_DIRECTIONS) expect(invoiceDirectionSchema.parse(value)).toBe(value)
    for (const value of INVOICE_STATUSES) expect(invoiceStatusSchema.parse(value)).toBe(value)
    for (const value of INVOICE_ORIGINS) expect(invoiceOriginSchema.parse(value)).toBe(value)
    for (const value of INVOICE_SETTLEMENT_STATUSES) expect(invoiceSettlementStatusSchema.parse(value)).toBe(value)
    for (const value of INVOICE_INSTALLMENT_STATUSES) expect(invoiceInstallmentStatusSchema.parse(value)).toBe(value)
    for (const value of INVOICE_PAYMENT_CONFIRMATION_STATUSES) {
      expect(invoicePaymentConfirmationStatusSchema.parse(value)).toBe(value)
    }
    for (const value of INVOICE_SYNC_JOB_STATES) expect(invoiceSyncJobStateSchema.parse(value)).toBe(value)
    for (const value of INVOICE_SYNC_JOB_FAILURE_CATEGORIES) {
      expect(invoiceSyncJobFailureCategorySchema.parse(value)).toBe(value)
    }
    for (const value of INVOICE_CURRENCY_CODES) expect(invoiceCurrencyCodeSchema.parse(value)).toBe(value)
  })

  it('rejects values outside persisted enum contracts', () => {
    expect(invoiceDirectionSchema.safeParse('SALES').success).toBe(false)
    expect(invoiceStatusSchema.safeParse('VOID').success).toBe(false)
    expect(invoiceOriginSchema.safeParse('IMPORT').success).toBe(false)
    expect(invoiceSettlementStatusSchema.safeParse('PAID').success).toBe(false)
    expect(invoiceInstallmentStatusSchema.safeParse('FAILED').success).toBe(false)
    expect(invoicePaymentConfirmationStatusSchema.safeParse('EXPIRED').success).toBe(false)
    expect(invoiceSyncJobStateSchema.safeParse('RUNNING').success).toBe(false)
    expect(invoiceSyncJobFailureCategorySchema.safeParse('TIMEOUT').success).toBe(false)
    expect(invoiceCurrencyCodeSchema.safeParse('CAD').success).toBe(false)
  })

  it('keeps common primitive limits aligned with invoice docs', () => {
    expect(INVOICE_PAGE_SIZE_MAX).toBe(100)
    expect(INVOICE_MAX_DUE_DAYS).toBe(3650)
    expect(INVOICE_PUBLIC_TOKEN_HEX_LENGTH).toBe(64)
    expect(INVOICE_NON_RECOVERABLE_NOTE_MAX_LENGTH).toBe(1000)
    expect(INVOICE_SYNC_MAX_WINDOW_DAYS).toBe(1825)

    expect(invoicePageSizeSchema.parse('100')).toBe(100)
    expect(invoicePageSizeSchema.safeParse(101).success).toBe(false)
    expect(invoiceDueDaysSchema.parse('3650')).toBe(3650)
    expect(invoiceDueDaysSchema.safeParse(3651).success).toBe(false)
    expect(invoicePartnerTermsUpdateSchema.parse({ defaultDueDays: '1' })).toEqual({ defaultDueDays: 1 })
    expect(invoicePartnerTermsUpdateSchema.parse({ defaultDueDays: null })).toEqual({ defaultDueDays: null })
    expect(invoicePartnerTermsUpdateSchema.safeParse({ defaultDueDays: 0 }).success).toBe(false)
    expect(invoicePartnerTermsUpdateSchema.safeParse({ defaultDueDays: 3651 }).success).toBe(false)
    expect(invoicePublicTokenSchema.parse('a'.repeat(64))).toBe('a'.repeat(64))
    expect(invoicePublicTokenSchema.safeParse('A'.repeat(64)).success).toBe(false)
    expect(invoicePublicTokenSchema.safeParse('a'.repeat(63)).success).toBe(false)
    expect(invoiceNonRecoverableNoteSchema.parse('x'.repeat(1000))).toBe('x'.repeat(1000))
    expect(invoiceNonRecoverableNoteSchema.safeParse('x'.repeat(1001)).success).toBe(false)
  })

  it('keeps public tokens and token hashes as separate semantic types', () => {
    const rawToken = invoicePublicTokenSchema.parse('a'.repeat(64))
    const tokenHash = hashInvoicePublicToken(rawToken)

    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(tokenHash).not.toBe(rawToken)
    expect(invoiceTokenHashSchema.parse(tokenHash)).toBe(tokenHash)
    expect(invoiceTokenHashSchema.safeParse('A'.repeat(64)).success).toBe(false)
    expect(invoiceTokenHashSchema.safeParse('a'.repeat(63)).success).toBe(false)
  })

  it('validates payment confirmation request inputs without accepting scope fields', () => {
    const invoiceId = '11111111-1111-4111-8111-111111111111'
    const installmentId = '22222222-2222-4222-8222-222222222222'

    expect(invoicePaymentConfirmationRequestSchema.parse({
      invoiceId,
      recipientEmail: 'supplier@example.com',
      installmentId,
    })).toEqual({ invoiceId, recipientEmail: 'supplier@example.com', installmentId })
    expect(invoicePaymentConfirmationRequestSchema.safeParse({
      invoiceId,
      recipientEmail: 'invalid-email',
    }).success).toBe(false)
    expect(invoicePaymentConfirmationRequestSchema.safeParse({
      invoiceId,
      recipientEmail: 'supplier@example.com',
      tenantId: 'forged-tenant',
    }).success).toBe(false)
  })

  it('allows zero and positive decimals but rejects negative VAT and discounts', () => {
    const baseLine = { name: 'Line', quantity: '1', unitPrice: '10' }

    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, vatRate: '0' }).success).toBe(true)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, vatRate: '12.5' }).success).toBe(true)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, vatRate: '-1' }).success).toBe(false)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, vatRate: '101' }).success).toBe(false)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, vatRate: 'abc' }).success).toBe(false)

    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, discountPercent: '0' }).success).toBe(true)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, discountPercent: '12.5' }).success).toBe(true)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, discountPercent: '-1' }).success).toBe(false)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, discountPercent: '101' }).success).toBe(false)

    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, discountAmount: '0' }).success).toBe(true)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, discountAmount: '12.5' }).success).toBe(true)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, discountAmount: '-1' }).success).toBe(false)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, discountAmount: 'abc' }).success).toBe(false)
  })

  it('validates required line-item values and their limits', () => {
    const baseLine = { name: 'Line', quantity: '1', unitPrice: '10' }

    expect(invoiceManualLineItemInputSchema.safeParse(baseLine).success).toBe(true)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, name: '' }).success).toBe(false)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, unit: 'x'.repeat(80) }).success).toBe(true)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, unit: 'x'.repeat(81) }).success).toBe(false)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, quantity: '0' }).success).toBe(false)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, quantity: '-1' }).success).toBe(false)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, unitPrice: '0' }).success).toBe(false)
    expect(invoiceManualLineItemInputSchema.safeParse({ ...baseLine, unitPrice: '-1' }).success).toBe(false)
  })
})
