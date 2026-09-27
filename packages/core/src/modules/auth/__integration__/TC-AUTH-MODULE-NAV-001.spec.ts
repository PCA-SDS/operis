import { expect, test, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';

/**
 * TC-AUTH-MODULE-NAV-001: module switcher in the topbar, one sidebar per module.
 * Source spec: .ai/specs/2026-09-25-module-switcher-and-module-sidebars.md
 *
 * There is no global sidebar. The topbar's module switcher lists the modules the
 * viewer can reach; opening one lands on its first page, where that module's own
 * sidebar lists its pages. The Task Manager keeps its own richer sidebar
 * (`moduleSidebar: false`), so exactly one module navigation renders there.
 * Settings routes show the settings sections in the same sidebar design.
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function openSwitcher(page: Page) {
  await page.getByTestId('module-switcher-trigger').click();
  const menu = page.getByTestId('module-switcher');
  await expect(menu.locator('[data-module-tile]').first()).toBeVisible({ timeout: 30_000 });
  return menu;
}

async function expectNoHorizontalPageScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the page must not scroll sideways').toBeLessThanOrEqual(0);
}

test.describe('TC-AUTH-MODULE-NAV-001: module switcher and module sidebars', () => {
  test('the dashboard has no sidebar, and the switcher opens a module with its own sidebar', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page);
    await page.goto('/backend', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#appshell-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('module-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('module-switcher-current')).toHaveText('Modules');

    const menu = await openSwitcher(page);
    const customersTile = menu.locator('[data-module-tile]').filter({ hasText: /^Customers$/ });
    await expect(customersTile).toHaveCount(1);
    const entryHref = await customersTile.getAttribute('href');
    expect(entryHref, 'a module tile links to its first page').toBeTruthy();
    await customersTile.click();

    await expect(page).toHaveURL((url) => url.pathname === entryHref);
    await expect(menu).toBeHidden();
    const sidebar = page.getByTestId('module-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 30_000 });
    await expect(sidebar).toHaveAttribute('aria-label', 'Customers navigation');
    await expect(sidebar.locator('a[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByTestId('module-switcher-current')).toHaveText('Customers');
    await expectNoHorizontalPageScroll(page);

    const secondLink = sidebar.getByRole('link').nth(1);
    const secondHref = await secondLink.getAttribute('href');
    expect(secondHref).toBeTruthy();
    await secondLink.click();
    await expect(page).toHaveURL((url) => url.pathname === secondHref);
    await expect(sidebar.locator(`a[href="${secondHref}"]`)).toHaveAttribute('aria-current', 'page');
  });

  test('the switcher search filters modules and opens the first match on Enter', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page);
    await page.goto('/backend', { waitUntil: 'domcontentloaded' });

    const menu = await openSwitcher(page);
    await menu.getByRole('searchbox').fill('Tasks');
    await expect(menu.locator('[data-module-tile]').filter({ hasText: /^Tasks$/ })).toHaveCount(1);
    const firstHref = await menu.locator('[data-module-tile]').first().getAttribute('href');
    expect(firstHref).toBeTruthy();
    await menu.getByRole('searchbox').press('Enter');
    await expect(page).toHaveURL((url) => url.pathname === firstHref);
  });

  test('the Task Manager keeps its own sidebar and gets no second one', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page);
    await page.goto('/backend/tasks/today', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('complementary', { name: 'Tasks navigation' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('complementary', { name: 'Tasks navigation' })).toHaveCount(1);
    await expect(page.getByTestId('module-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('module-switcher-current')).toHaveText('Tasks');
  });

  test('settings routes show the settings sections in the module sidebar', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page);
    await page.goto('/backend/sidebar-customization', { waitUntil: 'domcontentloaded' });

    const sidebar = page.getByTestId('module-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 30_000 });
    await expect(sidebar).toHaveAttribute('aria-label', 'Settings navigation');
    await expect(sidebar.locator('a[aria-current="page"]')).toHaveCount(1);
  });

  test('on a phone the switcher still opens modules and the page never scrolls sideways', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await login(page);
    await page.goto('/backend', { waitUntil: 'domcontentloaded' });

    const menu = await openSwitcher(page);
    const customersTile = menu.locator('[data-module-tile]').filter({ hasText: /^Customers$/ });
    const entryHref = await customersTile.getAttribute('href');
    await customersTile.click();
    await expect(page).toHaveURL((url) => url.pathname === entryHref);
    await expect(page.getByTestId('module-sidebar')).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalPageScroll(page);
  });
});
