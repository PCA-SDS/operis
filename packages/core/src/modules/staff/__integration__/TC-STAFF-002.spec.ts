import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createStaffTeamFixture, deleteStaffEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/staffFixtures';

/**
 * TC-STAFF-002: Staff Team CRUD via API
 * Covers: POST/PUT/GET/DELETE /api/staff/teams
 */
test.describe('TC-STAFF-002: Staff Team CRUD via API', () => {
  test('should create, update, read, and delete a staff team', async ({ request }) => {
    let token: string | null = null;
    let teamId: string | null = null;
    const teamName = `QA TC-STAFF-002 ${Date.now()}`;

    try {
      token = await getAuthToken(request, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/staff/teams', {
        token,
        data: { name: teamName },
      });
      expect(createResponse.status(), 'POST /api/staff/teams should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { id?: string };
      expect(createBody.id, 'Response should contain an id').toBeTruthy();
      teamId = createBody.id ?? null;

      const updateResponse = await apiRequest(request, 'PUT', '/api/staff/teams', {
        token,
        data: { id: teamId, description: 'QA updated description' },
      });
      expect(updateResponse.status(), 'PUT /api/staff/teams should return 200').toBe(200);

      const getResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/teams?ids=${encodeURIComponent(teamId!)}`,
        { token },
      );
      expect(getResponse.status(), 'GET /api/staff/teams should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.items) && getBody.items.length > 0, 'Should return at least one item').toBeTruthy();
      const team = getBody.items![0];
      expect(team.description, 'description should be updated').toBe('QA updated description');

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/staff/teams?id=${encodeURIComponent(teamId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/staff/teams should return 200').toBe(200);
      teamId = null;
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/teams', teamId);
    }
  });

  test('should reject deletion of a team that has assigned members (409)', async ({ request }) => {
    let token: string | null = null;
    let teamId: string | null = null;
    let memberId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      teamId = await createStaffTeamFixture(request, token);

      const memberResponse = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { teamId, displayName: `QA TC-STAFF-002-409 ${Date.now()}` },
      });
      expect(memberResponse.status(), 'POST /api/staff/team-members should return 201').toBe(201);
      const memberBody = (await memberResponse.json()) as { id?: string };
      memberId = memberBody.id ?? null;

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/staff/teams?id=${encodeURIComponent(teamId)}`,
        { token },
      );
      expect(
        deleteResponse.status(),
        'DELETE /api/staff/teams with assigned members should return 409',
      ).toBe(409);
      const deleteBody = (await deleteResponse.json()) as { error?: string };
      expect(deleteBody.error, 'Error body should mention assigned members').toMatch(/assigned member/i);
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId);
      await deleteStaffEntityIfExists(request, token, '/api/staff/teams', teamId);
    }
  });

  test('should reject deletion of a team member that has an HR profile (409)', async ({ request }) => {
    let token: string | null = null;
    let memberId: string | null = null;
    let profileId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      const memberResponse = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { displayName: `QA TC-STAFF-002-REFERENCED ${Date.now()}` },
      });
      expect(memberResponse.status(), 'POST /api/staff/team-members should return 201').toBe(201);
      const memberBody = (await memberResponse.json()) as { id?: string };
      memberId = memberBody.id ?? null;
      expect(memberId, 'Response should contain a team member id').toBeTruthy();

      const profileResponse = await apiRequest(request, 'POST', '/api/staff/employee-profiles', {
        token,
        data: {
          memberId,
          employeeNumber: `QA-STAFF-002-${Date.now()}`,
          jobTitle: 'QA Engineer',
          employmentType: 'full_time',
          startDate: '2026-01-05',
        },
      });
      expect(profileResponse.status(), 'POST /api/staff/employee-profiles should return 201').toBe(201);
      const profileBody = (await profileResponse.json()) as { id?: string };
      profileId = profileBody.id ?? null;
      expect(profileId, 'Response should contain an HR profile id').toBeTruthy();

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/staff/team-members?id=${encodeURIComponent(memberId!)}`,
        { token },
      );
      expect(
        deleteResponse.status(),
        'DELETE /api/staff/team-members with an HR profile should return 409',
      ).toBe(409);
      const deleteBody = (await deleteResponse.json()) as { error?: string };
      expect(deleteBody.error, 'Error body should explain the reference').toMatch(/referenced|references/i);

      const memberListResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/team-members?ids=${encodeURIComponent(memberId!)}`,
        { token },
      );
      expect(memberListResponse.status(), 'Referenced member should remain readable').toBe(200);
      const memberListBody = (await memberListResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(memberListBody.items, 'Referenced member should not be soft-deleted').toHaveLength(1);

      const profileListResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/employee-profiles?memberId=${encodeURIComponent(memberId!)}`,
        { token },
      );
      expect(profileListResponse.status(), 'Referenced HR profile should remain readable').toBe(200);
      const profileListBody = (await profileListResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(profileListBody.items, 'Rejected delete should preserve the HR profile').toHaveLength(1);
    } finally {
      if (token && profileId) {
        await apiRequest(request, 'DELETE', `/api/staff/employee-profiles?id=${encodeURIComponent(profileId)}`, { token })
          .catch(() => {});
      }
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId);
    }
  });
});
