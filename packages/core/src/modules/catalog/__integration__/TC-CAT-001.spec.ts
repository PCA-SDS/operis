import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CAT-001: Create New Product
 * Source: .ai/qa/scenarios/TC-CAT-001-product-creation.md
 */
test.describe('TC-CAT-001: Create New Product', () => {
  test('should create a product from catalog create form', async ({ page }) => {
    test.slow();
    const productName = `QA TC-CAT-001 ${Date.now()}`;
    const sku = `QA-CAT-001-${Date.now()}`;

    await login(page, 'admin');
    await page.goto('/backend/catalog/products/create');

    await expect(page.getByRole('button', { name: 'Create product' }).last()).toBeVisible();

    /**
     * The product's own SKU, on the General data step.
     *
     * This used to reach for the Variants step and fill the first variant's SKU
     * (`e.g., SKU-001`). A `simple` product — the form's default — no longer has
     * a Variants step at all: `f872ab6f` filters `options` and `variants` out of
     * the step list for `simple` and `downloadable`, because neither can carry
     * them. The product-level SKU has always been here; the old path was
     * setting a variant SKU on a product that was never going to have variants.
     */
    await page.getByRole('textbox', { name: 'e.g., PROD-001' }).fill(sku);

    const titleInput = page.getByRole('textbox', { name: 'e.g., Summer sneaker' });
    await titleInput.fill(productName);
    await expect(titleInput).toHaveValue(productName);

    const descriptionInput = page.getByRole('textbox', { name: 'Describe the product...' });
    await descriptionInput.fill('This is a catalog QA description long enough to satisfy SEO validation checks in create flow.');
    await expect(descriptionInput).toHaveValue('This is a catalog QA description long enough to satisfy SEO validation checks in create flow.');

    const createProductButton = page
      .locator('button[type="submit"]')
      .filter({ hasText: /^Create product$|catalog\.products\.actions\.create/i })
      .first();
    await expect(createProductButton).toBeEnabled();
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/catalog/products'),
    );
    await createProductButton.click();
    const createResponse = await createResponsePromise;
    expect(createResponse.ok()).toBe(true);

    await expect(page).toHaveURL(
      /\/backend\/catalog\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      { timeout: 20_000 },
    );
    const createdProductId = page.url().split('/').at(-1) ?? '';
    expect(createdProductId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
