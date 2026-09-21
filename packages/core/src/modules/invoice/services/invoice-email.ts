import React from 'react'
import { randomBytes } from 'node:crypto'

import type { Invoice, InvoiceInstallment, InvoiceLineItem } from '../data/entities'
import { formatInvoiceMoney, formatInvoiceNumber, formatInvoiceRate } from '../lib/format'
import {
  invoicePublicTokenSchema,
  INVOICE_EMAIL_TRACKING_TOKEN_BYTES,
  hashInvoicePublicToken,
  type InvoicePublicToken,
  type InvoiceTokenHash,
} from '../data/validators'

export type InvoiceEmailTranslate = (key: string, fallback: string, values?: Record<string, string>) => string

export type InvoiceEmailHtmlOptions = {
  trackingPixelUrl?: string | null
  translate?: InvoiceEmailTranslate
}

export type PaymentConfirmationEmailHtmlInput = {
  invoice: Invoice
  installment: InvoiceInstallment | null
  confirmationUrl: string
  expiresInDays: number
  translate: InvoiceEmailTranslate
}

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
const PAGE_BACKGROUND = '#f1f5f9'
const SURFACE_BACKGROUND = '#ffffff'
const BORDER_COLOR = '#e2e8f0'
const MUTED_COLOR = '#64748b'
const TEXT_COLOR = '#0f172a'
const ACCENT_COLOR = '#0f766e'
const LABEL_STYLE = `font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${MUTED_COLOR};`

const defaultTranslate: InvoiceEmailTranslate = (_key, fallback, values) =>
  Object.entries(values ?? {}).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    fallback,
  )

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}

function emailReact(html: string): React.ReactElement {
  return React.createElement('div', { dangerouslySetInnerHTML: { __html: html } })
}

function formatDate(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return '—'
  const day = String(value.getUTCDate()).padStart(2, '0')
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${value.getUTCFullYear()}`
}

function formatMoney(value: string | null | undefined, currency: string): string {
  return formatInvoiceMoney(value, currency)
}

function formatNumber(value: string | null | undefined, currency: string): string {
  return formatInvoiceNumber(value, currency)
}

function formatRate(value: string | null | undefined): string {
  return formatInvoiceRate(value)
}

function formatConfirmationAmount(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(2) : value
}

function invoiceLabel(invoice: Invoice): string {
  return [invoice.invoiceSymbol, invoice.invoiceNumber]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
}

function collectionItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object' && typeof (value as { getItems?: unknown }).getItems === 'function') {
    return (value as { getItems: () => T[] }).getItems()
  }
  return []
}

function statusLabel(invoice: Invoice): string {
  if (invoice.settlementStatus === 'SETTLED') return 'PAID'
  if (invoice.settlementStatus === 'PARTIALLY_PAID') return 'PARTIALLY PAID'
  const dueDate = invoice.dueDate
  if (dueDate && dueDate.getTime() < Date.now()) return 'OVERDUE'
  return 'UNPAID'
}

function partyBlock(name: string, taxCode: string | null | undefined): string {
  return `<div style="font-size:16px;font-weight:700;color:${TEXT_COLOR};">${escapeHtml(name || '—')}</div>${
    taxCode ? `<div style="margin-top:4px;font-size:13px;color:${MUTED_COLOR};">Tax Code: ${escapeHtml(taxCode)}</div>` : ''
  }`
}

function lineItemRow(item: InvoiceLineItem, currency: string, last: boolean): string {
  const border = last ? '' : `border-bottom:1px solid ${PAGE_BACKGROUND};`
  return `<tr>
    <td style="padding:12px;${border}font-size:13px;color:${MUTED_COLOR};">${item.lineNumber}</td>
    <td style="padding:12px;${border}font-size:13px;color:${TEXT_COLOR};">${escapeHtml(item.name)}</td>
    <td align="right" style="padding:12px;${border}font-size:13px;color:${TEXT_COLOR};">${formatNumber(item.quantity, currency)}${item.unit ? ` ${escapeHtml(item.unit)}` : ''}</td>
    <td align="right" style="padding:12px;${border}font-size:13px;color:${TEXT_COLOR};">${escapeHtml(formatMoney(item.unitPrice, currency))}</td>
    <td align="right" style="padding:12px;${border}font-size:13px;color:${MUTED_COLOR};">${escapeHtml(formatRate(item.vatRate))}</td>
    <td align="right" style="padding:12px;${border}font-size:13px;font-weight:600;color:${TEXT_COLOR};">${escapeHtml(formatMoney(item.lineTotal, currency))}</td>
  </tr>`
}

function totalRow(label: string, value: string, strong = false): string {
  const weight = strong ? '700' : '400'
  const size = strong ? '15px' : '13px'
  const border = strong ? `border-top:1px solid ${BORDER_COLOR};` : ''
  return `<tr>
    <td style="padding:7px 0;${border}font-size:${size};font-weight:${weight};color:${strong ? TEXT_COLOR : MUTED_COLOR};">${escapeHtml(label)}</td>
    <td align="right" style="padding:7px 0;${border}font-size:${size};font-weight:${weight};color:${strong ? TEXT_COLOR : MUTED_COLOR};">${escapeHtml(value)}</td>
  </tr>`
}

function installmentRows(invoice: Invoice): string {
  const installments = collectionItems<InvoiceInstallment>(invoice.installments)
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
  if (installments.length === 0) return ''
  return `<tr>
    <td style="border-top:1px solid ${BORDER_COLOR};padding:24px 32px 32px;">
      <div style="${LABEL_STYLE}">Payment schedule</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;border-collapse:collapse;">
        <tr>
          <th align="left" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">Phase</th>
          <th align="left" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">Due date</th>
          <th align="right" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">Amount</th>
          <th align="left" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">Status</th>
        </tr>
        ${installments.map((installment, index) => {
          const border = index === installments.length - 1 ? '' : `border-bottom:1px solid ${PAGE_BACKGROUND};`
          return `<tr>
            <td style="padding:10px 8px;${border}font-size:13px;color:${TEXT_COLOR};">#${installment.sequence}</td>
            <td style="padding:10px 8px;${border}font-size:13px;color:${TEXT_COLOR};">${formatDate(installment.dueDate)}</td>
            <td align="right" style="padding:10px 8px;${border}font-size:13px;color:${TEXT_COLOR};">${escapeHtml(formatMoney(installment.totalAmount, invoice.currencyCode))}</td>
            <td style="padding:10px 8px;${border}font-size:13px;color:${MUTED_COLOR};">${escapeHtml(installment.status)}</td>
          </tr>`
        }).join('')}
      </table>
    </td>
  </tr>`
}

export function buildInvoiceEmailHtml(invoice: Invoice, options: InvoiceEmailHtmlOptions = {}): string {
  const translate = options.translate ?? defaultTranslate
  const label = invoiceLabel(invoice)
  const currency = invoice.currencyCode
  const items = collectionItems<InvoiceLineItem>(invoice.lineItems)
    .slice()
    .sort((left, right) => left.lineNumber - right.lineNumber)
  const rows = items.length > 0
    ? items.map((item, index) => lineItemRow(item, currency, index === items.length - 1)).join('')
    : `<tr><td colspan="6" style="padding:24px;text-align:center;color:${MUTED_COLOR};">No line items</td></tr>`
  const balanceDue = invoice.settlementStatus === 'SETTLED' ? '0' : invoice.outstandingAmount
  const trackingPixel = options.trackingPixelUrl
    ? `<img src="${escapeHtml(options.trackingPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;" />`
    : ''

  return `<div style="margin:0;padding:24px 12px;background:${PAGE_BACKGROUND};font-family:${FONT_FAMILY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:100%;">
        <tr><td style="padding:0 0 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td><div style="font-size:24px;font-weight:700;color:${TEXT_COLOR};">${escapeHtml(translate('invoice.email.heading', `Invoice ${label}`, { invoiceNumber: label }))}</div>
                <div style="margin-top:4px;font-size:13px;color:${MUTED_COLOR};">${escapeHtml(translate('invoice.email.issuedOn', 'Issued on {date}', { date: formatDate(invoice.invoiceDate) }))}</div>
              </td>
              <td align="right" style="vertical-align:middle;"><span style="display:inline-block;padding:4px 10px;border:1px solid ${BORDER_COLOR};border-radius:999px;background:${SURFACE_BACKGROUND};font-size:12px;font-weight:700;color:${MUTED_COLOR};">${escapeHtml(statusLabel(invoice))}</span></td>
            </tr>
          </table>
        </td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER_COLOR};border-radius:8px;background:${SURFACE_BACKGROUND};">
            <tr><td style="padding:24px;border-bottom:1px solid ${BORDER_COLOR};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="vertical-align:top;">${partyBlock(invoice.sellerName, invoice.sellerTaxCode)}</td>
                <td align="right" style="vertical-align:top;"><div style="font-family:monospace;font-size:14px;color:${MUTED_COLOR};">${escapeHtml(label)}</div>
                  <div style="margin-top:12px;${LABEL_STYLE}">Total</div>
                  <div style="margin-top:3px;font-size:26px;font-weight:700;color:${TEXT_COLOR};">${escapeHtml(formatMoney(invoice.grossAmount, currency))}</div>
                </td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:24px 32px;border-bottom:1px solid ${BORDER_COLOR};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td width="224" style="vertical-align:top;"><div style="padding:18px 20px;background:${PAGE_BACKGROUND};border-radius:8px;">
                  <div style="${LABEL_STYLE}">Issue date</div><div style="margin-top:3px;font-size:14px;color:${TEXT_COLOR};">${formatDate(invoice.invoiceDate)}</div>
                  <div style="margin-top:14px;${LABEL_STYLE}">Due date</div><div style="margin-top:3px;font-size:14px;color:${TEXT_COLOR};">${invoice.dueDate ? formatDate(invoice.dueDate) : 'Not set'}</div>
                </div></td>
                <td style="vertical-align:top;padding-left:24px;"><div style="${LABEL_STYLE}">Bill to</div><div style="margin-top:4px;">${partyBlock(invoice.buyerName, invoice.buyerTaxCode)}</div></td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:24px 32px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <th align="left" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">No.</th>
                  <th align="left" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">Description</th>
                  <th align="right" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">Qty</th>
                  <th align="right" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">Unit</th>
                  <th align="right" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">VAT</th>
                  <th align="right" style="padding:8px;background:${PAGE_BACKGROUND};${LABEL_STYLE}">Amount</th>
                </tr>${rows}
              </table>
              <table role="presentation" width="320" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 auto;">
                ${invoice.netAmount != null ? totalRow('Subtotal', formatMoney(invoice.netAmount, currency)) : ''}
                ${invoice.vatAmount != null ? totalRow('VAT', formatMoney(invoice.vatAmount, currency)) : ''}
                ${totalRow('Total', formatMoney(invoice.grossAmount, currency), true)}
                ${totalRow('Balance due', formatMoney(balanceDue, currency), true)}
              </table>
            </td></tr>
            ${installmentRows(invoice)}
          </table>
        </td></tr>
        <tr><td style="padding-top:12px;">${trackingPixel}</td></tr>
      </table>
    </td></tr>
  </table>
</div>`
}

export function buildPaymentConfirmationEmailHtml(input: PaymentConfirmationEmailHtmlInput): string {
  const { invoice, installment, confirmationUrl, expiresInDays, translate } = input
  const label = invoiceLabel(invoice)
  const payee = invoice.sellerName || invoice.company?.name || 'Supplier'
  const payer = invoice.buyerName || 'Buyer'
  const amount = formatConfirmationAmount(installment?.totalAmount ?? invoice.outstandingAmount ?? invoice.grossAmount)
  const installmentText = installment
    ? `<div style="margin-top:8px;font-size:14px;color:${MUTED_COLOR};">${escapeHtml(translate('invoice.paymentConfirmation.email.installment', 'Installment {sequence}', { sequence: String(installment.sequence) }))}</div>`
    : ''
  const message = translate(
    'invoice.paymentConfirmation.email.body',
    '{payer} says they have paid you {amount} {currency} for invoice {invoiceLabel}.',
    { payer, amount, currency: invoice.currencyCode, invoiceLabel: label },
  )
  const action = translate('invoice.paymentConfirmation.email.confirmAction', 'Yes, I received this payment')
  const expiry = translate(
    'invoice.paymentConfirmation.email.expiresIn',
    'This link expires in {days} days.',
    { days: String(expiresInDays) },
  )

  return `<div style="margin:0;padding:32px 12px;background:${PAGE_BACKGROUND};font-family:${FONT_FAMILY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:#ffffff;border:1px solid ${BORDER_COLOR};border-radius:8px;">
      <tr><td style="padding:32px;">
        <p style="margin:0;font-size:18px;line-height:1.5;color:${TEXT_COLOR};">${escapeHtml(translate('invoice.paymentConfirmation.email.greeting', 'Hi {payee},', { payee }))}</p>
        <p style="margin:24px 0 0;font-size:16px;line-height:1.6;color:${TEXT_COLOR};">${escapeHtml(message)}</p>
        ${installmentText}
        <p style="margin:20px 0 0;font-size:16px;line-height:1.6;color:${TEXT_COLOR};">${escapeHtml(translate('invoice.paymentConfirmation.email.check', 'Please check that you received this payment.'))}</p>
        <p style="margin:28px 0;text-align:center;"><a href="${escapeHtml(confirmationUrl)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:${ACCENT_COLOR};color:${SURFACE_BACKGROUND};font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(action)}</a></p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED_COLOR};">${escapeHtml(translate('invoice.paymentConfirmation.email.ignore', 'If you did not expect this payment, ignore this email.'))}</p>
        <p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:${MUTED_COLOR};">${escapeHtml(expiry)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</div>`
}

export function generateInvoiceTrackingToken(): { rawToken: InvoicePublicToken; tokenHash: InvoiceTokenHash } {
  const rawToken = invoicePublicTokenSchema.parse(randomBytes(INVOICE_EMAIL_TRACKING_TOKEN_BYTES).toString('hex'))
  return { rawToken, tokenHash: hashInvoicePublicToken(rawToken) }
}

export function buildInvoiceTrackingPixelUrl(rawToken: InvoicePublicToken): string | null {
  const configuredBaseUrl = process.env.EMAIL_ASSET_BASE_URL?.trim()
  if (!configuredBaseUrl) return null

  try {
    const baseUrl = new URL(configuredBaseUrl)
    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') return null
    return `${baseUrl.toString().replace(/\/$/, '')}/api/invoice/track/${rawToken}/pixel.gif`
  } catch {
    return null
  }
}

export function createInvoiceEmail(input: {
  invoice: Invoice
  rawToken: InvoicePublicToken
  locale: string
  translate: InvoiceEmailTranslate
}): { subject: string; react: React.ReactElement } {
  const { invoice, rawToken, translate } = input
  const label = invoiceLabel(invoice)
  const pixelUrl = buildInvoiceTrackingPixelUrl(rawToken)
  const subject = translate('invoice.email.subject', 'Invoice {invoiceNumber}', { invoiceNumber: label })
  const html = buildInvoiceEmailHtml(invoice, { trackingPixelUrl: pixelUrl, translate })
  return { subject, react: emailReact(html) }
}

export function createPaymentConfirmationEmail(input: PaymentConfirmationEmailHtmlInput): { subject: string; react: React.ReactElement } {
  const label = invoiceLabel(input.invoice)
  const subject = input.translate(
    'invoice.paymentConfirmation.email.subject',
    'Payment confirmation for invoice {invoiceLabel}',
    { invoiceLabel: label },
  )
  return { subject, react: emailReact(buildPaymentConfirmationEmailHtml(input)) }
}

export function transparentInvoiceTrackingGif(): Uint8Array {
  return Uint8Array.from(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64'))
}
