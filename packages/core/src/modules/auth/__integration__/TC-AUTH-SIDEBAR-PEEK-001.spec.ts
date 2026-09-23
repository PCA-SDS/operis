import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';

/**
 * TC-AUTH-SIDEBAR-PEEK-001: the desktop sidebar starts collapsed and opens over
 * the page on hover.
 *
 * Collapsed is the default when no `om_sidebar_collapsed` preference exists. A
 * hover widens the rail on the top layer without moving the content column —
 * the page is overlaid, not squeezed — and leaving closes it. The toggle pins it
 * open, which is the only state that gives the rail its own full column.
 */

const DESKTOP = { width: 1440, height: 900 };
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('backend sidebar hover peek', () => {
  test('starts collapsed and overlays the page on hover', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page);
    await page.context().clearCookies({ name: 'om_sidebar_collapsed' });
    await page.goto(`${BASE_URL}/backend`, { waitUntil: 'domcontentloaded' });

    const aside = page.locator('#appshell-sidebar');
    const column = page.locator('[data-app-shell-column]');
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 30_000 });
    await expect(aside).toHaveAttribute('data-collapsed', 'true');
    const width = () => aside.evaluate((node) => Math.round(node.getBoundingClientRect().width));
    const columnLeft = () => column.evaluate((node) => Math.round(node.getBoundingClientRect().left));
    expect(await width()).toBe(69);
    const collapsedColumnLeft = await columnLeft();

    await aside.hover({ position: { x: 34, y: 300 } });
    await expect(aside).toHaveAttribute('data-peek', 'true');
    await expect.poll(width).toBe(272);
    expect(await columnLeft()).toBe(collapsedColumnLeft);
    expect(await aside.evaluate((node) => Number(getComputedStyle(node).zIndex))).toBeGreaterThanOrEqual(100);

    await page.mouse.move(DESKTOP.width - 40, DESKTOP.height / 2);
    await expect(aside).toHaveAttribute('data-peek', 'false');
    await expect.poll(width).toBe(69);
  });

  test('pinning gives the rail its own column', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page);
    await page.context().clearCookies({ name: 'om_sidebar_collapsed' });
    await page.goto(`${BASE_URL}/backend`, { waitUntil: 'domcontentloaded' });

    const aside = page.locator('#appshell-sidebar');
    await expect(aside).toHaveAttribute('data-collapsed', 'true', { timeout: 30_000 });
    await page.getByTestId('appshell-sidebar-toggle').click();
    await expect(aside).toHaveAttribute('data-collapsed', 'false');
    await expect
      .poll(() => page.locator('[data-app-shell-column]').evaluate((node) => Math.round(node.getBoundingClientRect().left)))
      .toBe(272);
  });
});
