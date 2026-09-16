import { expect, test, type Page } from '@playwright/test';
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-005: Link Person to Company
 * Source: .ai/qa/scenarios/TC-CRM-005-person-link-to-company.md
 *
 * Rewritten for people-v2. The original clicked v1's section `Edit` button to reveal
 * a bare `CompanySelectField`; v2 renders the company picker as a CrudForm field
 * inside a `CollapsibleZoneLayout` and saves through one header Save (SPEC-046).
 * The assertions are unchanged: the link must reach the server, and the company's
 * People tab must show the roles surface.
 */

/**
 * people-v2 mounts its CrudForm hidden behind a collapsed icon rail at the default
 * 1280px viewport. Wait for the expand control rather than probing it — the layout
 * renders `invisible` until it hydrates, and an instant `isVisible()` check races
 * that and leaves the panel shut. See TC-LOCK-OSS-015.
 */
async function openPersonForm(page: Page) {
  const companyCombobox = page.getByRole('combobox', { name: /^company$/i }).first();
  if (await companyCombobox.isVisible().catch(() => false)) return companyCombobox;
  const expandPanel = page.getByRole('button', { name: /expand form panel/i });
  await expect(expandPanel).toBeVisible({ timeout: 15_000 });
  await expandPanel.click();
  await expect(companyCombobox).toBeVisible({ timeout: 15_000 });
  return companyCombobox;
}
test.describe('TC-CRM-005: Link Person to Company', () => {
  test('should link a person to a company from person detail and show person on company page', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;

    const companyName = `QA TC-CRM-005 Co ${Date.now()}`;
    const firstName = `QA${Date.now()}`;
    const lastName = 'Link';
    const displayName = `${firstName} ${lastName}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      personId = await createPersonFixture(request, token, {
        firstName,
        lastName,
        displayName,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people-v2/${personId}`);

      const companyCombobox = await openPersonForm(page);
      await companyCombobox.click();
      await page.getByRole('option', { name: companyName, exact: true }).click();
      const saveResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'PUT' && url.pathname === '/api/customers/people';
      });
      const saveButton = page.getByRole('button', { name: /^save$/i }).first();
      await expect(saveButton).toBeEnabled({ timeout: 10_000 });
      await saveButton.click();
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.status(), `PUT /api/customers/people returned ${saveResponse.status()}`).toBeLessThan(400);
      // v2 surfaces the linked company in more than one place (the picker's own value
      // and the linked-company card), so this must not assert a unique match the way
      // the v1 layout allowed.
      await expect(page.getByText(companyName, { exact: true }).first()).toBeVisible();

      await expect.poll(async () => {
        const response = await apiRequest(
          request,
          'GET',
          `/api/customers/companies/${companyId}?include=people`,
          { token: token as string },
        );
        if (!response.ok()) return false;
        const body = await response.json();
        const people = Array.isArray(body?.people) ? body.people : [];
        return people.some((person: Record<string, unknown>) => person.id === personId || person.displayName === displayName);
      }).toBe(true);

      await page.goto(`/backend/customers/companies-v2/${companyId}`);
      // The tab carries a count badge on v2 ("People 1"), so match the prefix rather
      // than the whole accessible name.
      await page.getByRole('tab', { name: /^people\b/i }).click();
      // v1 showed a static "Roles at this company"; v2 interpolates the company name.
      // Asserting the interpolated form is strictly stronger — it also proves the
      // roles surface belongs to the company under test.
      await expect(page.getByText(`Roles at ${companyName}`, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Choose person' }).first()).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
