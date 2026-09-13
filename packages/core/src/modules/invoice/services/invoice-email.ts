import React from 'react'
import { randomBytes } from 'node:crypto'

import { invoicePublicTokenSchema, INVOICE_EMAIL_TRACKING_TOKEN_BYTES, hashInvoicePublicToken } from '../data/validators'
import type { Invoice, InvoiceLineItem } from '../data/entities'
import type { InvoicePublicToken, InvoiceTokenHash } from '../data/validators'

export type InvoiceEmailTranslate = (key: string, fallback: string, values?: Record<string, string>) => string

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

function formatDate(value: Date | null | undefined, locale: string): string {
  return value ? value.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : '-'
}

function formatAmount(value: string | null | undefined, currency: string): string {
  return `${value ?? '0'} ${currency}`
}

export function createInvoiceEmail(input: {
  invoice: Invoice
  rawToken: InvoicePublicToken
  locale: string
  translate: InvoiceEmailTranslate
}): { subject: string; react: React.ReactElement } {
  const { invoice, locale, rawToken, translate } = input
  const currency = invoice.currencyCode
  const partnerName = invoice.buyerName || invoice.company?.name || translate('invoice.email.customer', 'Customer')
  const pixelUrl = buildInvoiceTrackingPixelUrl(rawToken)
  const lineItems = Array.from(invoice.lineItems?.getItems?.() ?? []).sort((left, right) => left.lineNumber - right.lineNumber)
  const subject = translate('invoice.email.subject', 'Invoice {invoiceNumber}', { invoiceNumber: invoice.invoiceNumber })

  const content = [
    React.createElement('h1', { key: 'heading' }, translate('invoice.email.heading', 'Invoice {invoiceNumber}', { invoiceNumber: invoice.invoiceNumber })),
    React.createElement('p', { key: 'partner' }, `${translate('invoice.email.to', 'To')}: ${partnerName}`),
    React.createElement('p', { key: 'date' }, `${translate('invoice.email.invoiceDate', 'Invoice date')}: ${formatDate(invoice.invoiceDate, locale)}`),
    React.createElement('p', { key: 'due' }, `${translate('invoice.email.dueDate', 'Due date')}: ${formatDate(invoice.dueDate, locale)}`),
    React.createElement('p', { key: 'total' }, `${translate('invoice.email.total', 'Total')}: ${formatAmount(invoice.grossAmount, currency)}`),
    React.createElement('h2', { key: 'items-heading' }, translate('invoice.email.items', 'Line items')),
    React.createElement('ul', { key: 'items' }, lineItems.map((lineItem: InvoiceLineItem) =>
      React.createElement('li', { key: lineItem.id }, `${lineItem.name}: ${formatAmount(lineItem.lineTotal, currency)}`),
    )),
    pixelUrl ? React.createElement('img', { key: 'pixel', src: pixelUrl, width: 1, height: 1, alt: '' }) : null,
  ]

  return { subject, react: React.createElement('div', null, content) }
}

export function transparentInvoiceTrackingGif(): Uint8Array {
  return Uint8Array.from(Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64'))
}
