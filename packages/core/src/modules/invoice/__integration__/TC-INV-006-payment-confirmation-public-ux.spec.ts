import { expect, test } from '@playwright/test'

const token = 'a'.repeat(64)
const preview = {
  status: 'PENDING',
  expiresAt: '2099-01-01T00:00:00.000Z',
  payerName: 'Buyer Ltd.',
  payeeName: 'Supplier Ltd.',
  invoice: { symbol: 'INV', number: '001', amount: '1000', currencyCode: 'USD' },
  installment: null,
}

test.describe('TC-INV-006: public payment confirmation UX', () => {
  test('previews and confirms a whole-invoice payment', async ({ page }) => {
    let previewReads = 0
    await page.route(`**/api/invoice/payment-confirmations/public/${token}`, async (route) => {
      previewReads += 1
      await route.fulfill({ status: 200, contentType: 'application/json', json: previewReads === 1 ? preview : { ...preview, status: 'CONFIRMED' } })
    })
    await page.route(`**/api/invoice/payment-confirmations/public/${token}/confirm`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', json: { status: 'CONFIRMED' } })
    })

    await page.goto(`/confirm-payment/${token}`)
    await expect(page.getByRole('heading', { name: 'Did you receive this payment?' })).toBeVisible()
    await page.getByRole('button', { name: 'Yes, I received this payment' }).click()
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible()
    expect(previewReads).toBeGreaterThan(1)
  })

  test('renders an invalid link without exposing the token', async ({ page }) => {
    await page.route(`**/api/invoice/payment-confirmations/public/${token}`, async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', json: { error: 'Not found' } })
    })
    await page.goto(`/confirm-payment/${token}`)
    await expect(page.getByRole('heading', { name: 'Link unavailable' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(token)
  })
})
