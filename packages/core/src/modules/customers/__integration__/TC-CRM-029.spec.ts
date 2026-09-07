import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { tableHeaderButton, tableRows } from '@open-mercato/core/modules/core/__integration__/helpers/tableDom';

/**
 * TC-CRM-029: DataTable Column Sorting
 * Verifies that clicking column headers sorts the people list ascending/descending.
 */
test.describe('TC-CRM-029: DataTable Column Sorting', () => {
  test('should sort people list by name when clicking column header', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    const personIds: string[] = [];
    const ts = Date.now();

    try {
      token = await getAuthToken(request);

      for (const [first, last] of [['Zulu', `Sort${ts}`], ['Alpha', `Sort${ts}`]] as const) {
        const createResponse = await apiRequest(request, 'POST', '/api/customers/people', {
          token,
          data: { firstName: first, lastName: last, displayName: `${first} ${last}` },
        });
        expect(createResponse.ok(), `Create person failed: ${await createResponse.text()}`).toBeTruthy();
        const body = (await readJsonSafe<{ id?: unknown }>(createResponse)) ?? {};
        const id = typeof body.id === 'string' ? body.id : null;
        expect(id).toBeTruthy();
        personIds.push(id!);
      }

      await login(page, 'admin');
      await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });

      const searchInput = page.getByPlaceholder(/Search by name/i);
      await searchInput.fill(`Sort${ts}`);
      await page.waitForTimeout(1500);
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      await expect
        .poll(async () => tableRows(page).count(), { timeout: 15000 })
        .toBeGreaterThanOrEqual(2);

      const nameHeader = tableHeaderButton(page, 'Name');
      await expect(nameHeader).toBeVisible();

      await nameHeader.click();
      await page.waitForTimeout(800);
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      const firstRowTextAsc = await tableRows(page).first().textContent();

      await nameHeader.click();
      await page.waitForTimeout(800);
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      const firstRowTextDesc = await tableRows(page).first().textContent();
      expect(firstRowTextDesc).not.toBe(firstRowTextAsc);
    } finally {
      for (const id of personIds) {
        await deleteEntityIfExists(request, token, '/api/customers/people', id);
      }
    }
  });
});
