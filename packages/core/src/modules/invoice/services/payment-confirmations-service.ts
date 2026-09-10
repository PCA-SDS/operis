import React from 'react'
import { randomBytes } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { badRequest, conflict, notFound, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { detectLocale, resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getSecurityEmailBaseUrl } from '@open-mercato/shared/lib/url'

import { Invoice, InvoiceInstallment, InvoicePaymentConfirmation } from '../data/entities'
import { mapInvoiceEntityToDetailDto, type InvoiceDetailDto } from '../data/mappers'
import type { InvoiceScope } from '../data/scope'
import {
  hashInvoicePublicToken,
  INVOICE_PAYMENT_CONFIRMATION_TOKEN_BYTES,
  INVOICE_PAYMENT_CONFIRMATION_TTL_DAYS,
  invoicePaymentConfirmationRequestSchema,
  invoicePaymentConfirmationPublicPreviewSchema,
  invoicePaymentConfirmationPublicTransitionSchema,
  invoicePublicTokenSchema,
  type InvoicePaymentConfirmationRequestInput,
  type InvoicePublicToken,
  type InvoiceTokenHash,
  type InvoicePaymentConfirmationPublicPreview,
  type InvoicePaymentConfirmationPublicTransition,
} from '../data/validators'
import { emitInvoiceEvent } from '../events'
import type { InvoiceCompanyEmailsService } from './company-emails-service'
import { InvoiceScopedPersistenceService } from './scoped-persistence-service'
import type { InvoiceService } from './invoice-service'

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

export type InvoiceIncomingPaymentConfirmationResult = {
  confirmationId: string
  status: 'CONFIRMED' | 'REJECTED'
  invoice: InvoiceDetailDto
}

type IncomingPaymentConfirmationMatch = {
  receiverInvoice: Invoice
  confirmation: InvoicePaymentConfirmation
}

const publicConfirmationNotFound = () => notFound('[internal] Payment confirmation not found')

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
    private readonly invoiceService?: InvoiceService,
  ) {}

  private async findByPublicToken(rawToken: string) {
    const token = invoicePublicTokenSchema.safeParse(rawToken)
    if (!token.success) throw publicConfirmationNotFound()
    const confirmation = await this.em.findOne(
      InvoicePaymentConfirmation,
      { tokenHash: hashInvoicePublicToken(token.data) },
      { populate: ['invoice', 'invoice.company', 'installment'] as never[] },
    )
    if (!confirmation) throw publicConfirmationNotFound()
    return confirmation
  }

  private publicPreview(confirmation: InvoicePaymentConfirmation): InvoicePaymentConfirmationPublicPreview {
    const invoice = confirmation.invoice
    const installment = confirmation.installment ?? null
    return invoicePaymentConfirmationPublicPreviewSchema.parse({
      status: confirmation.status,
      expiresAt: confirmation.expiresAt.toISOString(),
      payerName: invoice.buyerName ?? null,
      payeeName: invoice.sellerName ?? invoice.company?.name ?? null,
      invoice: {
        symbol: invoice.invoiceSymbol ?? null,
        number: invoice.invoiceNumber,
        amount: installment?.totalAmount ?? invoice.outstandingAmount,
        currencyCode: invoice.currencyCode,
      },
      installment: installment
        ? {
            sequence: installment.sequence,
            amount: installment.totalAmount,
            dueDate: installment.dueDate.toISOString(),
          }
        : null,
    })
  }

  async getPublicPreview(rawToken: string): Promise<InvoicePaymentConfirmationPublicPreview> {
    return this.publicPreview(await this.findByPublicToken(rawToken))
  }

  private async transitionPublic(rawToken: string, target: 'CONFIRMED' | 'REJECTED'):
    Promise<InvoicePaymentConfirmationPublicTransition> {
    const result = await this.em.transactional(async (tx) => {
      const token = invoicePublicTokenSchema.safeParse(rawToken)
      if (!token.success) throw publicConfirmationNotFound()
      const tokenHash = hashInvoicePublicToken(token.data)
      const confirmation = await tx.findOne(
        InvoicePaymentConfirmation,
        { tokenHash },
        { populate: ['invoice', 'invoice.company', 'installment'] as never[] },
      )
      if (!confirmation) throw publicConfirmationNotFound()

      if (confirmation.status === target) {
        return { status: target }
      }
      if (confirmation.status !== 'PENDING') {
        throw conflict('[internal] Payment confirmation is already in the opposite terminal state')
      }
      if (confirmation.expiresAt.getTime() <= Date.now()) {
        throw new CrudHttpError(410, { error: '[internal] Payment confirmation has expired' })
      }

      const now = new Date()
      const update = target === 'CONFIRMED'
        ? { status: target, confirmedAt: now, updatedAt: now }
        : { status: target, rejectedAt: now, updatedAt: now }
      const changed = await tx.nativeUpdate(
        InvoicePaymentConfirmation,
        { tokenHash, status: 'PENDING' },
        update,
      )
      if (changed !== 1) {
        const current = await tx.findOne(InvoicePaymentConfirmation, { tokenHash })
        if (current?.status === target) return { status: target }
        throw conflict('[internal] Payment confirmation transition conflicted')
      }

      if (target === 'CONFIRMED') {
        if (!this.invoiceService) throw new Error('[internal] Invoice payment service is not configured')
        await this.invoiceService.forTransaction(tx).applyInvoicePayment(
          { tenantId: confirmation.tenantId, organizationId: confirmation.organizationId },
          confirmation.invoice.id,
          { installmentId: confirmation.installment?.id ?? undefined },
        )
      }

      return { status: target, confirmationId: confirmation.id, tenantId: confirmation.tenantId, organizationId: confirmation.organizationId }
    })

    if ('confirmationId' in result) {
      await emitInvoiceEvent(`invoice.payment_confirmation.${target.toLowerCase()}` as 'invoice.payment_confirmation.confirmed' | 'invoice.payment_confirmation.rejected', {
        id: result.confirmationId,
        tenantId: result.tenantId,
        organizationId: result.organizationId,
      })
    }
    return invoicePaymentConfirmationPublicTransitionSchema.parse({ status: result.status })
  }

  async confirmPublic(rawToken: string): Promise<InvoicePaymentConfirmationPublicTransition> {
    return this.transitionPublic(rawToken, 'CONFIRMED')
  }

  async rejectPublic(rawToken: string): Promise<InvoicePaymentConfirmationPublicTransition> {
    return this.transitionPublic(rawToken, 'REJECTED')
  }

  private async findIncoming(
    tx: EntityManager,
    scope: InvoiceScope,
    receiverInvoiceId: string,
    now: Date,
  ): Promise<IncomingPaymentConfirmationMatch> {
    const scopedPersistence = new InvoiceScopedPersistenceService(tx)
    const receiverInvoice = await scopedPersistence.findById(Invoice, scope, receiverInvoiceId, {
      populate: ['lineItems', 'installments'] as never[],
      orderBy: {
        lineItems: { lineNumber: 'asc' },
        installments: { sequence: 'asc' },
      },
    })
    if (!receiverInvoice) throw notFound('[internal] Invoice not found')
    if (receiverInvoice.direction !== 'AR') {
      throw badRequest('[internal] Incoming payment confirmation is allowed only for AR invoices')
    }

    const confirmations = await tx.find(InvoicePaymentConfirmation, {
      status: 'PENDING',
      expiresAt: { $gt: now },
      installment: null,
      invoice: {
        direction: 'AP',
        deletedAt: null,
        sellerTaxCode: receiverInvoice.sellerTaxCode ?? null,
        buyerTaxCode: receiverInvoice.buyerTaxCode ?? null,
        invoiceSymbol: receiverInvoice.invoiceSymbol ?? null,
        invoiceNumber: receiverInvoice.invoiceNumber,
        invoiceDate: receiverInvoice.invoiceDate,
      },
    }, {
      populate: ['invoice'] as never[],
      orderBy: { createdAt: 'desc' },
      limit: 2,
    })

    if (confirmations.length !== 1) {
      throw conflict('[internal] No unique pending incoming payment confirmation exists')
    }

    const confirmation = confirmations[0]
    if (
      confirmation.invoice.tenantId !== confirmation.tenantId
      || confirmation.invoice.organizationId !== confirmation.organizationId
    ) {
      throw conflict('[internal] Incoming payment confirmation scope is inconsistent')
    }

    return { receiverInvoice, confirmation }
  }

  private async transitionIncoming(
    scope: InvoiceScope,
    receiverInvoiceId: string,
    target: 'CONFIRMED' | 'REJECTED',
  ): Promise<InvoiceIncomingPaymentConfirmationResult> {
    const now = new Date()
    const result = await this.em.transactional(async (tx) => {
      const { receiverInvoice, confirmation } = await this.findIncoming(
        tx,
        scope,
        receiverInvoiceId,
        now,
      )
      const changed = await tx.nativeUpdate(
        InvoicePaymentConfirmation,
        { id: confirmation.id, status: 'PENDING', expiresAt: { $gt: now } },
        target === 'CONFIRMED'
          ? { status: target, confirmedAt: now, updatedAt: now }
          : { status: target, rejectedAt: now, updatedAt: now },
      )
      if (changed !== 1) {
        throw conflict('[internal] Incoming payment confirmation transition conflicted')
      }

      let invoice = mapInvoiceEntityToDetailDto(receiverInvoice)
      if (target === 'CONFIRMED') {
        if (!this.invoiceService) throw new Error('[internal] Invoice payment service is not configured')
        const transactionInvoiceService = this.invoiceService.forTransaction(tx)
        await transactionInvoiceService.applyInvoicePayment(
          { tenantId: confirmation.tenantId, organizationId: confirmation.organizationId },
          confirmation.invoice.id,
        )
        const receiverResult = await transactionInvoiceService.updateReceivableSettlement(
          scope,
          receiverInvoice.id,
          { settled: true },
        )
        invoice = receiverResult.invoice
      }

      return {
        confirmationId: confirmation.id,
        payerInvoiceId: confirmation.invoice.id,
        payerTenantId: confirmation.tenantId,
        payerOrganizationId: confirmation.organizationId,
        status: target,
        invoice,
      }
    })

    logger.info(`Incoming payment confirmation ${target.toLowerCase()}`, {
      confirmationId: result.confirmationId,
      payerInvoiceId: result.payerInvoiceId,
      receiverInvoiceId,
      payerTenantId: result.payerTenantId,
      payerOrganizationId: result.payerOrganizationId,
      receiverTenantId: scope.tenantId,
      receiverOrganizationId: scope.organizationId,
    })
    await emitInvoiceEvent(
      `invoice.payment_confirmation.${target.toLowerCase()}` as
        | 'invoice.payment_confirmation.confirmed'
        | 'invoice.payment_confirmation.rejected',
      {
        id: result.confirmationId,
        tenantId: result.payerTenantId,
        organizationId: result.payerOrganizationId,
      },
    )

    return {
      confirmationId: result.confirmationId,
      status: result.status,
      invoice: result.invoice,
    }
  }

  async acceptIncoming(
    scope: InvoiceScope,
    receiverInvoiceId: string,
  ): Promise<InvoiceIncomingPaymentConfirmationResult> {
    return this.transitionIncoming(scope, receiverInvoiceId, 'CONFIRMED')
  }

  async rejectIncoming(
    scope: InvoiceScope,
    receiverInvoiceId: string,
  ): Promise<InvoiceIncomingPaymentConfirmationResult> {
    return this.transitionIncoming(scope, receiverInvoiceId, 'REJECTED')
  }

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
  invoiceService?: InvoiceService,
): InvoicePaymentConfirmationsService {
  return new InvoicePaymentConfirmationsService(em, companyEmailsService, invoiceService)
}
