import { expect, test } from '@playwright/test'

const summary = { currency: 'VND', ar: { outstandingAmount: '1200', settledAmount: '0', totalAmount: '1200' }, ap: { outstandingAmount: '800', settledAmount: '0', totalAmount: '800' }, netPosition: '400', netOutstanding: '400', ratesStale: false }
const forecast = { currency: 'VND', ratesStale: false, series: [{ date: '2026-09-12', arAmount: '1200', apAmount: '800', netAmount: '400' }], totals: { arAmount: '1200', apAmount: '800', netAmount: '400' } }
const invoice = { id: '00000000-0000-0000-0000-000000000001', invoiceNumber: 'INV-001', direction: 'AP', partnerName: 'Test Partner', invoiceDate: null, dueDate: null, currencyCode: 'VND', grossAmount: '800', outstandingAmount: '800', settlementStatus: 'OPEN', origin: 'manual' }

test.describe('Invoice read surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/invoice/summary', (route) => route.fulfill({ status: 200, json: summary }))
    await page.route('**/api/invoice/forecast**', (route) => route.fulfill({ status: 200, json: forecast }))
    await page.route('**/api/invoice/invoices?**', (route) => route.fulfill({ status: 200, json: { items: [invoice], total: 1, page: 1, pageSize: 50, totalPages: 1 } }))
    await page.route('**/api/invoice/invoices/*', (route) => route.fulfill({ status: 200, json: invoice }))
  })

  test('loads dashboard and all invoice list', async ({ page }) => {
    await page.goto('/backend/invoice')
    await expect(page.getByRole('heading', { name: /invoice dashboard/i })).toBeVisible()
    await page.goto('/backend/invoice/all')
    await expect(page.getByRole('heading', { name: /all invoices/i })).toBeVisible()
    await expect(page.getByText('INV-001')).toBeVisible()
  })

  test('loads AP and AR list routes and opens detail', async ({ page }) => {
    await page.goto('/backend/invoice/payables')
    await expect(page.getByRole('heading', { name: /payables/i })).toBeVisible()
    await page.goto('/backend/invoice/receivables')
    await expect(page.getByRole('heading', { name: /receivables/i })).toBeVisible()
    await page.goto('/backend/invoice/all')
    await page.getByText('INV-001').click()
    await expect(page).toHaveURL(/\/backend\/invoice\/all\//)
  })
})
