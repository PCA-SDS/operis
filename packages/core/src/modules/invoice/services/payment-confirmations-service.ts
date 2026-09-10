import React from 'react'
import { randomBytes } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { detectLocale, resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getSecurityEmailBaseUrl } from '@open-mercato/shared/lib/url'

import { Invoice, InvoiceInstallment, InvoicePaymentConfirmation } from '../data/entities'
import type { InvoiceScope } from '../data/scope'
import {
  hashInvoicePublicToken,
  INVOICE_PAYMENT_CONFIRMATION_TOKEN_BYTES,
  INVOICE_PAYMENT_CONFIRMATION_TTL_DAYS,
  invoicePaymentConfirmationRequestSchema,
  invoicePublicTokenSchema,
  type InvoicePaymentConfirmationRequestInput,
  type InvoicePublicToken,
  type InvoiceTokenHash,
} from '../data/validators'
import { emitInvoiceEvent } from '../events'
import type { InvoiceCompanyEmailsService } from './company-emails-service'
import { InvoiceScopedPersistenceService } from './scoped-persistence-service'

const logger = createLogger('invoice').child({ component: 'payment-confirmations-service' })

type InvoicePaymentConfirmationEmailTranslate = (
  key: string,
  fallback: string,
  values?: Record<string, string>,
) => string

export type InvoicePaymentConfirmationRequestResult = {
  confirmationId: string
  invoiceId: string
  installmentId: string | null
  status: 'PENDING'
  expiresAt: string
}

export function generateInvoicePaymentConfirmationToken(): {
  rawToken: InvoicePublicToken
  tokenHash: InvoiceTokenHash
} {
  const rawToken = invoicePublicTokenSchema.parse(
    randomBytes(INVOICE_PAYMENT_CONFIRMATION_TOKEN_BYTES).toString('hex'),
  )
  return { rawToken, tokenHash: hashInvoicePublicToken(rawToken) }
}

function installmentItems(invoice: Invoice): InvoiceInstallment[] {
  const installments = invoice.installments as unknown
  if (Array.isArray(installments)) return installments
  if (installments && typeof installments === 'object') {
    const collection = installments as { getItems?: () => InvoiceInstallment[] }
    if (typeof collection.getItems === 'function') return collection.getItems()
  }
  return []
}

function invoiceLabel(invoice: Invoice): string {
  return [invoice.invoiceSymbol, invoice.invoiceNumber]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
}

function createPaymentConfirmationEmail(input: {
  invoice: Invoice
  installment: InvoiceInstallment | null
  confirmationUrl: string
  expiresAt: Date
  locale: string
  translate: InvoicePaymentConfirmationEmailTranslate
}): { subject: string; react: React.ReactElement } {
  const { invoice, installment, confirmationUrl, expiresAt, locale, translate } = input
  const label = invoiceLabel(invoice)
  const amount = installment?.totalAmount ?? invoice.outstandingAmount ?? '0'
  const payer = invoice.buyerName || translate('invoice.paymentConfirmation.email.payerFallback', 'Buyer')
  const payee = invoice.sellerName || invoice.company?.name || translate(
    'invoice.paymentConfirmation.email.payeeFallback',
    'Supplier',
  )
  const formattedExpiry = expiresAt.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
  const subject = translate(
    'invoice.paymentConfirmation.email.subject',
    'Payment confirmation for invoice {invoiceLabel}',
    { invoiceLabel: label },
  )
  const content: React.ReactNode[] = [
    React.createElement('h1', { key: 'heading' }, translate(
      'invoice.paymentConfirmation.email.heading',
      'Please confirm payment',
    )),
    React.createElement('p', { key: 'intro' }, translate(
      'invoice.paymentConfirmation.email.intro',
      '{payer} asks {payee} to confirm payment for invoice {invoiceLabel}.',
      { payer, payee, invoiceLabel: label },
    )),
    React.createElement('p', { key: 'amount' }, translate(
      'invoice.paymentConfirmation.email.amount',
      'Amount: {amount} {currency}',
      { amount, currency: invoice.currencyCode },
    )),
  ]

  if (installment) {
    content.push(React.createElement('p', { key: 'installment' }, translate(
      'invoice.paymentConfirmation.email.installment',
      'Installment {sequence}',
      { sequence: String(installment.sequence) },
    )))
  }

  content.push(
    React.createElement('p', { key: 'expiry' }, translate(
      'invoice.paymentConfirmation.email.expiry',
      'This request expires on {expiryDate}.',
      { expiryDate: formattedExpiry },
    )),
    React.createElement('a', { key: 'action', href: confirmationUrl }, translate(
      'invoice.paymentConfirmation.email.action',
      'Review payment request',
    )),
  )

  return { subject, react: React.createElement('div', null, content) }
}

export class InvoicePaymentConfirmationsService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyEmailsService: InvoiceCompanyEmailsService,
  ) {}

  async request(
    scope: InvoiceScope,
    rawInput: InvoicePaymentConfirmationRequestInput,
  ): Promise<InvoicePaymentConfirmationRequestResult> {
    const input = invoicePaymentConfirmationRequestSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const locale = await detectLocale()
    let supersededCount = 0
    let companyId = ''

    const result = await this.em.transactional(async (tx) => {
      const scopedPersistence = new InvoiceScopedPersistenceService(tx)
      const invoice = await scopedPersistence.findById(Invoice, scope, input.invoiceId, {
        populate: ['company', 'installments'] as never[],
        orderBy: { installments: { sequence: 'asc' } },
      })
      if (!invoice) throw notFound('[internal] Invoice not found')
      if (invoice.direction !== 'AP') {
        throw badRequest('[internal] Payment confirmation requests are allowed only for AP invoices')
      }
      if (invoice.settlementStatus === 'SETTLED') {
        throw badRequest('[internal] Settled invoice cannot request payment confirmation')
      }

      const installment = input.installmentId
        ? installmentItems(invoice).find((item) => item.id === input.installmentId) ?? null
        : null
      if (input.installmentId && !installment) {
        throw notFound('[internal] Invoice installment not found')
      }
      if (installment?.status === 'PAID') {
        throw badRequest('[internal] Paid installment cannot request payment confirmation')
      }

      const { rawToken, tokenHash } = generateInvoicePaymentConfirmationToken()
      const confirmationUrl = `${getSecurityEmailBaseUrl()}/confirm-payment/${rawToken}`
      const now = new Date()
      const expiresAt = new Date(now.getTime() + INVOICE_PAYMENT_CONFIRMATION_TTL_DAYS * 24 * 60 * 60 * 1000)
      const confirmation = scopedPersistence.createScoped(InvoicePaymentConfirmation, scope, {
        invoice,
        installment,
        recipientEmail: input.recipientEmail,
        tokenHash,
        status: 'PENDING',
        expiresAt,
        confirmedAt: null,
        rejectedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      await tx.persist(confirmation).flush()

      const email = createPaymentConfirmationEmail({
        invoice,
        installment,
        confirmationUrl,
        expiresAt,
        locale,
        translate,
      })
      try {
        await sendEmail({ to: input.recipientEmail, subject: email.subject, react: email.react })
      } catch {
        logger.error('Payment confirmation email delivery failed', {
          confirmationId: confirmation.id,
          invoiceId: invoice.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
        throw badRequest('[internal] Payment confirmation email delivery failed')
      }

      const previousPendingWhere: FilterQuery<InvoicePaymentConfirmation> = {
        id: { $ne: confirmation.id },
        invoice,
        installment,
        status: 'PENDING',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }
      supersededCount = await tx.nativeDelete(InvoicePaymentConfirmation, previousPendingWhere)
      companyId = invoice.company.id

      return {
        confirmationId: confirmation.id,
        invoiceId: invoice.id,
        installmentId: installment?.id ?? null,
        status: 'PENDING' as const,
        expiresAt: expiresAt.toISOString(),
      }
    })

    try {
      await this.companyEmailsService.record(scope, {
        companyId,
        email: input.recipientEmail,
      })
    } catch {
      logger.warn('Payment confirmation recipient memory failed', {
        confirmationId: result.confirmationId,
        invoiceId: result.invoiceId,
        companyId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
    }

    logger.info('Payment confirmation requested', {
      confirmationId: result.confirmationId,
      invoiceId: result.invoiceId,
      installmentId: result.installmentId,
      supersededCount,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    await emitInvoiceEvent('invoice.payment_confirmation.requested', {
      id: result.confirmationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    return result
  }
}

export function createInvoicePaymentConfirmationsService(
  em: EntityManager,
  companyEmailsService: InvoiceCompanyEmailsService,
): InvoicePaymentConfirmationsService {
  return new InvoicePaymentConfirmationsService(em, companyEmailsService)
}
