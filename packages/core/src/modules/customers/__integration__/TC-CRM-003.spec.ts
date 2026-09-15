import { expect, test, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui';

/**
 * TC-CRM-003: Edit Company Details
 * Source: .ai/qa/scenarios/TC-CRM-003-company-edit.md
 *
 * Rewritten for companies-v2. The original drove v1's per-field inline editors —
 * click a `Display name <value>` summary button, edit, then a per-field
 * `Save (Ctrl+Enter)`, once per field. v2 is a single CrudForm with one header
 * Save (SPEC-046), so all fields are edited together and saved once.
 *
 * The lifecycle-stage leg is carried over. The original picked the seeded option
 * "Prospect", which `.ai/qa/AGENTS.md` rules out — an integration test must create
 * its own fixtures and stay stable without seeded/demo data. So this creates a
 * uniquely-named lifecycle-stage dictionary entry up front, selects that, and
 * deletes it in teardown. No dependency on what any environment happens to seed.
 */

/**
 * companies-v2 renders the CrudForm inside a `CollapsibleZoneLayout` that starts
 * collapsed to an icon rail at the default 1280px viewport. Expand it once, then
 * read fields directly. Mirrors `openPersonFormLastNameInput` in TC-LOCK-OSS-015.
 */
async function openCompanyForm(page: Page) {
  const firstField = page.locator('[data-crud-field-id="displayName"] input:visible').first();
  if (await firstField.isVisible().catch(() => false)) return;
  // The zone layout renders `invisible` until it hydrates, so WAIT for the rail's
  // expand button instead of probing for it. An immediate `isVisible()` check races
  // hydration: nothing is visible yet, nothing gets clicked, and the test then waits
  // out its timeout on a field that is still behind a collapsed panel. That is the
  // flake this helper had on its first run.
  const expandPanel = page.getByRole('button', { name: /expand form panel/i });
  await expect(expandPanel).toBeVisible({ timeout: 15_000 });
  await expandPanel.click();
  await expect(firstField).toBeVisible({ timeout: 15_000 });
}

/**
 * Dictionary-backed selects (lifecycle stage, industry, …) render a combobox inside
 * the CrudForm field wrapper. Scope to the wrapper rather than the page so a second
 * dictionary select on the same form cannot be picked up by accident.
 */
async function selectDictionaryOption(page: Page, fieldId: string, optionLabel: string) {
  const field = page.locator(`[data-crud-field-id="${fieldId}"]`).first();
  await expect(field).toBeVisible({ timeout: 15_000 });
  await field.getByRole('combobox').first().click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
}

async function companyField(page: Page, fieldId: string) {
  const input = page.locator(`[data-crud-field-id="${fieldId}"] input:visible`).first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  return input;
}

test.describe('TC-CRM-003: Edit Company Details', () => {
  test('should update company fields from detail page and persist changes in list view', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let lifecycleEntryId: string | null = null;
    let lifecycleValue = '';
    const lifecycleLabel = `QA Lifecycle ${Date.now()}`;
    const originalName = `QA TC-CRM-003 Original ${Date.now()}`;
    const updatedName = `QA TC-CRM-003 Updated ${Date.now()}`;
    const updatedWebsite = `https://crm003-${Date.now()}.example.com`;

    try {
      token = await getAuthToken(request);

      // Own the option this test selects instead of relying on a seeded one.
      lifecycleValue = `qa-crm003-${Date.now()}`;
      const lifecycleResponse = await apiRequest(
        request,
        'POST',
        '/api/customers/dictionaries/lifecycle-stages',
        { token, data: { value: lifecycleValue, label: lifecycleLabel } },
      );
      expect(
        lifecycleResponse.ok(),
        `Failed to create the lifecycle-stage fixture: ${lifecycleResponse.status()}`,
      ).toBeTruthy();
      lifecycleEntryId = ((await readJsonSafe(lifecycleResponse)) as { id?: string } | null)?.id ?? null;
      expect(lifecycleEntryId, 'lifecycle-stage fixture should return an id').toBeTruthy();

      companyId = await createCompanyFixture(request, token, originalName);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies-v2/${companyId}`);

      await openCompanyForm(page);
      const nameInput = await companyField(page, 'displayName');
      // Wait for the form to hydrate its loaded value before editing — typing into a
      // still-empty field makes the typed text the dirty baseline, so the form never
      // registers dirty and Save stays disabled (see TC-LOCK-OSS-014).
      await expect(nameInput).not.toHaveValue('', { timeout: 15_000 });
      await fillControlledInput(nameInput, updatedName);

      const websiteInput = await companyField(page, 'websiteUrl');
      await fillControlledInput(websiteInput, updatedWebsite);

      await selectDictionaryOption(page, 'lifecycleStage', lifecycleLabel);

      const saveButton = page.getByRole('button', { name: /^save$/i }).first();
      await expect(saveButton).toBeEnabled({ timeout: 10_000 });
      await saveButton.click();

      // All three edits must reach the server, not just the form they were typed into.
      const readCompany = async (): Promise<{
        displayName: string;
        websiteUrl: string;
        lifecycleStage: string;
      }> => {
        const response = await apiRequest(
          request,
          'GET',
          `/api/customers/companies/${encodeURIComponent(companyId as string)}`,
          { token: token as string },
        );
        if (!response.ok()) return { displayName: '', websiteUrl: '', lifecycleStage: '' };
        // displayName and lifecycleStage live on `company`; websiteUrl on `profile`.
        const body = (await readJsonSafe(response)) as {
          company?: { displayName?: string; lifecycleStage?: string | null };
          profile?: { websiteUrl?: string | null };
        } | null;
        return {
          displayName: (body?.company?.displayName ?? '').trim(),
          websiteUrl: (body?.profile?.websiteUrl ?? '').trim(),
          lifecycleStage: (body?.company?.lifecycleStage ?? '').trim(),
        };
      };
      await expect.poll(readCompany, { timeout: 15_000 }).toEqual({
        displayName: updatedName,
        websiteUrl: updatedWebsite,
        lifecycleStage: lifecycleValue,
      });

      // ...and the list view reflects them, which is what this case is named for.
      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/customers/companies?page=1&pageSize=100',
        { token },
      );
      expect(listResponse.ok()).toBeTruthy();
      const listBody = (await readJsonSafe<{
        items?: Array<{ id?: unknown; display_name?: unknown }>;
      }>(listResponse)) ?? {};
      const items = Array.isArray(listBody.items) ? listBody.items : [];
      const updatedCompany =
        items.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === companyId) ?? null;
      expect(updatedCompany).toBeTruthy();
      expect((updatedCompany as { display_name?: unknown }).display_name).toBe(updatedName);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      if (token && lifecycleEntryId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/customers/dictionaries/lifecycle-stages/${encodeURIComponent(lifecycleEntryId)}`,
          { token },
        ).catch(() => undefined);
      }
    }
  });
});
