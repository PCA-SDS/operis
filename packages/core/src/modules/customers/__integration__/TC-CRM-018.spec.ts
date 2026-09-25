import { expect, test, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui';

/**
 * TC-CRM-018: Person Display Name Follows The Name Fields, With Undo
 *
 * people-v2 no longer carries a display-name preview or an "Edit name" override
 * (2026-09-24 detail-page strip-down, see
 * .ai/specs/2026-09-24-customer-detail-ui-consistency.md). The page omits an
 * unchanged displayName from the update, so the server re-derives a derived name
 * from first/last name. This proves a last-name edit round-trips to the stored
 * display name and that the operation banner's Undo reverts it.
 */

/**
 * The CrudForm lives inside a `CollapsibleZoneLayout` that starts collapsed to an
 * icon rail at the default 1280px viewport (mirrors `openPersonFormLastNameInput`
 * in TC-LOCK-OSS-015).
 */
async function openLastNameInput(page: Page) {
  const lastNameInput = page.locator('[data-crud-field-id="lastName"] input:visible').first();
  if (!(await lastNameInput.isVisible().catch(() => false))) {
    const expandPanel = page.getByRole('button', { name: /expand form panel/i });
    await expect(expandPanel).toBeVisible({ timeout: 15_000 });
    await expandPanel.click();
  }
  await expect(lastNameInput).toBeVisible({ timeout: 15_000 });
  await expect(lastNameInput).not.toHaveValue('', { timeout: 15_000 });
  return lastNameInput;
}

async function saveForm(page: Page) {
  const saveButton = page.getByRole('button', { name: /^save$/i }).first();
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  await saveButton.click();
}

test.describe('TC-CRM-018: Person Display Name Follows The Name Fields', () => {
  test('should re-derive the display name from a last-name edit and undo it', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      const stamp = Date.now();
      const originalLastName = `TCCRM018 ${stamp}`;
      const originalName = `QA ${originalLastName}`;
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-018 Company ${stamp}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: originalLastName,
        displayName: originalName,
        companyEntityId: companyId,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people-v2/${personId}`);

      await expect(page.getByText(/display name preview/i)).toHaveCount(0);
      const input = await openLastNameInput(page);
      const updatedLastName = `${originalLastName} Edited`;
      const updatedName = `QA ${updatedLastName}`;
      await fillControlledInput(input, updatedLastName);
      await saveForm(page);

      // Read the persisted value from the server rather than the form the edit was
      // typed into — the original v1 assertion could pass on local state alone.
      const readPersistedDisplayName = async (): Promise<string> => {
        const response = await apiRequest(
          request,
          'GET',
          `/api/customers/people/${encodeURIComponent(personId as string)}`,
          { token: token as string },
        );
        if (!response.ok()) return '';
        const body = (await readJsonSafe(response)) as { person?: { displayName?: string } } | null;
        return (body?.person?.displayName ?? '').replace(/\s+/g, ' ').trim();
      };

      await expect.poll(readPersistedDisplayName, { timeout: 15_000 }).toBe(updatedName);

      await page.getByRole('button', { name: /^Undo(?: last action)?$/ }).click();
      await expect.poll(readPersistedDisplayName, { timeout: 15_000 }).toBe(originalName);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
