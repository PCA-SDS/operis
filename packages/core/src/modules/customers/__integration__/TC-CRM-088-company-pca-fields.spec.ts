import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const COMPANIES_PATH = '/api/customers/companies'

type CompanyListRow = {
  tax_code?: string | null
  registration_country?: string | null
  address?: string | null
  incorporation_date?: string | null
  client_tier?: string | null
  onboarded_at?: string | null
  registered_at?: string | null
  end_date?: string | null
  reactivated_at?: string | null
}

async function fetchCompany(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  companyId: string,
): Promise<CompanyListRow | undefined> {
  const response = await apiRequest(request, 'GET', `${COMPANIES_PATH}?ids=${companyId}&pageSize=1`, { token })
  return (await readJsonSafe<{ items?: CompanyListRow[] }>(response))?.items?.[0]
}

const today = () => new Date().toISOString().slice(0, 10)

// Covers the PCA ERP alignment of crm.company_clients onto customer_companies:
// the nine added fields must round-trip through the CRUD route, the status
// transitions must stamp the lifecycle dates without anyone typing them, and the
// per-tenant tax-code uniqueness must hold.
test.describe('TC-CRM-088: Company account-governance fields', () => {
  test('the nine PCA fields round-trip through create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', COMPANIES_PATH, {
        token,
        data: {
          displayName: `QA Governance Co ${stamp}`,
          taxCode: `${stamp}`.slice(-10),
          registrationCountry: 'Vietnam',
          address: '12 Nguyen Hue, District 1, Ho Chi Minh City',
          incorporationDate: '2019-04-01',
          clientTier: 'standard',
        },
      })
      expect(createResponse.status(), 'company create should return 201').toBe(201)
      companyId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'company id')

      const created = await fetchCompany(request, token, companyId)
      expect(created?.tax_code, 'tax code persists').toBe(`${stamp}`.slice(-10))
      expect(created?.registration_country, 'registration country persists').toBe('Vietnam')
      expect(created?.address, 'registered address persists').toBe('12 Nguyen Hue, District 1, Ho Chi Minh City')
      expect(created?.incorporation_date, 'incorporation date persists').toContain('2019-04-01')
      expect(created?.client_tier, 'client tier persists').toBe('standard')

      const updateResponse = await apiRequest(request, 'PUT', COMPANIES_PATH, {
        token,
        data: { id: companyId, registrationCountry: 'Singapore', clientTier: 'vip' },
      })
      expect(updateResponse.status(), 'update should succeed').toBeLessThan(400)

      const updated = await fetchCompany(request, token, companyId)
      expect(updated?.registration_country, 'registration country updates').toBe('Singapore')
      expect(updated?.client_tier, 'client tier updates').toBe('vip')

      const clearResponse = await apiRequest(request, 'PUT', COMPANIES_PATH, {
        token,
        data: { id: companyId, taxCode: '', address: '' },
      })
      expect(clearResponse.status(), 'blanking should succeed').toBeLessThan(400)

      const cleared = await fetchCompany(request, token, companyId)
      expect(cleared?.tax_code ?? null, 'blanked tax code clears').toBeNull()
      expect(cleared?.address ?? null, 'blanked address clears').toBeNull()
    } finally {
      await deleteGeneralEntityIfExists(request, token, COMPANIES_PATH, companyId)
    }
  })

  test('status transitions stamp the lifecycle dates', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', COMPANIES_PATH, {
        token,
        data: { displayName: `QA Lifecycle Co ${stamp}`, status: 'prospect' },
      })
      expect(createResponse.status(), 'company create should return 201').toBe(201)
      companyId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'company id')

      const asProspect = await fetchCompany(request, token, companyId)
      expect(asProspect?.onboarded_at, 'creating as prospect stamps onboarded_at').toContain(today())
      expect(asProspect?.registered_at ?? null, 'a prospect is not registered yet').toBeNull()

      await apiRequest(request, 'PUT', COMPANIES_PATH, { token, data: { id: companyId, status: 'active' } })
      const asActive = await fetchCompany(request, token, companyId)
      expect(asActive?.registered_at, 'prospect to active stamps registered_at').toContain(today())
      expect(asActive?.end_date ?? null, 'an active company has no end date').toBeNull()

      await apiRequest(request, 'PUT', COMPANIES_PATH, { token, data: { id: companyId, status: 'inactive' } })
      const asInactive = await fetchCompany(request, token, companyId)
      expect(asInactive?.end_date, 'active to inactive stamps end_date').toContain(today())

      await apiRequest(request, 'PUT', COMPANIES_PATH, { token, data: { id: companyId, status: 'active' } })
      const reactivated = await fetchCompany(request, token, companyId)
      expect(reactivated?.end_date ?? null, 'reactivation clears end_date').toBeNull()
      expect(reactivated?.reactivated_at ?? null, 'reactivation stamps reactivated_at').not.toBeNull()
    } finally {
      await deleteGeneralEntityIfExists(request, token, COMPANIES_PATH, companyId)
    }
  })

  test('an explicitly supplied lifecycle date is not overwritten by the transition', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', COMPANIES_PATH, {
        token,
        data: { displayName: `QA Backfill Co ${stamp}`, status: 'prospect', onboardedAt: '2020-01-15' },
      })
      expect(createResponse.status(), 'company create should return 201').toBe(201)
      companyId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'company id')

      const created = await fetchCompany(request, token, companyId)
      expect(created?.onboarded_at, 'a supplied onboarded_at wins over the stamp').toContain('2020-01-15')
    } finally {
      await deleteGeneralEntityIfExists(request, token, COMPANIES_PATH, companyId)
    }
  })

  test('a tax code is unique within the tenant', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const taxCode = `${stamp}`.slice(-10)
    let firstId: string | null = null
    let secondId: string | null = null

    try {
      const first = await apiRequest(request, 'POST', COMPANIES_PATH, {
        token,
        data: { displayName: `QA Unique Co A ${stamp}`, taxCode },
      })
      expect(first.status(), 'first company create should return 201').toBe(201)
      firstId = expectId((await readJsonSafe<{ id?: string }>(first))?.id, 'first company id')

      const second = await apiRequest(request, 'POST', COMPANIES_PATH, {
        token,
        data: { displayName: `QA Unique Co B ${stamp}`, taxCode },
      })
      expect(second.status(), 'a duplicate tax code in the same tenant is rejected').toBeGreaterThanOrEqual(400)
      if (second.status() < 400) {
        secondId = (await readJsonSafe<{ id?: string }>(second))?.id ?? null
      }
    } finally {
      await deleteGeneralEntityIfExists(request, token, COMPANIES_PATH, secondId)
      await deleteGeneralEntityIfExists(request, token, COMPANIES_PATH, firstId)
    }
  })
})
