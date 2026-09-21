// Captures real Operis backend screens for the product demo video.
// Usage: node brag-output/tools/capture.mjs [sceneId ...]
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.OPERIS_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.OPERIS_DEMO_EMAIL ?? 'admin@companya.local'
const PASSWORD = process.env.OPERIS_DEMO_PASSWORD ?? 'Operis!23'
const OUT = path.resolve(process.cwd(), 'brag-output/captures')

const ORDER_ID = 'bd219631-b767-4c8b-be88-1651f4058f54'
const COMPANY_ID = '5b593912-7c62-4611-8c87-4d8c68c514aa'
const PRODUCT_ID = '2abf8c90-aba5-44cb-b3e6-318575ec29c1'

const scenes = [
  { id: '01-dashboard', url: '/backend', settle: 2500 },
  { id: '02-companies', url: '/backend/customers/companies', settle: 2500 },
  { id: '03-company-360', url: `/backend/customers/companies-v2/${COMPANY_ID}`, settle: 2800 },
  { id: '04-pipeline', url: '/backend/customers/deals/pipeline', settle: 3000 },
  { id: '05-deals-list', url: '/backend/customers/deals', settle: 2500 },
  { id: '06-catalog', url: '/backend/catalog/products', settle: 2500 },
  { id: '07-product', url: `/backend/catalog/products/${PRODUCT_ID}`, settle: 2800 },
  { id: '08-quotes', url: '/backend/sales/quotes', settle: 2500 },
  { id: '09-orders', url: '/backend/sales/orders', settle: 2500 },
  { id: '10-order-items', url: `/backend/sales/orders/${ORDER_ID}`, settle: 3000 },
  { id: '11-order-shipments', url: `/backend/sales/orders/${ORDER_ID}`, settle: 2500, tab: 'Shipments' },
  { id: '12-order-payments', url: `/backend/sales/orders/${ORDER_ID}`, settle: 2500, tab: 'Payments' },
  { id: '13-order-history', url: `/backend/sales/orders/${ORDER_ID}`, settle: 2500, tab: 'History' },
  { id: '14-workflows', url: '/backend/definitions', settle: 2500 },
  { id: '15-workflow-editor', url: '/backend/definitions/visual-editor', settle: 4000 },
  { id: '16-rules', url: '/backend/rules', settle: 2500 },
  { id: '17-tasks', url: '/backend/tasks/all', settle: 2500 },
  { id: '18-calendar', url: '/backend/calendar', settle: 3000 },
  { id: '19-wms', url: '/backend/wms/inventory', settle: 2500 },
  { id: '20-invoices', url: '/backend/invoice/all', settle: 2500 },
  { id: '21-org-chart', url: '/backend/staff/org-chart', settle: 3000 },
  { id: '22-channels', url: '/backend/sales/channels', settle: 2500 },
]

// Strips anything that would read as a mistake, a dev artifact, or noise on screen.
const CLEANUP = `
  const kill = (sel) => document.querySelectorAll(sel).forEach((n) => n.remove());
  kill('[data-nextjs-toast]');
  kill('nextjs-portal');
  kill('[role="status"][aria-live]');
  document.querySelectorAll('[role="alert"], [data-slot="alert"]').forEach((n) => {
    const text = (n.textContent || '').toLowerCase();
    if (text.includes('index') || text.includes('incomplete') || text.includes('cookie')) n.remove();
  });
  document.querySelectorAll('*').forEach((n) => {
    const text = (n.textContent || '').trim();
    if (text === 'Accept cookies' || text === 'Dismiss') {
      const banner = n.closest('div[class*="fixed"]');
      if (banner) banner.remove();
    }
  });
  // Freeze caret/hover artifacts and disable animation so frames are deterministic.
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation-play-state:paused !important;transition:none !important;caret-color:transparent !important}';
  document.head.appendChild(style);
`

async function settle(page, ms) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(CLEANUP).catch(() => {})
  await page.waitForTimeout(ms)
  await page.evaluate(CLEANUP).catch(() => {})
}

async function main() {
  const only = process.argv.slice(2)
  const todo = only.length ? scenes.filter((s) => only.includes(s.id)) : scenes
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] })
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  })
  const page = await context.newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.evaluate(CLEANUP).catch(() => {})
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 120000 }),
    page.click('button[type="submit"]'),
  ])
  await settle(page, 4000)
  console.log('signed in')

  for (const scene of todo) {
    try {
      await page.goto(`${BASE}${scene.url}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await settle(page, scene.settle)
      if (scene.tab) {
        const tab = page.getByRole('tab', { name: scene.tab }).first()
        const fallback = page.getByText(scene.tab, { exact: true }).first()
        const target = (await tab.count()) ? tab : fallback
        await target.click({ timeout: 15000 }).catch(() => {})
        await settle(page, 1800)
      }
      const file = path.join(OUT, `${scene.id}.png`)
      await page.screenshot({ path: file })
      console.log(`captured ${scene.id}`)
    } catch (error) {
      console.error(`FAILED ${scene.id}: ${error.message}`)
    }
  }

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
