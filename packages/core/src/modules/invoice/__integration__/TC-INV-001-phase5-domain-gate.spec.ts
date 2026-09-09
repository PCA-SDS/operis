import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

test.describe('TC-INV-001: Phase 5 AP domain parity', () => {
  test('combines partner terms, Auto-Paid, trusted scope, and reversal', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const taxCode = `TEST-${suffix}`
    const invoiceNumber = `AP-${suffix}`
    let ruleId: string | null = null
    let invoiceId: string | null = null

    try {
      const ruleResponse = await apiRequest(request, 'POST', '/api/invoice/auto-paid', {
        token,
        data: { taxCode },
      })
      expect(ruleResponse.ok(), `auto-paid rule should succeed: ${ruleResponse.status()}`).toBe(true)
      const rule = (await ruleResponse.json()) as { id?: string }
      ruleId = rule.id ?? null

      const createResponse = await apiRequest(request, 'POST', '/api/invoice/invoices', {
        token,
        data: {
          direction: 'AP',
          partnerName: 'Phase 5 Supplier',
          partnerCountryCode: 'SG',
          partnerTaxCode: taxCode,
          invoiceNumber,
          invoiceDate: '2026-09-01',
          currencyCode: 'VND',
          tenantId: 'forged-tenant',
          organizationId: 'forged-organization',
          paidAmount: '999999',
          settlementStatus: 'UNSETTLED',
          lineItems: [{ name: 'Parity item', quantity: '2', unitPrice: '100' }],
        },
      })
      expect(createResponse.ok(), `manual AP create should succeed: ${createResponse.status()}`).toBe(true)
      const created = (await createResponse.json()) as { invoice?: Record<string, unknown>; id?: string }
      const invoice = created.invoice ?? created
      invoiceId = typeof invoice.id === 'string' ? invoice.id : null

      expect(invoice.direction).toBe('AP')
      expect(invoice.dueDateSource).toBe('partner_terms')
      expect(invoice.grossAmount).toBe('200.0000')
      expect(invoice.settlementStatus).toBe('SETTLED')
      expect(invoice.paidAmount).toBe('200.0000')
      expect(invoice.outstandingAmount).toBe('0.0000')

      const reverseResponse = await apiRequest(request, 'PATCH', `/api/invoice/invoices/${invoiceId}/reverse-auto-paid`, {
        token,
        data: {},
      })
      expect(reverseResponse.ok(), `auto-paid reversal should succeed: ${reverseResponse.status()}`).toBe(true)
      const reversed = (await reverseResponse.json()) as { invoice?: Record<string, unknown> }
      expect(reversed.invoice?.autoPayExcluded).toBe(true)
      expect(reversed.invoice?.settlementStatus).toBe('UNSETTLED')
    } finally {
      if (invoiceId) await apiRequest(request, 'DELETE', `/api/invoice/invoices/${invoiceId}`, { token }).catch(() => {})
      if (ruleId) await apiRequest(request, 'DELETE', `/api/invoice/auto-paid/${ruleId}`, { token }).catch(() => {})
    }
  })
})
