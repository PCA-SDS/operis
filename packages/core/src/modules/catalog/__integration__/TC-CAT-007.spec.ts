import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-007: Create Product Category
 * Source: .ai/qa/scenarios/TC-CAT-007-category-creation.md
 */
test.describe('TC-CAT-007: Create Product Category', () => {
  test('should create a root category and show it in categories list', async ({ page, request }) => {
    const categoryName = `QA TC-CAT-007 ${Date.now()}`;
    let token: string | null = null;
    let categoryId: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');
      await page.goto('/backend/catalog/categories/create');

      await // The category form is a CrudForm, so the Name field carries a real <Label> and
      // its accessible name is "Name" — the `e.g., Footwear` placeholder this used to
      // match is now only a placeholder. (The hand-rolled product form has no labels,
      // which is why TC-CAT-003's `e.g., Summer sneaker` still resolves.)
      page.getByRole('textbox', { name: /^Name$/ }).fill(categoryName);
      await page.getByRole('button', { name: 'Create' }).last().click();

      await expect(page).toHaveURL(/\/backend\/catalog\/categories$/);
      const search = page.getByRole('searchbox', { name: 'Search categories' });
      await search.fill(categoryName);
      const categoryLink = page.getByText(categoryName, { exact: true }).first();
      await expect(categoryLink).toBeVisible();
      await categoryLink.click();
      await expect(page).toHaveURL(/\/backend\/catalog\/categories\/[0-9a-f-]{36}\/edit$/i);
      categoryId = page.url().match(/\/backend\/catalog\/categories\/([0-9a-f-]{36})\/edit$/i)?.[1] ?? null;
    } finally {
      if (token && categoryId) {
        await apiRequest(request, 'DELETE', `/api/catalog/categories?id=${encodeURIComponent(categoryId)}`, { token }).catch(() => {});
      }
    }
  });
});
