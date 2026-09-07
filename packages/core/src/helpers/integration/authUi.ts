import { expect, type Page } from '@playwright/test';

export async function createUserViaUi(page: Page, input: { email: string; password: string; role?: string }) {
  const role = input.role ?? 'employee';

  await page.goto('/backend/users/create');
  // Scoped to the page body: the form title also exists in the app chrome, so a
  // page-wide text match resolves to two nodes and trips Playwright strict mode.
  await expect(page.getByRole('main').getByText('Create User')).toBeVisible();

  const emailInput = page.locator('[data-crud-field-id="email"] input').first();
  const nameInput = page.locator('[data-crud-field-id="name"] input').first();
  const passwordInput = page.locator('[data-crud-field-id="password"] input').first();

  await expect(emailInput).toBeVisible();
  await emailInput.fill(input.email);
  if (await nameInput.count()) {
    await nameInput.fill('');
  }
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill(input.password);

  const orgSelect = page.locator('main').locator('select').first();
  await expect(orgSelect).toBeEnabled();
  const orgValue = await orgSelect.evaluate((element) => {
    const select = element as HTMLSelectElement;
    for (const option of Array.from(select.options)) {
      if (option.value && option.value.trim().length > 0) return option.value;
    }
    return '';
  });
  if (orgValue) {
    await orgSelect.selectOption(orgValue);
  }

  // TagsInput renders a bare <input> carrying only a placeholder — no id, label
  // or aria-label — so there is no accessible name to match on by role. It also
  // sits at the fold with its suggestion list over it, so scroll and focus it
  // before typing or fill() times out on the actionability check.
  const rolesInput = page.getByPlaceholder(/add tag and press enter/i).first();
  await rolesInput.scrollIntoViewIfNeeded();
  await expect(rolesInput).toBeVisible();
  await rolesInput.click();
  await rolesInput.fill(role);
  await rolesInput.press('Enter');

  await page.getByRole('button', { name: 'Create' }).first().click();
  await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/);
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(input.email);
  await expect(page.getByRole('row', { name: new RegExp(input.email, 'i') })).toBeVisible();
}
