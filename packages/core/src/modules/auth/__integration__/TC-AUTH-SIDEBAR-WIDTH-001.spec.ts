import { expect, test, type Page } from '@playwright/test';

/**
 * TC-AUTH-SIDEBAR-WIDTH-001: the rail fits its labels and never scrolls sideways.
 *
 * Two failures this locks down, both of which only exist once the nav is laid out
 * by a real engine — jsdom has no layout, so unit tests cannot see either:
 *
 * 1. Truncation. The rail was 240px, which left a 160px label box, and real page
 *    titles ("User Notification Preferences", "Create Workflow Definition") were
 *    ellipsed. `truncate` is deliberate — it is the guard for a pathological
 *    title — but it must not be what a normal nav looks like, so this asserts no
 *    rendered row is actually overflowing its box.
 * 2. Horizontal scroll. The nav's scroll container set only `overflow-y`, which
 *    computes the x axis from `visible` to `auto`; anything overhanging the rail
 *    turned it into a sideways-scrolling box. `scrollWidth <= clientWidth` is the
 *    assertion that cannot be satisfied by accident.
 *
 * It also pins the one-x alignment the rail's geometry exists to produce: every
 * row icon, at either depth, starts on the same pixel column.
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function login(page: Page): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  await page.context().addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
  ]);
  await page.goto('/login');
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });
  await page.getByLabel('Email').fill('admin@acme.com');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('secret');
  await password.press('Enter');
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/);
}

/** Rows whose label element is wider than the box painting it — i.e. actually ellipsed. */
async function truncatedLabels(page: Page): Promise<string[]> {
  return page.getByTestId('sidebar').evaluate((nav) => {
    const clipped: string[] = [];
    for (const link of Array.from(nav.querySelectorAll('a'))) {
      const label = link.querySelector('span:last-of-type');
      if (!(label instanceof HTMLElement)) continue;
      // 1px of tolerance: sub-pixel text metrics round against us on some engines.
      if (label.scrollWidth > label.clientWidth + 1) clipped.push(label.textContent ?? '');
    }
    return clipped;
  });
}

test.describe('backend sidebar width and alignment', () => {
  test('fits every nav label and never scrolls horizontally', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page);

    const aside = page.locator('aside').first();
    await expect(aside).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 30_000 });

    // The rail is the fixed column AppShell declares, and the grid column beside
    // it is driven from the same custom property — so measuring the aside proves
    // both.
    expect(await aside.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(304);

    const scroller = page.locator('[data-sidebar-scroll="true"]').first();
    const overflow = await scroller.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      overflowX: getComputedStyle(node).overflowX,
    }));
    expect(overflow.overflowX).toBe('hidden');
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    expect(await truncatedLabels(page)).toEqual([]);
  });

  test('starts every row icon on one x, at both depths', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page);
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 30_000 });

    const iconLefts = await page.getByTestId('sidebar').evaluate((nav) => {
      const lefts = new Set<number>();
      for (const link of Array.from(nav.querySelectorAll('a'))) {
        const icon = link.querySelector('span');
        if (icon instanceof HTMLElement) lefts.add(Math.round(icon.getBoundingClientRect().left));
      }
      return [...lefts].sort((a, b) => a - b);
    });

    // Top-level rows and their children sit on two columns by design — the child
    // indent is the only depth cue — and nothing may land between or beyond them.
    expect(iconLefts.length).toBeLessThanOrEqual(2);
    expect(iconLefts[0]).toBe(24);
    if (iconLefts.length === 2) expect(iconLefts[1]).toBe(36);
  });

  test('mobile drawer puts its chrome on the same x as its nav', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await login(page);

    await page.getByRole('button', { name: /open menu/i }).click();
    const drawer = page.locator('aside').filter({ has: page.getByTestId('sidebar') }).last();
    await expect(drawer).toBeVisible({ timeout: 30_000 });

    const brandLogoLeft = await drawer
      .locator('a[aria-label]')
      .first()
      .evaluate((node) => Math.round(node.getBoundingClientRect().left));
    // Scoped to the drawer: the desktop rail is still in the DOM at this width
    // (`hidden lg:block`), and an unscoped lookup measures that hidden nav at 0.
    const firstIconLeft = await drawer
      .getByTestId('sidebar')
      .locator('a span')
      .first()
      .evaluate((node) => Math.round(node.getBoundingClientRect().left));

    // The drawer's brand row sits outside the nav's own gutter, so it carries the
    // full 24px inset itself; both therefore land on 24.
    expect(brandLogoLeft).toBe(24);
    expect(firstIconLeft).toBe(24);
  });
});
