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
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const foreignTenantName = `QA APPT SEARCH ${Date.now()}`
    const phone = `+8490${String(Date.now()).slice(-7)}`
    const partialPhone = phone.slice(-6)
    const displayName = `QA Returning Customer ${Date.now()}`
    let customerId: string | null = null
    let foreignTenantId: string | null = null
    let appointmentId: string | null = null
    let latestHistoryAppointmentId: string | null = null
    let secondaryOrganizationId: string | null = null

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
          phoneCountryCode: '+84',
          phoneCountry: 'VN',
        },
      })
      expect(createResponse.ok(), `person fixture creation failed: ${createResponse.status()}`).toBeTruthy()
      const customerBody = await readJsonSafe<{ id?: string; personId?: string; entityId?: string }>(createResponse)
      customerId = customerBody?.id ?? customerBody?.personId ?? customerBody?.entityId ?? null
      expect(customerId, 'person fixture id should be returned').toBeTruthy()
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
          ['customers:customer_entity', customerId, tenantId, phoneHashes],
        )
      })

      const secondaryOrganizationResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { name: `QA APPT HISTORY ${Date.now()}`, tenantId },
      })
      expect(secondaryOrganizationResponse.status(), 'secondary organization fixture should be created').toBe(201)
      const secondaryOrganizationBody = await readJsonSafe<{ id?: string }>(secondaryOrganizationResponse)
      secondaryOrganizationId = secondaryOrganizationBody?.id ?? null
      expect(secondaryOrganizationId, 'secondary organization id should be returned').toBeTruthy()

      const appointmentPhoneDigits = `84276${String(Date.now()).slice(-6)}`
      const appointmentPhone = `+84 (${appointmentPhoneDigits.slice(2, 5)}) ${appointmentPhoneDigits.slice(5)}`
      const appointmentPhoneSearch = appointmentPhoneDigits.slice(2, 8)
      await withClient(async (client) => {
        const inserted = await client.query<{ id: string }>(
          `insert into appointments
             (tenant_id, organization_id, customer_entity_id, customer_name, customer_phone,
              status_id, status_code, requested_start_at, created_at, updated_at)
           select $1, $2, $3, $4, $5, status.id, 'new_request', now(), now(), now()
           from appointment_statuses status
           where status.tenant_id = $1 and status.code = 'new_request' and status.deleted_at is null
           order by status.id
           limit 1
           returning id`,
          [tenantId, organizationId, customerId, displayName, appointmentPhone],
        )
        appointmentId = inserted.rows[0]?.id ?? null

        const latestHistoryAppointment = await client.query<{ id: string }>(
          `insert into appointments
             (tenant_id, organization_id, customer_entity_id, customer_name, customer_phone,
              status_id, status_code, requested_start_at, created_at, updated_at)
           select $1, $2, $3, $4, $5, status.id, 'new_request', now() + interval '1 minute', now(), now()
           from appointment_statuses status
           where status.tenant_id = $1 and status.code = 'new_request' and status.deleted_at is null
           order by status.id
           limit 1
           returning id`,
          [tenantId, secondaryOrganizationId, customerId, displayName, phone],
        )
        latestHistoryAppointmentId = latestHistoryAppointment.rows[0]?.id ?? null
      })
      expect(appointmentId, 'appointment fixture should be created').toBeTruthy()
      expect(latestHistoryAppointmentId, 'cross-organization history fixture should be created').toBeTruthy()

      const publicPhoneOnlyLookup = await request.post('/api/appointments/public/customer', {
        data: { tenantId, phone, phoneCountryCode: '+84', phoneCountry: 'VN' },
      })
      expect(publicPhoneOnlyLookup.status(), 'public lookup must retain email verification').toBe(400)

      const unauthenticatedHistory = await request.post('/api/appointments/customer-history', {
        data: { organizationId, phone, phoneCountryCode: '+84', phoneCountry: 'VN' },
      })
      expect(unauthenticatedHistory.status(), 'staff customer history must require authentication').toBe(401)

      const staffHistory = await apiRequest(request, 'POST', '/api/appointments/customer-history', {
        token: adminToken,
        data: { organizationId, phone, phoneCountryCode: '+84', phoneCountry: 'VN' },
      })
      expect(staffHistory.status(), 'staff can retrieve phone-only customer history').toBe(200)
      const staffHistoryBody = await readJsonSafe<{ lastBooking?: { organizationId?: string } | null }>(staffHistory)
      expect(staffHistoryBody?.lastBooking?.organizationId).toBe(secondaryOrganizationId)

      const appointmentResponse = await apiRequest(
        request,
        'GET',
        `/api/appointments?search=${encodeURIComponent(appointmentPhoneSearch)}`,
        { token: adminToken },
      )
      expect(appointmentResponse.status(), 'appointment list phone search should succeed').toBe(200)
      const appointmentBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(appointmentResponse)
      expect(appointmentBody?.items?.some((item) => item.id === appointmentId)).toBe(true)

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
      if (appointmentId || latestHistoryAppointmentId) {
        await withClient(async (client) => {
          await client.query(
            'delete from appointments where id = any($1::uuid[]) and tenant_id = $2',
            [[appointmentId, latestHistoryAppointmentId].filter(Boolean), tenantId],
          )
        }).catch(() => undefined)
      }
      if (customerId) {
        await withClient(async (client) => {
          await client.query(
            'delete from search_tokens where entity_type = $1 and entity_id = $2',
            ['customers:customer_entity', customerId],
          )
        }).catch(() => undefined)
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', customerId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', secondaryOrganizationId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })
})
