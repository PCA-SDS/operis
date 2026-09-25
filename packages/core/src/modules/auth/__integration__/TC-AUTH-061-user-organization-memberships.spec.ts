import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

type IdResponse = { id?: string }
type UsersResponse = { items?: Array<{ id?: string; organizationIds?: string[] }> }
type StaffAssignmentsResponse = {
  items?: Array<{ organizationId?: string; memberId?: string | null; roleIds?: string[] }>
}

function scopeCookie(tenantId: string, organizationId: string | null): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`,
  ].join('; ')
}

async function scopedRequest(
  request: Parameters<typeof apiRequest>[0],
  method: string,
  path: string,
  token: string,
  cookie: string,
  data?: unknown,
) {
  return request.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    data,
  })
}

test.describe('TC-AUTH-061: user organization memberships', () => {
  test('assigns one account to multiple organizations and allows staff linking in each', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'superadmin')
    const stamp = Date.now()
    const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token,
      data: { name: `QA AUTH 061 Tenant ${stamp}` },
    })
    expect(tenantResponse.status()).toBe(201)
    const tenantId = expectId((await readJsonSafe<IdResponse>(tenantResponse))?.id, 'tenant id')
    const cookie = scopeCookie(tenantId, null)

    const organizationIds: string[] = []
    let userId: string | null = null
    let memberId: string | null = null
    let roleId: string | null = null
    try {
      for (const name of ['Primary', 'Secondary']) {
        const response = await scopedRequest(
          request,
          'POST',
          '/api/directory/organizations',
          token,
          cookie,
          { name: `QA AUTH 061 ${name} Org ${stamp}`, tenantId },
        )
        expect(response.status()).toBe(201)
        organizationIds.push(expectId((await readJsonSafe<IdResponse>(response))?.id, `${name} organization id`))
      }

      const roleResponse = await scopedRequest(
        request,
        'POST',
        '/api/staff/team-roles',
        token,
        scopeCookie(tenantId, organizationIds[1]),
        {
          tenantId,
          organizationId: organizationIds[1],
          name: `QA AUTH 061 Staff Role ${stamp}`,
        },
      )
      expect(roleResponse.status()).toBe(201)
      roleId = expectId((await readJsonSafe<IdResponse>(roleResponse))?.id, 'staff role id')

      const createResponse = await apiRequest(request, 'POST', '/api/auth/users', {
        token,
        data: {
          email: `qa-auth-061-${stamp}@example.com`,
          password: 'StrongSecret123!',
          organizationId: organizationIds[0],
          organizationIds,
          staffRoleAssignments: [{ organizationId: organizationIds[1], roleIds: [roleId] }],
        },
      })
      expect(createResponse.status()).toBe(201)
      userId = expectId((await readJsonSafe<IdResponse>(createResponse))?.id, 'user id')

      const listResponse = await scopedRequest(
        request,
        'GET',
        `/api/auth/users?id=${encodeURIComponent(userId)}&organizationId=${encodeURIComponent(organizationIds[1])}`,
        token,
        cookie,
      )
      expect(listResponse.status()).toBe(200)
      const listed = await readJsonSafe<UsersResponse>(listResponse)
      expect(listed?.items?.[0]?.organizationIds?.sort()).toEqual([...organizationIds].sort())

      let assignment: StaffAssignmentsResponse['items'] = []
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const assignmentResponse = await scopedRequest(
          request,
          'GET',
          `/api/staff/user-assignments?tenantId=${encodeURIComponent(tenantId)}&userId=${encodeURIComponent(userId)}&organizationIds=${encodeURIComponent(organizationIds[1])}`,
          token,
          cookie,
        )
        if (assignmentResponse.status() === 200) {
          assignment = (await readJsonSafe<StaffAssignmentsResponse>(assignmentResponse))?.items ?? []
          if (assignment[0]?.roleIds?.includes(roleId)) break
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      expect(assignment[0]?.roleIds).toContain(roleId)
      memberId = expectId(assignment[0]?.memberId, 'team member id')
    } finally {
      if (memberId) await deleteGeneralEntityIfExists(request, token, '/api/staff/team-members', memberId)
      if (roleId) await deleteGeneralEntityIfExists(request, token, '/api/staff/team-roles', roleId)
      if (userId) await deleteGeneralEntityIfExists(request, token, '/api/auth/users', userId)
      for (const organizationId of organizationIds.reverse()) {
        await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', organizationId)
      }
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId)
    }
  })
})
