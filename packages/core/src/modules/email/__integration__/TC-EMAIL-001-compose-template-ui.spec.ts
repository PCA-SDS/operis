import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-EMAIL-001: Email template compose UI', () => {
  test('exposes template management and copy-only compose surfaces', async ({ page }) => {
    await login(page, 'admin')

    await page.goto('/backend/email/templates', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Email Templates' })).toBeVisible()
    await expect(page.getByRole('link', { name: /new template/i })).toBeVisible()

    await page.goto('/backend/email/templates/create', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Create Email Template' })).toBeVisible()
    await expect(page.getByText('When to use this template').first()).toBeVisible()
    await expect(page.getByText('Rule notes').first()).toBeVisible()
    await expect(page.getByText('Custom variables').first()).toBeVisible()
    await expect(page.getByText('Live preview').first()).toBeVisible()

    await page.goto('/backend/email/compose', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Compose Email' })).toBeVisible()
    await expect(page.getByText('Template').first()).toBeVisible()
    await expect(page.getByText('Company').first()).toBeVisible()
    await expect(page.getByText('This does not send email').first()).toBeVisible()
    await expect(page.getByText('Live preview').first()).toBeVisible()
    await expect(page.getByText('Create draft')).toHaveCount(0)
  })
})
