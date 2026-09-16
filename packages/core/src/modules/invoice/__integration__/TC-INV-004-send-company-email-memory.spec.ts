import { expect, test, type Page, type Route } from '@playwright/test'

const invoiceId = '00000000-0000-0000-0000-000000000001'
const companyId = '00000000-0000-0000-0000-000000000002'

const baseInvoice = {
  id: invoiceId,
  invoiceSymbol: 'INV',
  invoiceNumber: '001',
  direction: 'AR' as const,
  companyId,
  partnerName: 'Acme Ltd.',
  partnerTaxCode: 'ACME-001',
  sellerName: 'Operis Ltd.',
  sellerTaxCode: 'OPERIS-001',
  buyerName: 'Acme Ltd.',
  buyerTaxCode: 'ACME-001',
  invoiceDate: '2026-09-01T00:00:00.000Z',
  dueDate: '2026-09-30T00:00:00.000Z',
  currencyCode: 'VND',
  grossAmount: '1000000',
  outstandingAmount: '1000000',
  settlementStatus: 'OPEN',
  origin: 'MANUAL',
  netAmount: '900000',
  vatAmount: '100000',
  paidAmount: '0',
  nonRecoverable: false,
  autoSettled: false,
  hasInstallmentPlan: false,
  lastSentAt: null as string | null,
  openedAt: null as string | null,
  updatedAt: '2026-09-14T01:00:00.000Z',
  lineItems: [],
  installments: [],
}

const rememberedEmails = [
  { id: '00000000-0000-0000-0000-000000000003', companyId, email: 'accounts@acme.example', updatedAt: '2026-09-14T03:00:00.000Z' },
  { id: '00000000-0000-0000-0000-000000000004', companyId, email: 'finance@acme.example', updatedAt: '2026-09-13T03:00:00.000Z' },
]

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', json })
}

async function openSendDialog(page: Page) {
  await page.goto(`/backend/invoice/all/${invoiceId}`)
  await page.getByRole('button', { name: 'Send invoice' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test.describe('TC-INV-004: Invoice send and company email memory', () => {
  test('selects a remembered recipient and refreshes detail and memory', async ({ page }) => {
    let detailReads = 0
    let emailReads = 0
    let sentBody: unknown = null
    await page.route('**/api/invoice/invoices/**', async (route) => {
      if (route.request().method() === 'POST') {
        sentBody = route.request().postDataJSON()
        await fulfillJson(route, { ok: true, invoice: { ...baseInvoice, lastSentAt: '2026-09-14T04:00:00.000Z' } })
        return
      }
      detailReads += 1
      await fulfillJson(route, baseInvoice)
    })
    await page.route('**/api/invoice/company-emails?**', async (route) => {
      emailReads += 1
      await fulfillJson(route, { items: rememberedEmails })
    })

    await openSendDialog(page)
    await page.getByRole('button', { name: 'finance@acme.example', exact: true }).click()
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    await expect.poll(() => sentBody).toEqual({ email: 'finance@acme.example' })
    await expect.poll(() => detailReads).toBeGreaterThan(1)
    await expect.poll(() => emailReads).toBeGreaterThan(0)
  })

  test('sends a manually entered recipient without a company-email POST', async ({ page }) => {
    let sentBody: unknown = null
    let memoryPosts = 0
    await page.route('**/api/invoice/invoices/**', async (route) => {
      if (route.request().method() === 'POST') {
        sentBody = route.request().postDataJSON()
        await fulfillJson(route, { ok: true, invoice: baseInvoice })
        return
      }
      await fulfillJson(route, baseInvoice)
    })
    await page.route('**/api/invoice/company-emails**', async (route) => {
      if (route.request().method() === 'POST') memoryPosts += 1
      await fulfillJson(route, { items: [] })
    })

    await openSendDialog(page)
    await page.getByLabel('Recipient email').fill('new@acme.example')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    await expect.poll(() => sentBody).toEqual({ email: 'new@acme.example' })
    expect(memoryPosts).toBe(0)
  })

  test('shows backend-derived sent and opened state after successful refresh', async ({ page }) => {
    let detailReads = 0
    const refreshedInvoice = {
      ...baseInvoice,
      lastSentAt: '2026-09-14T04:00:00.000Z',
      openedAt: '2026-09-14T04:05:00.000Z',
      updatedAt: '2026-09-14T04:00:00.000Z',
    }
    await page.route('**/api/invoice/invoices/**', async (route) => {
      if (route.request().method() === 'POST') {
        await fulfillJson(route, { ok: true, invoice: refreshedInvoice })
        return
      }
      detailReads += 1
      await fulfillJson(route, detailReads === 1 ? baseInvoice : refreshedInvoice)
    })
    await page.route('**/api/invoice/company-emails?**', (route) => fulfillJson(route, { items: [] }))

    await openSendDialog(page)
    await page.getByLabel('Recipient email').fill('accounts@acme.example')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Resend invoice' })).toBeVisible()
    await expect(page.getByText(/Last sent/)).toBeVisible()
    await expect(page.getByText(/Opened/)).toBeVisible()
  })

  test('rejects an invalid recipient without calling send', async ({ page }) => {
    let sendRequests = 0
    await page.route('**/api/invoice/invoices/**', async (route) => {
      if (route.request().method() === 'POST') sendRequests += 1
      await fulfillJson(route, baseInvoice)
    })
    await page.route('**/api/invoice/company-emails?**', (route) => fulfillJson(route, { items: [] }))

    await openSendDialog(page)
    await page.getByLabel('Recipient email').fill('invalid-address')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    expect(sendRequests).toBe(0)
  })

  test('keeps recipient and allows retry after send failure', async ({ page }) => {
    let sendRequests = 0
    await page.route('**/api/invoice/invoices/**', async (route) => {
      if (route.request().method() === 'POST') {
        sendRequests += 1
        if (sendRequests === 1) {
          await fulfillJson(route, { error: 'Invoice email delivery failed' }, 400)
          return
        }
        await fulfillJson(route, { ok: true, invoice: { ...baseInvoice, lastSentAt: '2026-09-14T04:00:00.000Z' } })
        return
      }
      await fulfillJson(route, sendRequests > 1 ? { ...baseInvoice, lastSentAt: '2026-09-14T04:00:00.000Z' } : baseInvoice)
    })
    await page.route('**/api/invoice/company-emails?**', (route) => fulfillJson(route, { items: [] }))

    await openSendDialog(page)
    const recipient = page.getByLabel('Recipient email')
    await recipient.fill('accounts@acme.example')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    await expect(page.getByText('Invoice email delivery failed')).toBeVisible()
    await expect(recipient).toHaveValue('accounts@acme.example')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(sendRequests).toBe(2)
  })

  test('does not offer sending for AP invoices', async ({ page }) => {
    let memoryReads = 0
    await page.route('**/api/invoice/invoices/**', (route) => fulfillJson(route, { ...baseInvoice, direction: 'AP' }))
    await page.route('**/api/invoice/company-emails**', async (route) => {
      memoryReads += 1
      await fulfillJson(route, { items: [] })
    })

    await page.goto(`/backend/invoice/all/${invoiceId}`)
    await expect(page.getByRole('button', { name: /send invoice/i })).toHaveCount(0)
    expect(memoryReads).toBe(0)
  })

  test('removes a remembered recipient through CAP-006', async ({ page }) => {
    let deleteUrl = ''
    await page.route('**/api/invoice/invoices/**', (route) => fulfillJson(route, baseInvoice))
    await page.route('**/api/invoice/company-emails/**', async (route) => {
      deleteUrl = route.request().url()
      await fulfillJson(route, { ok: true })
    })
    await page.route('**/api/invoice/company-emails?**', (route) => fulfillJson(route, { items: rememberedEmails }))

    await openSendDialog(page)
    await page.getByRole('button', { name: 'Remove accounts@acme.example' }).click()

    await expect(page.getByText('accounts@acme.example')).toHaveCount(0)
    expect(deleteUrl).toContain(`/api/invoice/company-emails/${rememberedEmails[0].id}?companyId=${companyId}`)
  })
})
