// Reports bounding boxes (as % of the 1600x1000 capture viewport) for the
// elements the demo cursor points at, so the composition can land on real UI.
import { chromium } from 'playwright'

const BASE = process.env.OPERIS_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.OPERIS_DEMO_EMAIL ?? 'admin@companya.local'
const PASSWORD = process.env.OPERIS_DEMO_PASSWORD ?? 'Operis!23'

const ORDER_ID = 'bd219631-b767-4c8b-be88-1651f4058f54'

const probes = [
  { scene: '02-companies', url: '/backend/customers/companies', text: 'Brightside Solar' },
  { scene: '03-company-360', url: `/backend/customers/companies-v2/5b593912-7c62-4611-8c87-4d8c68c514aa`, text: '$267,000' },
  { scene: '05-deals-list', url: '/backend/customers/deals', text: 'Pipeline value' },
  { scene: '06-catalog', url: '/backend/catalog/products', text: 'Atlas Runner Sneaker' },
  { scene: '09-orders', url: '/backend/sales/orders', text: 'SO-DEMO-2003' },
  { scene: '10-order-items', url: `/backend/sales/orders/${ORDER_ID}`, text: 'Shipments' },
  { scene: '10-order-totals', url: `/backend/sales/orders/${ORDER_ID}`, text: 'GRAND TOTAL (GROSS)' },
  { scene: '11-order-shipments', url: `/backend/sales/orders/${ORDER_ID}`, text: 'Payments' },
  { scene: '14-workflows', url: '/backend/definitions', text: 'Sales Pipeline - Order to Fulfillment' },
  { scene: '16-rules', url: '/backend/rules', text: 'Minimum Order Amount' },
]

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.fill('input[type="email"]', EMAIL)
await page.fill('input[type="password"]', PASSWORD)
await Promise.all([
  page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120000 }),
  page.click('button[type="submit"]'),
])
await page.waitForTimeout(4000)

const results = {}
for (const probe of probes) {
  try {
    await page.goto(`${BASE}${probe.url}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(2800)
    const locator = page.getByText(probe.text, { exact: false }).first()
    const box = await locator.boundingBox({ timeout: 10000 })
    if (!box) throw new Error('no box')
    results[probe.scene] = {
      text: probe.text,
      xPct: +(((box.x + box.width / 2) / 1600) * 100).toFixed(2),
      yPct: +(((box.y + box.height / 2) / 1000) * 100).toFixed(2),
      wPct: +((box.width / 1600) * 100).toFixed(2),
      hPct: +((box.height / 1000) * 100).toFixed(2),
    }
  } catch (error) {
    results[probe.scene] = { text: probe.text, error: error.message.split('\n')[0] }
  }
}

console.log(JSON.stringify(results, null, 2))
await browser.close()
