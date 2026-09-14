import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

import { invoiceBadRequest, invoiceConflict, invoiceNotFound, translateInvoiceErrorBody } from '../errors'

const translate = (key: string, fallback?: string, params?: Record<string, string | number>): string => {
  const dictionary: Record<string, string> = {
    'invoice.errors.send_requires_ar': 'Chỉ hóa đơn AR mới gửi được',
    'invoice.errors.due_date_too_far': 'Hạn thanh toán không quá {days} ngày',
  }
  const template = dictionary[key] ?? fallback ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match))
}

describe('invoice keyed errors', () => {
  it('carries the status and the English fallback on the body', () => {
    const err = invoiceBadRequest('invoice.errors.send_requires_ar', 'Only AR invoices can be sent')
    expect(err).toBeInstanceOf(CrudHttpError)
    expect(err.status).toBe(400)
    expect(err.body).toMatchObject({ error: 'Only AR invoices can be sent', errorKey: 'invoice.errors.send_requires_ar' })
    expect(invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found').status).toBe(404)
    expect(invoiceConflict('invoice.errors.duplicate_manual_invoice', 'Duplicate manual invoice').status).toBe(409)
  })

  it('resolves the key and drops the routing fields from the response body', () => {
    const err = invoiceBadRequest('invoice.errors.send_requires_ar', 'Only AR invoices can be sent')

    expect(translateInvoiceErrorBody(err.body, translate)).toEqual({ error: 'Chỉ hóa đơn AR mới gửi được' })
  })

  it('interpolates params into the resolved message', () => {
    const err = invoiceBadRequest(
      'invoice.errors.due_date_too_far',
      'Due date cannot be more than 365 days after invoice date',
      { days: 365 },
    )

    expect(translateInvoiceErrorBody(err.body, translate)).toEqual({ error: 'Hạn thanh toán không quá 365 ngày' })
  })

  it('falls back to the English text when the locale lacks the key', () => {
    const err = invoiceNotFound('invoice.errors.invoice_not_found', 'Invoice not found')

    expect(translateInvoiceErrorBody(err.body, translate)).toEqual({ error: 'Invoice not found' })
  })

  it('leaves a body without a key untouched, so shared-helper errors pass through', () => {
    const body = { error: 'Unauthorized' }

    expect(translateInvoiceErrorBody(body, translate)).toBe(body)
  })

  /**
   * The marker opts a string out of the i18n hardcoded-string checker, so using
   * it on a message the funnel returns to the caller both ships `[internal]` to
   * users and hides the string from the tool meant to catch it.
   */
  it('never ships the internal marker on a user-facing message', () => {
    const err = invoiceBadRequest('invoice.errors.send_requires_ar', 'Only AR invoices can be sent')

    expect(JSON.stringify(translateInvoiceErrorBody(err.body, translate))).not.toContain('[internal]')
  })
})
