import { expect, test } from '@playwright/test'

const summary = { currency: 'VND', ar: { outstandingAmount: '1200', settledAmount: '0', totalAmount: '1200' }, ap: { outstandingAmount: '800', settledAmount: '0', totalAmount: '800' }, netPosition: '400', netOutstanding: '400', ratesStale: false }
const forecastPoint = { date: '2026-09-12', amount: '400', count: 1, cumulative: '400', arAmount: '1200', apAmount: '800', netAmount: '400' }
const forecast = { currency: 'VND', ratesStale: false, today: '2026-09-01', horizonDays: 365, entries: [], receivable: { overdue: { amount: '0', count: 0 }, undated: { amount: '0', count: 0 }, beyondHorizon: { amount: '0', count: 0 }, points: [{ ...forecastPoint, amount: '1200', cumulative: '1200', apAmount: '0', netAmount: '1200' }] }, payable: { overdue: { amount: '0', count: 0 }, undated: { amount: '0', count: 0 }, beyondHorizon: { amount: '0', count: 0 }, points: [{ ...forecastPoint, amount: '800', cumulative: '800', arAmount: '0', netAmount: '-800' }] }, net: { points: [forecastPoint] }, series: [forecastPoint], totals: { arAmount: '1200', apAmount: '800', netAmount: '400' } }
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

test.describe('Invoice settings', () => {
  test('searches partners and saves only default due days', async ({ page }) => {
    const partner = {
      id: '00000000-0000-0000-0000-000000000011',
      name: 'Acme Supplier',
      taxCode: 'TAX-ACME',
      countryCode: 'SG',
      defaultDueDays: 30,
      updatedAt: '2026-09-14T00:00:00.000Z',
    }
    let savedBody: unknown = null
    let requestedSearch = ''

    await page.route('**/api/invoice/partners?**', async (route) => {
      const url = new URL(route.request().url())
      requestedSearch = url.searchParams.get('search') ?? ''
      await route.fulfill({
        status: 200,
        json: { items: [partner], total: 1, page: 1, pageSize: 20, totalPages: 1 },
      })
    })
    await page.route(`**/api/invoice/partners/${partner.id}`, async (route) => {
      savedBody = route.request().postDataJSON()
      partner.defaultDueDays = 45
      partner.updatedAt = '2026-09-14T00:01:00.000Z'
      await route.fulfill({ status: 200, json: { ok: true, partner } })
    })
    await page.route('**/api/invoice/auto-paid', (route) => route.fulfill({ status: 200, json: { items: [] } }))
    await page.route('**/api/invoice/auto-paid/candidates', (route) => route.fulfill({ status: 200, json: { items: [] } }))

    await page.goto('/backend/invoice/settings')
    await expect(page.getByRole('heading', { name: /invoice settings/i })).toBeVisible()
    await page.getByRole('textbox', { name: /search partner companies/i }).fill('Acme')
    await expect.poll(() => requestedSearch).toBe('Acme')
    const terms = page.getByRole('textbox', { name: /default payment terms for Acme Supplier/i })
    await terms.fill('45')
    await terms.press('Enter')
    await expect.poll(() => savedBody).toEqual({ defaultDueDays: 45 })
  })

  test('adds and removes an Auto-Paid rule, then refreshes backend state', async ({ page }) => {
    const rule = { id: '00000000-0000-0000-0000-000000000021', taxCode: 'SUP-001', updatedAt: null }
    let rules: typeof rule[] = []
    let addCalls = 0
    let removeCalls = 0

    await page.route('**/api/invoice/partners?**', (route) => route.fulfill({ status: 200, json: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 } }))
    await page.route('**/api/invoice/auto-paid/candidates', (route) => route.fulfill({ status: 200, json: { items: [{ taxCode: 'SUP-001', invoiceCount: 3 }] } }))
    await page.route('**/api/invoice/auto-paid', async (route) => {
      if (route.request().method() === 'POST') {
        addCalls += 1
        rules = [rule]
        await route.fulfill({ status: 200, json: { ok: true, ruleId: rule.id, taxCode: rule.taxCode, settledCount: 3 } })
        return
      }
      await route.fulfill({ status: 200, json: { items: rules } })
    })
    await page.route(`**/api/invoice/auto-paid/${rule.id}`, async (route) => {
      removeCalls += 1
      rules = []
      await route.fulfill({ status: 200, json: { ok: true, ruleId: rule.id, taxCode: rule.taxCode, revertedCount: 3 } })
    })

    await page.goto('/backend/invoice/settings')
    await page.getByLabel(/supplier from existing payables/i).selectOption('SUP-001')
    await page.getByRole('button', { name: /add selected/i }).click()
    await expect.poll(() => addCalls).toBe(1)
    await expect(page.getByText('SUP-001', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /remove Auto-Paid rule for SUP-001/i }).click()
    await expect(page.getByText(/remove Auto-Paid rule\?/i)).toBeVisible()
    await page.getByRole('button', { name: /^remove$/i }).last().click()
    await expect.poll(() => removeCalls).toBe(1)
    await expect(page.getByText(/no Auto-Paid rules yet/i)).toBeVisible()
  })
})
