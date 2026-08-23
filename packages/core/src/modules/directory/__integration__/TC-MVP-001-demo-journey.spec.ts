import { expect, test, type Page, type APIRequestContext } from '@playwright/test'

/**
 * TC-MVP-001 — the demo journey, end to end through the browser.
 *
 * Covers the MVP Definition of Done at the UI layer: platform-superadmin vs
 * tenant-admin separation, module entitlement shaping navigation, protected
 * routes, cross-tenant isolation, and logout.
 *
 * Environment: requires the `yarn seed:dev` topology (Operis / Acme / Globex).
 * The suite SKIPS itself when those accounts are absent, so it is safe to run
 * against a `mercato init` database, which seeds a different topology.
 */

const PASSWORD = process.env.OM_DEV_SEED_PASSWORD || 'Operis!23'
const SUPERADMIN = 'admin@operis.local'
const TENANT_ADMIN = 'admin@acme.local'
const TENANT_USER = 'user@acme.local'
const OTHER_TENANT_ADMIN = 'admin@globex.local'

async function apiLogin(request: APIRequestContext, email: string): Promise<boolean> {
  const response = await request.post('/api/auth/login', {
    form: { email, password: PASSWORD },
  })
  return response.status() === 200
}

async function uiLogin(page: Page, email: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/backend/, { timeout: 60_000 })
}

test.describe('TC-MVP-001: Operis MVP demo journey', () => {
  // Each case signs in through the real login form and loads the backend shell,
  // sometimes for three roles in a row. The suite-wide 20s budget is sized for
  // single-page assertions and is not enough for that, especially against a dev
  // server compiling routes on first hit.
  test.describe.configure({ timeout: 180_000 })

  test.beforeEach(async ({ request }) => {
    const seeded = await apiLogin(request, SUPERADMIN)
    test.skip(!seeded, 'seed:dev topology not present — run `yarn seed:dev`')
  })

  test('platform superadmin reaches tenant administration and sees every tenant', async ({ page }) => {
    await uiLogin(page, SUPERADMIN)

    const tenants = await page.request.get('/api/directory/tenants')
    expect(tenants.status()).toBe(200)
    const body = await tenants.json()
    const names = (body.items ?? []).map((item: { name: string }) => item.name)
    expect(names).toEqual(expect.arrayContaining(['Operis', 'Acme', 'Globex']))

    // The tenants admin page renders rather than 404ing or erroring.
    await page.goto('/backend/directory/tenants', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('body')).not.toContainText('404')
  })

  test('tenant admin cannot reach platform tenant administration', async ({ page }) => {
    await uiLogin(page, TENANT_ADMIN)

    const denied = await page.request.get('/api/directory/tenants')
    expect([401, 403]).toContain(denied.status())

    // Its own organizations remain reachable.
    const allowed = await page.request.get('/api/directory/organizations')
    expect(allowed.status()).toBe(200)
  })

  test('tenant user is denied user management', async ({ page }) => {
    await uiLogin(page, TENANT_USER)
    const denied = await page.request.get('/api/auth/users')
    expect([401, 403]).toContain(denied.status())
  })

  test('module entitlement shapes navigation and API access per tenant', async ({ browser }) => {
    const acme = await browser.newContext()
    const globex = await browser.newContext()
    try {
      await uiLogin(await acme.newPage(), TENANT_ADMIN)
      await uiLogin(await globex.newPage(), OTHER_TENANT_ADMIN)

      // Acme is entitled to wms; Globex is not (withheld by the seed).
      expect((await acme.request.get('/api/wms/warehouses')).status()).toBe(200)
      expect([401, 403]).toContain((await globex.request.get('/api/wms/warehouses')).status())

      const acmeNav = await (await acme.request.get('/api/auth/admin/nav')).json()
      const globexNav = await (await globex.request.get('/api/auth/admin/nav')).json()

      const wmsGrants = (nav: { grantedFeatures?: string[] }) =>
        (nav.grantedFeatures ?? []).filter((feature) => feature.startsWith('wms.')).length
      const customerGrants = (nav: { grantedFeatures?: string[] }) =>
        (nav.grantedFeatures ?? []).filter((feature) => feature.startsWith('customers.')).length
      const wmsNavEntries = (nav: { groups?: unknown }) =>
        (JSON.stringify(nav.groups ?? []).match(/\/backend\/wms/g) ?? []).length

      expect(wmsGrants(acmeNav)).toBeGreaterThan(0)
      expect(wmsGrants(globexNav)).toBe(0)
      expect(wmsNavEntries(acmeNav)).toBeGreaterThan(0)
      expect(wmsNavEntries(globexNav)).toBe(0)
      // Only the withheld module differs — entitlement must not disturb anything else.
      expect(customerGrants(globexNav)).toBe(customerGrants(acmeNav))
    } finally {
      await acme.close()
      await globex.close()
    }
  })

  test('one tenant cannot read another tenant resource by direct id', async ({ browser, request }) => {
    const superadminOk = await apiLogin(request, SUPERADMIN)
    expect(superadminOk).toBe(true)
    const tenants = await (await request.get('/api/directory/tenants')).json()
    const globexTenant = (tenants.items ?? []).find((item: { name: string }) => item.name === 'Globex')
    expect(globexTenant).toBeTruthy()

    const acme = await browser.newContext()
    try {
      await uiLogin(await acme.newPage(), TENANT_ADMIN)
      const organizations = await acme.request.get('/api/directory/organizations')
      const payload = await organizations.text()
      // Acme's organization listing must not contain Globex's tenant id.
      expect(payload).not.toContain(globexTenant.id)
    } finally {
      await acme.close()
    }
  })

  test('logout ends the session', async ({ page }) => {
    await uiLogin(page, TENANT_ADMIN)
    expect((await page.request.get('/api/directory/organizations')).status()).toBe(200)

    await page.request.post('/api/auth/logout')
    const afterLogout = await page.request.get('/api/directory/organizations')
    expect([401, 403]).toContain(afterLogout.status())
  })

  test('the backend shell loads for every seeded role without a page error', async ({ browser }) => {
    for (const email of [SUPERADMIN, TENANT_ADMIN, TENANT_USER]) {
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        const pageErrors: string[] = []
        page.on('pageerror', (error) => pageErrors.push(`${email}: ${error.message}`))

        await uiLogin(page, email)
        await expect(page.locator('body')).not.toContainText('Application error')
        expect(pageErrors).toEqual([])
      } finally {
        await context.close()
      }
    }
  })
})
