import { expect, test, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui';

/**
 * TC-CRM-018: Person Display Name Edit And Undo
 *
 * Rewritten for people-v2. The original drove v1's per-field inline editor — click
 * a `Display name <value>` summary button, then a per-field `Save`. v2 replaced
 * that with a single CrudForm and one header Save (SPEC-046), and display name
 * became a derived preview behind an "Edit name" toggle. The interaction changed;
 * what this asserts did not. It still proves the edit round-trips to the server
 * and that the operation banner's Undo reverts it.
 */

/**
 * Reveal the editable display-name input on people-v2.
 *
 * Two things differ from v1. The CrudForm lives inside a `CollapsibleZoneLayout`
 * that starts collapsed to an icon rail at the default 1280px viewport, so the
 * form mounts hidden until "Expand form panel" is clicked (mirrors
 * `openPersonFormLastNameInput` in TC-LOCK-OSS-015). And display name is not a
 * plain field: it renders as a read-only "Display name preview" derived from
 * first/last name, with an "Edit name" button that swaps in an input and marks
 * the value as a manual override.
 */
async function openDisplayNameInput(page: Page) {
  const previewLabel = page.getByText(/display name preview/i).first();
  if (!(await previewLabel.isVisible().catch(() => false))) {
    const expandPanel = page.getByRole('button', { name: /expand form panel/i });
    await expect(expandPanel).toBeVisible({ timeout: 15_000 });
    await expandPanel.click();
  }
  await expect(previewLabel).toBeVisible({ timeout: 15_000 });

  const editNameButton = page.getByRole('button', { name: /^edit name$/i }).first();
  await expect(editNameButton).toBeVisible({ timeout: 15_000 });
  await editNameButton.click();

  const input = page.getByPlaceholder('Enter display name').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  // Clicking "Edit name" seeds the input from the derived value. Wait for that
  // before typing: editing while it is still empty makes the typed text the dirty
  // baseline, so the form never registers dirty and Save stays disabled — the
  // load race documented in TC-LOCK-OSS-014.
  await expect(input).not.toHaveValue('', { timeout: 15_000 });
  return input;
}

async function saveForm(page: Page) {
  const saveButton = page.getByRole('button', { name: /^save$/i }).first();
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  await saveButton.click();
}

test.describe('TC-CRM-018: Person Display Name Edit And Undo', () => {
  test('should edit person display name and undo the update', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      const originalName = `QA TC-CRM-018 Person ${Date.now()}`;
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-018 Company ${Date.now()}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: 'TCCRM018',
        displayName: originalName,
        companyEntityId: companyId,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people-v2/${personId}`);

      const input = await openDisplayNameInput(page);
      const updatedName = `${originalName} QA`;
      await fillControlledInput(input, updatedName);
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

      await expect.poll(readPersistedDisplayName, { timeout: 15_000 }).toContain(updatedName);

      await page.getByRole('button', { name: /^Undo(?: last action)?$/ }).click();
      await expect.poll(readPersistedDisplayName, { timeout: 15_000 }).toBe(originalName);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
