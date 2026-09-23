import { expect, test, type Page } from '@playwright/test'

const jobId = '00000000-0000-0000-0000-000000000051'
const progressJobId = '00000000-0000-0000-0000-000000000052'
const summary = { currency: 'VND', ar: { outstandingAmount: '1200', settledAmount: '0' }, ap: { outstandingAmount: '800', settledAmount: '0' }, netPosition: '400', ratesStale: false }
const forecast = { currency: 'VND', ratesStale: false, today: '2026-09-01', horizonDays: 365, entries: [], receivable: { overdue: { amount: '0', count: 0 }, undated: { amount: '0', count: 0 }, beyondHorizon: { amount: '0', count: 0 }, points: [] }, payable: { overdue: { amount: '0', count: 0 }, undated: { amount: '0', count: 0 }, beyondHorizon: { amount: '0', count: 0 }, points: [] }, net: { points: [] }, series: [], totals: { arAmount: '0', apAmount: '0', netAmount: '400' } }
const counts = { processed: 0, imported: 0, updated: 0, skipped: 0, errors: 0 }

async function mockDashboard(page: Page): Promise<void> {
  await page.route('**/api/invoice/summary', (route) => route.fulfill({ status: 200, json: summary }))
  await page.route('**/api/invoice/forecast**', (route) => route.fulfill({ status: 200, json: forecast }))
  await page.route('**/api/invoice/invoices?**', (route) => route.fulfill({ status: 200, json: { items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 } }))
}

test.describe('TC-INV-005: GDT sync UI lifecycle', () => {
  test('runs availability, CAPTCHA authentication, progress, and completion', async ({ page }) => {
    await mockDashboard(page)
    let availabilityReads = 0
    let statusReads = 0
    let startBody: Record<string, unknown> | null = null
    let authBody: Record<string, unknown> | null = null
    await page.route('**/api/invoice/sync', async (route) => {
      if (route.request().method() === 'POST') {
        startBody = route.request().postDataJSON()
        await route.fulfill({ status: 200, json: { state: 'auth_required', transactionId: '00000000-0000-0000-0000-000000000053', captchaSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } })
        return
      }
      availabilityReads += 1
      await route.fulfill({ status: 200, json: { canSync: true, reason: 'ok', taxCode: '0123456789', latestJob: null } })
    })
    await page.route('**/api/invoice/sync/authenticate', async (route) => {
      authBody = route.request().postDataJSON()
      await route.fulfill({ status: 202, json: { state: 'queued', job: { jobId, state: 'QUEUED', progress: 0, counts, failureCategory: null, failureMessage: null, progressJobId, updatedAt: '2026-09-14T00:00:00.000Z', finishedAt: null } } })
    })
    await page.route(`**/api/invoice/sync/${jobId}`, async (route) => {
      statusReads += 1
      const done = statusReads > 1
      await route.fulfill({ status: 200, json: { jobId, state: done ? 'DONE' : 'FETCHING', progress: done ? 100 : 45, counts: done ? { processed: 5, imported: 2, updated: 1, skipped: 1, errors: 1 } : counts, failureCategory: null, failureMessage: null, progressJobId, updatedAt: '2026-09-14T00:01:00.000Z', finishedAt: done ? '2026-09-14T00:01:00.000Z' : null } })
    })

    await page.goto('/backend/invoice')
    await page.getByRole('button', { name: /sync from tax portal/i }).click()
    await page.getByLabel(/from date/i).fill('2026-09-01')
    await page.getByLabel(/to date/i).fill('2026-09-14')
    await page.getByRole('checkbox').nth(0).click()
    await page.getByRole('checkbox').nth(1).click()
    await page.getByRole('button', { name: /continue/i }).click()
    expect(startBody).toMatchObject({ fromDate: '2026-09-01', toDate: '2026-09-14', acknowledgements: { dueDatesRequireConfiguration: true, settlementIsManual: true } })
    await page.getByLabel(/tax portal password/i).fill('one-use-password')
    await page.getByLabel(/^captcha$/i).fill('AB12')
    await page.getByRole('button', { name: /sign in and sync/i }).click()
    expect(authBody).toMatchObject({ password: 'one-use-password', captchaSolution: 'AB12' })
    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('5', { exact: true })).toBeVisible()
    await expect(page.getByLabel(/tax portal password/i)).toHaveCount(0)
    expect(availabilityReads).toBeGreaterThan(0)
  })

  test('reopens the latest failed sync and shows the classified failure', async ({ page }) => {
    await mockDashboard(page)
    await page.route('**/api/invoice/sync', (route) => route.fulfill({ status: 200, json: { canSync: true, reason: 'ok', taxCode: '0123456789', latestJob: { jobId, state: 'FAILED', progress: 35, counts: { processed: 4, imported: 1, updated: 0, skipped: 2, errors: 1 }, failureCategory: 'PORTAL_UNREACHABLE', failureMessage: 'The tax portal could not be reached.', progressJobId, updatedAt: '2026-09-14T00:01:00.000Z', finishedAt: '2026-09-14T00:01:00.000Z' } } }))
    await page.goto('/backend/invoice')
    await page.getByRole('button', { name: /sync from tax portal/i }).click()
    await expect(page.getByText(/tax portal unavailable/i)).toBeVisible()
    await expect(page.getByText(/could not be reached/i)).toBeVisible()
    await expect(page.getByText('2', { exact: true })).toBeVisible()
  })
})
