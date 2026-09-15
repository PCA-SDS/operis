import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const invoiceId = '00000000-0000-4000-8000-000000000077'
const makeInvoice = () => ({
  id: invoiceId, direction: 'AP', origin: 'manual', partnerName: 'UI Test Supplier', partnerCountryCode: 'SG', partnerTaxCode: 'TEST-UEN',
  invoiceSymbol: 'TEST', invoiceNumber: 'UI-007', invoiceCode: '', invoiceDate: '2026-09-09', dueDate: '2026-10-09', nextDueDate: '2026-10-09',
  currencyCode: 'USD', grossAmount: '1100', paidAmount: '0', outstandingAmount: '1100', invoiceStatus: 'ACTIVE', hasInstallmentPlan: true,
  lineItems: [{ name: 'Test equipment', unit: 'pcs', quantity: '1', unitPrice: '1000', discountAmount: null, discountPercent: null, vatRate: '10' }],
  installments: [1, 2].map((sequence) => ({ id: `00000000-0000-4000-8000-00000000007${sequence}`, sequence, principalAmount: '550', interestRate: '0', interestAmount: '0', totalAmount: '550', dueDate: `2026-${sequence + 8}-20T00:00:00+07:00`, status: 'PENDING', note: null as string | null })),
})
const summary = { outstandingAmount: '1100', settledAmount: '0', unpaidInvoices: 1, partiallyPaidInvoices: 0, paidInvoices: 0, unreceivedInvoices: 1, receivedInvoices: 0, nonRecoverableInvoices: 0 }

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await page.context().addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }])
  await login(page, 'superadmin')
  await page.route('**/api/invoice/summary', (route) => route.fulfill({ json: { currency: 'VND', ap: summary, ar: summary } }))
  await page.route('**/api/invoice/sync', (route) => route.fulfill({ json: { canSync: false, reason: 'not_configured', latestJob: null, taxCode: null } }))
  await page.route('**/api/invoice/exchange-rates', (route) => route.fulfill({ json: { stale: false, rates: { USD: { vndPerUnit: 25000 }, VND: { vndPerUnit: 1 } } } }))
  await page.route('**/api/invoice/invoices?**', (route) => route.fulfill({ json: { items: [makeInvoice()], total: 1, page: 1, pageSize: 50, totalPages: 1 } }))
})

test('all and payables keep filters above tables, dismiss dates, and stay clear of the sidebar', async ({ page }, testInfo) => {
  for (const route of ['all', 'payables']) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/backend/invoice/${route}`)
    const heading = page.getByRole('heading', { name: route === 'all' ? 'All invoices' : 'Payables', exact: true })
    const issued = page.getByRole('button', { name: 'Issued: All', exact: true })
    await expect(issued).toBeVisible()
    expect((await heading.boundingBox())!.y).toBeLessThan((await issued.boundingBox())!.y)
    await issued.click()
    const popup = page.getByRole('dialog', { name: 'Issued', exact: true })
    await expect(popup).toBeVisible()
    const bounds = await popup.boundingBox()
    const column = await page.locator('[data-app-shell-column]').boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(column!.x + 15)
    await expect(popup.getByRole('button', { name: 'Last 7 days', exact: true })).toBeVisible()
    await heading.click()
    await expect(popup).toBeHidden()
    await expect(issued).toHaveAttribute('aria-expanded', 'false')
    await issued.click()
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
    await issued.click()
    await popup.getByRole('button', { name: 'Last 7 days', exact: true }).click()
    await expect(page).toHaveURL(/fromDate=.*toDate=/)
    await expect(popup).toBeHidden()
  }
  await page.context().addCookies([{ name: 'locale', value: 'vi', url: 'http://localhost:3000' }])
  await page.goto('/backend/invoice/all')
  await expect(page.getByRole('heading', { name: 'Tất cả hóa đơn', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Ngày phát hành:/ }).click()
  await expect(page.getByText('Khoảng thời gian', { exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="page"]')).not.toContainText('invoice.')
  await page.screenshot({ path: testInfo.outputPath('invoice-all-vietnamese.png') })
  await page.keyboard.press('Escape')
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('button', { name: /Ngày phát hành:/ }).click()
    const popup = page.getByRole('dialog', { name: 'Ngày phát hành', exact: true })
    const bounds = await popup.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
  }
})

test('installment view and editor preserve spacing, dates, validation, and saved fields', async ({ page }, testInfo) => {
  const invoice = makeInvoice()
  let saved: Record<string, unknown> | undefined
  await page.route(`**/api/invoice/invoices/${invoiceId}`, (route) => route.fulfill({ json: invoice }))
  await page.route(`**/api/invoice/invoices/${invoiceId}/installments`, async (route) => {
    saved = route.request().postDataJSON()
    await route.fulfill({ json: { ok: true } })
  })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/backend/invoice/all')
  await page.getByRole('button', { name: 'View plan', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Payments & Installments', exact: true })
  await expect(dialog).toBeVisible()
  expect((await dialog.boundingBox())!.x).toBeGreaterThan((await page.locator('[data-app-shell-column]').boundingBox())!.x)
  await page.screenshot({ path: testInfo.outputPath('installments-restored.png') })
  await dialog.getByRole('button', { name: 'Edit plan', exact: true }).click()
  await expect(dialog.getByLabel('Due date 1', { exact: true })).toHaveValue('2026-09-20')
  await dialog.getByLabel('Principal 1', { exact: true }).fill('500')
  await expect(dialog.getByRole('button', { name: 'Save plan' })).toBeDisabled()
  await dialog.getByLabel('Principal 2', { exact: true }).fill('600')
  await dialog.getByLabel('Interest rate 1', { exact: true }).fill('5')
  await dialog.getByLabel('Note 1', { exact: true }).fill('First payment')
  await dialog.getByLabel('Due date 1', { exact: true }).fill('2026-09-25')
  await expect(dialog.getByRole('button', { name: 'Save plan' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Save plan' }).click()
  await expect.poll(() => saved).toEqual({ installments: [
    { principalAmount: '500', interestRate: 5, dueDate: '2026-09-25', note: 'First payment' },
    { principalAmount: '600', interestRate: 0, dueDate: '2026-10-20', note: null },
  ] })
})

test('edit invoice restores item labels, payment terms, discount modes, totals and save payload', async ({ page }, testInfo) => {
  const invoice = makeInvoice()
  let saved: Record<string, unknown> | undefined
  await page.route(`**/api/invoice/invoices/${invoiceId}`, async (route) => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON()
      await route.fulfill({ json: { invoice: { id: invoiceId } } })
    } else await route.fulfill({ json: invoice })
  })
  await page.goto(`/backend/invoice/all/${invoiceId}/edit`)
  await expect(page.getByRole('heading', { name: 'Edit invoice', exact: true })).toBeVisible()
  await expect(page.getByLabel('Item 1', { exact: false })).toHaveValue('Test equipment')
  await page.getByLabel('Payment terms (days)', { exact: true }).fill('45')
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('2026-10-24')
  await page.getByLabel('Quantity', { exact: false }).fill('2')
  await page.getByLabel('Unit price', { exact: false }).fill('100')
  await page.getByRole('button', { name: 'Discount percentage', exact: true }).click()
  await page.getByLabel('Discount', { exact: true }).fill('10')
  await expect(page.getByText('$198.00', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Add line item', exact: true }).click()
  await expect(page.getByLabel('Item 2', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Remove item 2', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('invoice-edit-restored.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save invoice', exact: true }).click()
  await expect.poll(() => saved).toMatchObject({ dueDate: '2026-10-24', currencyCode: 'USD', lineItems: [{ name: 'Test equipment', quantity: '2', unitPrice: '100', discountPercent: 10, vatRate: 10 }] })
  expect((saved!.lineItems as Record<string, unknown>[])[0]).not.toHaveProperty('discountAmount')
})
