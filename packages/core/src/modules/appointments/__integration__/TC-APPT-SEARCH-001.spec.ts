import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteGeneralEntityIfExists, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'

type SearchBody = { items?: Array<{ id?: string; displayName?: string }> }

test.describe('TC-APPT-SEARCH-001: Returning-customer partial phone search', () => {
  test('matches indexed partial phone digits and ignores matching tokens scoped to another tenant', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(adminToken)
    const foreignTenantName = `QA APPT SEARCH ${Date.now()}`
    const phone = `0842${String(Date.now()).slice(-6)}`
    const partialPhone = phone.slice(0, 4)
    const displayName = `QA Returning Customer ${Date.now()}`
    let customerId: string | null = null
    let foreignTenantId: string | null = null

    try {
      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: foreignTenantName },
      })
      expect(tenantResponse.status(), 'foreign tenant fixture should be created').toBe(201)
      const tenantBody = await readJsonSafe<{ id?: string }>(tenantResponse)
      foreignTenantId = tenantBody?.id ?? null
      expect(foreignTenantId, 'foreign tenant id should be returned').toBeTruthy()

      const createResponse = await apiRequest(request, 'POST', '/api/customers/people', {
        token: adminToken,
        data: {
          firstName: 'QA',
          lastName: `Search${Date.now()}`,
          displayName,
          primaryPhone: phone,
          phoneCountryCode: '84',
          phoneCountry: 'VN',
        },
      })
      expect(createResponse.ok(), `person fixture creation failed: ${createResponse.status()}`).toBeTruthy()
      const customerBody = await readJsonSafe<{ id?: string; personId?: string; entityId?: string }>(createResponse)
      customerId = customerBody?.id ?? customerBody?.personId ?? customerBody?.entityId ?? null
      expect(customerId, 'person fixture id should be returned').toBeTruthy()

      const search = async () => apiRequest(
        request,
        'GET',
        `/api/appointments/customer-search?search=${encodeURIComponent(partialPhone)}`,
        { token: adminToken },
      )
      await expect.poll(async () => {
        const response = await search()
        if (!response.ok()) return false
        const body = await readJsonSafe<SearchBody>(response)
        return (body?.items ?? []).some((item) => item.id === customerId)
      }, { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(true)

      const phoneHashes = tokenizeText(partialPhone).hashes
      expect(phoneHashes.length, 'partial phone query should produce index tokens').toBeGreaterThan(0)

      await withClient(async (client) => {
        await client.query(
          'delete from search_tokens where entity_type = $1 and entity_id = $2',
          ['customers:customer_entity', customerId],
        )
        await client.query(
          `insert into search_tokens
             (id, entity_type, entity_id, organization_id, tenant_id, field, token_hash, token, created_at)
           select gen_random_uuid(), $1, $2, null, $3, 'primary_phone', hash.token_hash, null, now()
           from unnest($4::text[]) as hash(token_hash)`,
          ['customers:customer_entity', customerId, foreignTenantId, phoneHashes],
        )
      })

      const isolatedResponse = await search()
      expect(isolatedResponse.status()).toBe(200)
      const isolatedBody = await readJsonSafe<SearchBody>(isolatedResponse)
      expect(isolatedBody?.items?.some((item) => item.id === customerId)).toBe(false)
    } finally {
      if (customerId) {
        await withClient(async (client) => {
          await client.query(
            'delete from search_tokens where entity_type = $1 and entity_id = $2',
            ['customers:customer_entity', customerId],
          )
        }).catch(() => undefined)
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', customerId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })
})
