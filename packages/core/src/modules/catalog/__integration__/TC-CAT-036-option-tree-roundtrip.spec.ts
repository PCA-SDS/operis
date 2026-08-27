import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { fillControlledInput, waitForApiMutation } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

type OptionTreeResponse = {
  updated_at: string | null
  groups: Array<{
    id: string
    product_id: string
    parent_option_id: string | null
    name: string
  }>
  options: Array<{
    id: string
    group_id: string
    name: string
  }>
}

const ROOT_GROUP_ID = '4ab2edb9-35cc-4688-9b82-d3f8d0d0f101'
const CHILD_GROUP_ID = '4ab2edb9-35cc-4688-9b82-d3f8d0d0f102'
const PARENT_OPTION_ID = '4ab2edb9-35cc-4688-9b82-d3f8d0d0f103'
const CHILD_OPTION_ID = '4ab2edb9-35cc-4688-9b82-d3f8d0d0f104'
const SIBLING_OPTION_ID = '4ab2edb9-35cc-4688-9b82-d3f8d0d0f105'

const INITIAL_GROUP_NAME = 'Quality Level'
const UPDATED_GROUP_NAME = 'Quality Level Updated'
const PARENT_OPTION_NAME = 'Gel Polish'
const CHILD_GROUP_NAME = 'Add-ons'
const CHILD_OPTION_NAME = 'Nail Art'
const SIBLING_OPTION_NAME = 'Classic Polish'

async function seedOptionTree(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<void> {
  const response = await apiRequest(
    request,
    'PUT',
    `/api/catalog/products/${productId}/option-tree`,
    {
      token,
      data: {
        groups: [
          {
            id: ROOT_GROUP_ID,
            name: INITIAL_GROUP_NAME,
            requirement: 'required',
            selectMode: 'single',
            sortOrder: 0,
            isActive: true,
            parentOptionId: null,
            metadata: null,
          },
          {
            id: CHILD_GROUP_ID,
            name: CHILD_GROUP_NAME,
            requirement: 'optional',
            selectMode: 'multiple',
            sortOrder: 0,
            isActive: true,
            parentOptionId: PARENT_OPTION_ID,
            metadata: null,
          },
        ],
        options: [
          {
            id: PARENT_OPTION_ID,
            groupId: ROOT_GROUP_ID,
            name: PARENT_OPTION_NAME,
            code: 'gel-polish',
            description: null,
            priceFlat: '100000',
            priceMin: null,
            priceMax: null,
            durationValue: 45,
            durationUnit: 'minute',
            durationMin: null,
            durationMax: null,
            isAddon: false,
            sortOrder: 0,
            isActive: true,
            metadata: null,
            note: null,
            unit: null,
          },
          {
            id: SIBLING_OPTION_ID,
            groupId: ROOT_GROUP_ID,
            name: SIBLING_OPTION_NAME,
            code: 'classic-polish',
            description: null,
            priceFlat: '70000',
            priceMin: null,
            priceMax: null,
            durationValue: 30,
            durationUnit: 'minute',
            durationMin: null,
            durationMax: null,
            isAddon: false,
            sortOrder: 1,
            isActive: true,
            metadata: null,
            note: null,
            unit: null,
          },
          {
            id: CHILD_OPTION_ID,
            groupId: CHILD_GROUP_ID,
            name: CHILD_OPTION_NAME,
            code: 'nail-art',
            description: null,
            priceFlat: '20000',
            priceMin: null,
            priceMax: null,
            durationValue: 15,
            durationUnit: 'minute',
            durationMin: null,
            durationMax: null,
            isAddon: true,
            sortOrder: 0,
            isActive: true,
            metadata: null,
            note: null,
            unit: null,
          },
        ],
      },
    },
  )
  expect(response.ok(), `Failed to seed option tree: ${response.status()}`).toBeTruthy()
}

async function readOptionTree(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<OptionTreeResponse> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/products/${productId}/option-tree`,
    { token },
  )
  expect(response.ok(), `Failed to read option tree: ${response.status()}`).toBeTruthy()
  return (await response.json()) as OptionTreeResponse
}

async function deleteOptionFromRow(page: Page, optionName: string): Promise<void> {
  const label = page.locator('span', { hasText: optionName }).first()
  await expect(label).toBeVisible({ timeout: 20_000 })

  const row = label.locator('xpath=ancestor::div[contains(@class,"group/opt")]').first()
  await row.hover()
  await row.locator('button').last().click()

  const confirmDialog = page.getByRole('alertdialog')
  await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
  await confirmDialog.getByRole('button', { name: /^delete$/i }).click()
}

test.describe('TC-CAT-036: option-tree roundtrip for nested delete', () => {
  test('loads, edits, deletes nested branch, saves, and reloads cleanly', async ({ page }) => {
    test.setTimeout(120_000)

    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null

    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA CAT-036 ${stamp}`,
        sku: `qa-cat-036-${stamp}`,
      })
      await seedOptionTree(page.request, token, productId)

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${productId}/options`, {
        waitUntil: 'domcontentloaded',
      })

      const groupLabel = page.locator('span', { hasText: INITIAL_GROUP_NAME }).first()
      await expect(groupLabel).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('span', { hasText: PARENT_OPTION_NAME }).first()).toBeVisible()
      await expect(page.locator('span', { hasText: CHILD_GROUP_NAME }).first()).toBeVisible()
      await expect(page.locator('span', { hasText: CHILD_OPTION_NAME }).first()).toBeVisible()
      await expect(page.locator('span', { hasText: SIBLING_OPTION_NAME }).first()).toBeVisible()

      await groupLabel.click()
      const renameInput = page.locator(`input[value="${INITIAL_GROUP_NAME}"]`).first()
      await expect(renameInput).toBeVisible({ timeout: 10_000 })
      await fillControlledInput(renameInput, UPDATED_GROUP_NAME)
      await renameInput.press('Enter')

      await deleteOptionFromRow(page, PARENT_OPTION_NAME)
      await expect(page.locator('span', { hasText: PARENT_OPTION_NAME })).toHaveCount(0)
      await expect(page.locator('span', { hasText: CHILD_GROUP_NAME })).toHaveCount(0)
      await expect(page.locator('span', { hasText: CHILD_OPTION_NAME })).toHaveCount(0)
      await expect(page.locator('span', { hasText: SIBLING_OPTION_NAME }).first()).toBeVisible()

      const saveResponse = await waitForApiMutation(
        page,
        `/api/catalog/products/${productId}/option-tree`,
        async () => {
          await page.getByRole('button', { name: /save changes/i }).first().click()
        },
        'PUT',
        20_000,
      )
      expect(saveResponse.status(), 'Option-tree save should succeed').toBeLessThan(400)

      await page.reload({ waitUntil: 'domcontentloaded' })

      await expect(page.locator('span', { hasText: UPDATED_GROUP_NAME }).first()).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.locator('span', { hasText: SIBLING_OPTION_NAME }).first()).toBeVisible()
      await expect(page.locator('span', { hasText: PARENT_OPTION_NAME })).toHaveCount(0)
      await expect(page.locator('span', { hasText: CHILD_GROUP_NAME })).toHaveCount(0)
      await expect(page.locator('span', { hasText: CHILD_OPTION_NAME })).toHaveCount(0)

      const tree = await readOptionTree(page.request, token, productId)
      expect(tree.groups.map((group) => group.id)).toEqual([ROOT_GROUP_ID])
      expect(tree.groups[0]?.name).toBe(UPDATED_GROUP_NAME)
      expect(tree.options.map((option) => option.id)).toEqual([SIBLING_OPTION_ID])
      expect(tree.options[0]?.name).toBe(SIBLING_OPTION_NAME)
      expect(tree.updated_at).toEqual(expect.any(String))
    } finally {
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })
})
