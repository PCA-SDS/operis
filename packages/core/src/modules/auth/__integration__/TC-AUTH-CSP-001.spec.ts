import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

export const integrationMeta = { dependsOnModules: ['auth'] }

/**
 * TC-AUTH-CSP-001: the production Content-Security-Policy must not break the app.
 *
 * `script-src` drops `'unsafe-eval'` outside development. A browser reports any
 * blocked script as a "Refused to ..." console error, so collecting console
 * output across the heaviest surfaces is a direct read on whether the policy
 * costs anything at runtime.
 */
const CSP_ERROR = /Refused to (evaluate|execute|load|apply|create|connect|frame)|Content Security Policy/i

function collectCspErrors(page: Page): string[] {
  const found: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    const text = message.text()
    if (CSP_ERROR.test(text)) found.push(text)
  })
  page.on('pageerror', (error) => {
    if (CSP_ERROR.test(error.message)) found.push(error.message)
  })
  return found
}

test.describe('TC-AUTH-CSP-001: production content security policy', () => {
test('blocks nothing the app actually needs', async ({ page }) => {
  test.setTimeout(180_000)
  const violations = collectCspErrors(page)

  // Unauthenticated first — the login form runs before any session exists.
  // No `networkidle`: the shell holds an SSE connection open, so the network
  // never goes idle and the wait would burn the whole budget.
  await page.goto('/login')
  await expect(page.locator('form[data-auth-ready="1"]')).toBeVisible({ timeout: 30_000 })

  await login(page, 'admin')

  // The surfaces that would break first if scripts were refused: the shell and
  // its charts, a DataTable, a CrudForm, and a dialog.
  for (const path of [
    '/backend',
    '/backend/customers/companies',
    '/backend/tasks/today',
    '/backend/catalog/products',
    '/backend/users',
  ]) {
    await page.goto(path)
    // Hydration actually ran: the rail is rendered by client React, so seeing it
    // proves scripts executed rather than just that HTML arrived. Matched by
    // landmark, not by test id — a settings-scoped page swaps in its own nav,
    // which does not carry the main navigation's id.
    await expect(page.getByRole('complementary').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1500)
  }

  expect(violations, `CSP refused something the app needs:\n${violations.join('\n')}`).toEqual([])
})
})
