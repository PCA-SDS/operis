import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg, createOrganizationFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteGeneralEntityIfExists, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test.describe('TC-CAT-037: product search across all organizations', () => {
  test('finds a product stored in another organization when all organizations is selected', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { organizationId, tenantId } = getTokenContext(token)
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const secondaryOrgName = `QA CAT 037 Org ${suffix}`
    const title = `QA CAT 037 Product ${suffix}`
    const sku = `QA-CAT-037-${suffix}`
    let secondaryOrganizationId: string | null = null
    let productId: string | null = null

    try {
      secondaryOrganizationId = await createOrganizationFixture(request, token, {
        name: secondaryOrgName,
        tenantId,
      })

      const createResponse = await apiRequestWithSelectedOrg(request, 'POST', '/api/catalog/products', {
        token,
        selectedOrgId: secondaryOrganizationId,
        data: {
          title,
          sku,
          description: 'Long enough description for the catalog search integration fixture.',
        },
      })
      expect(createResponse.status(), 'product fixture should be created').toBe(201)
      productId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(productId, 'product fixture id should be returned').toBeTruthy()

      const searchResponse = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/catalog/products?search=${encodeURIComponent(sku)}&pageSize=100`,
        { token, selectedOrgId: '__all__' },
      )
      expect(searchResponse.status(), 'all-organizations product search should succeed').toBe(200)
      const searchBody = await readJsonSafe<{ items?: Array<{ id?: string; sku?: string | null }> }>(searchResponse)
      expect(searchBody?.items?.some((item) => item.id === productId && item.sku === sku)).toBe(true)
    } finally {
      if (productId && secondaryOrganizationId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productId)}`, {
          token,
          selectedOrgId: secondaryOrganizationId,
        }).catch(() => undefined)
      }
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', secondaryOrganizationId)
    }
  })
})
