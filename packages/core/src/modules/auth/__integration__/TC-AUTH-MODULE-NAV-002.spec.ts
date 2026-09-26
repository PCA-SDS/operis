import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';

/**
 * TC-AUTH-MODULE-NAV-002: rearranging modules in the module switcher.
 * Source spec: .ai/specs/2026-09-25-module-switcher-and-module-sidebars.md ("Reorder").
 *
 * A viewer holding `auth.sidebar.manage` drags module tiles to rearrange them. The
 * order is the personal sidebar preference's `groupOrder`, saved through
 * `PUT /api/auth/sidebar/preferences`, so it must survive a reload. A drag must not
 * open the module it started on, Escape cancels a keyboard drag without closing the
 * switcher, and "Reset order" removes only the module positions. A viewer without
 * the feature gets plain links and no reorder controls.
 *
 * Each test restores the admin's preference record it found, so the suite leaves no
 * trace in the shared environment.
 */

const DESKTOP = { width: 1440, height: 900 };
const PREFERENCES_API = '/api/auth/sidebar/preferences';

type SidebarSettings = {
  version: number;
  groupOrder: string[];
  groupLabels: Record<string, string>;
  itemLabels: Record<string, string>;
  hiddenItems: string[];
  itemOrder: Record<string, string[]>;
};

type PreferencesSnapshot = { settings: SidebarSettings; updatedAt: string | null };

type PreferencesClient = { request: APIRequestContext; token: string };

async function readPreferences({ request, token }: PreferencesClient): Promise<PreferencesSnapshot> {
  const response = await apiRequest(request, 'GET', PREFERENCES_API, { token });
  expect(response.ok(), 'the preference record should be readable').toBeTruthy();
  const body = (await response.json()) as { settings: SidebarSettings; updatedAt: string | null };
  return { settings: body.settings, updatedAt: body.updatedAt };
}

async function writePreferences({ request, token }: PreferencesClient, settings: SidebarSettings): Promise<void> {
  const response = await apiRequest(request, 'PUT', PREFERENCES_API, { token, data: settings });
  expect(response.ok(), 'restoring the preference record should succeed').toBeTruthy();
}

/**
 * Puts the admin's record back. With no record before the test, the switcher's own
 * first save created one, so the closest restore is what "Reset order" writes: the
 * same record without module positions.
 */
async function restorePreferences(
  client: PreferencesClient,
  original: PreferencesSnapshot,
  moduleKeys: string[],
): Promise<void> {
  if (original.updatedAt) {
    await writePreferences(client, original.settings);
    return;
  }
  const current = await readPreferences(client);
  if (!current.updatedAt) return;
  const modules = new Set(moduleKeys);
  await writePreferences(client, {
    ...current.settings,
    groupOrder: current.settings.groupOrder.filter((key) => !modules.has(key)),
  });
}

async function openSwitcher(page: Page): Promise<Locator> {
  await page.getByTestId('module-switcher-trigger').click();
  const menu = page.getByTestId('module-switcher');
  await expect(menu.locator('[data-module-tile]').first()).toBeVisible({ timeout: 30_000 });
  return menu;
}

async function tileOrder(menu: Locator): Promise<string[]> {
  return menu.locator('[data-module-tile]').evaluateAll((tiles) =>
    tiles.map((tile) => tile.getAttribute('data-module-id') ?? ''),
  );
}

function moved(keys: string[], from: number, to: number): string[] {
  const next = [...keys];
  const [key] = next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

function waitForOrderSave(page: Page) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === PREFERENCES_API && response.request().method() === 'PUT',
    { timeout: 30_000 },
  );
}

/**
 * dnd-kit starts listening for arrow, Escape and drop keys one task after a keyboard
 * pick-up, so keys sent back to back can land before it listens. These helpers pace
 * the keyboard like a person: each key waits for the previous one to take effect, and
 * Escape or Space are only sent while a move is active, so a retry can never close the
 * switcher or pick a module up again.
 */
async function pickUp(tile: Locator, list: Locator): Promise<void> {
  await tile.focus();
  await tile.press('Space');
  await expect(list).toHaveAttribute('data-dragging', 'true');
}

async function moveUntilAnnounced(page: Page, key: string, announcement: RegExp): Promise<void> {
  const liveRegion = page.locator('[id^="DndLiveRegion"]');
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(liveRegion).toHaveText(announcement, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function endMove(page: Page, list: Locator, key: 'Escape' | 'Space'): Promise<void> {
  await expect(async () => {
    if ((await list.getAttribute('data-dragging')) === 'true') await page.keyboard.press(key);
    await expect(list).not.toHaveAttribute('data-dragging', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function dragTile(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('[internal] tile has no box');
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 4, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();
}

test.describe('TC-AUTH-MODULE-NAV-002: rearranging modules in the switcher', () => {
  test('a mouse drag rearranges the modules without opening one, and the order survives a reload', async ({ page, request }) => {
    test.slow();
    const client = { request, token: await getAuthToken(request, 'admin') };
    await page.setViewportSize(DESKTOP);
    await login(page);
    await page.goto('/backend', { waitUntil: 'domcontentloaded' });
    const original = await readPreferences(client);

    const menu = await openSwitcher(page);
    await expect(menu.getByTestId('module-switcher-footer')).toContainText('Drag to rearrange');
    const before = await tileOrder(menu);
    expect(before.length, 'the admin should reach at least three modules').toBeGreaterThanOrEqual(3);

    try {
      const tiles = menu.locator('[data-module-tile]');
      const saved = waitForOrderSave(page);
      await dragTile(page, tiles.nth(0), tiles.nth(2));
      const expected = moved(before, 0, 2);

      await expect.poll(() => tileOrder(menu), { message: 'the new order should show at once' }).toEqual(expected);
      expect((await saved).ok(), 'the order should save').toBeTruthy();
      await expect(menu, 'a drag must not close the switcher').toBeVisible();
      await expect(page, 'a drag must not open the module it started on').toHaveURL(/\/backend$/);
      await expect(menu.getByTestId('module-switcher-reset')).toBeVisible();

      await page.reload({ waitUntil: 'domcontentloaded' });
      const reopened = await openSwitcher(page);
      await expect.poll(() => tileOrder(reopened), { message: 'the order should survive a reload', timeout: 30_000 }).toEqual(expected);

      const reset = waitForOrderSave(page);
      await reopened.getByTestId('module-switcher-reset').click();
      const resetRequest = (await reset).request();
      const resetOrder = (resetRequest.postDataJSON() as SidebarSettings).groupOrder;
      expect(resetOrder.filter((key) => before.includes(key)), 'reset should remove only the module positions').toEqual([]);
      await expect(reopened.getByTestId('module-switcher-reset')).toBeHidden({ timeout: 30_000 });
    } finally {
      await restorePreferences(client, original, before);
    }
  });

  test('the keyboard moves a module, and Escape cancels a move without closing the switcher', async ({ page, request }) => {
    test.slow();
    const client = { request, token: await getAuthToken(request, 'admin') };
    await page.setViewportSize(DESKTOP);
    await login(page);
    await page.goto('/backend', { waitUntil: 'domcontentloaded' });
    const original = await readPreferences(client);

    const menu = await openSwitcher(page);
    const before = await tileOrder(menu);
    const list = menu.getByRole('list', { name: 'Modules' });
    const tile = (key: string) => menu.locator(`[data-module-id="${key}"]`);

    try {
      await pickUp(tile(before[0]), list);
      await moveUntilAnnounced(page, 'ArrowRight', /moved to position 2 of/);
      await endMove(page, list, 'Escape');
      await expect(menu, 'Escape should cancel the move, not close the switcher').toBeVisible();
      expect(await tileOrder(menu), 'a cancelled move leaves the order as it was').toEqual(before);

      const saved = waitForOrderSave(page);
      await pickUp(tile(before[0]), list);
      await moveUntilAnnounced(page, 'ArrowRight', /moved to position 2 of/);
      await endMove(page, list, 'Space');
      expect((await saved).ok(), 'the keyboard move should save').toBeTruthy();
      await expect.poll(() => tileOrder(menu)).toEqual(moved(before, 0, 1));
      await expect(menu).toBeVisible();
    } finally {
      await restorePreferences(client, original, before);
    }
  });

  test('a viewer without auth.sidebar.manage gets plain links and no reorder controls', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page, 'employee');
    await page.goto('/backend', { waitUntil: 'domcontentloaded' });

    await page.getByTestId('module-switcher-trigger').click();
    const menu = page.getByTestId('module-switcher');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[aria-busy="true"]'), 'wait for the navigation to load').toHaveCount(0, { timeout: 30_000 });
    await expect(menu.getByTestId('module-switcher-footer')).toHaveCount(0);
    const describedTiles = menu.locator('[data-module-tile][aria-describedby]');
    await expect(describedTiles, 'tiles carry no drag instructions without the feature').toHaveCount(0);
  });
});
