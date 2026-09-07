import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import type { APIResponse } from '@playwright/test';

/** A bare `expect(res.ok()).toBeTruthy()` reports only "false"; this reports why. */
async function expectOk(response: APIResponse, what: string): Promise<void> {
  if (response.ok()) return;
  const body = await response.text().catch(() => '<unreadable>');
  throw new Error(`${what} failed: HTTP ${response.status()} ${body.slice(0, 600)}`);
}

/**
 * TC-STAFF-HR-001: the employee module end to end.
 *
 * Covers the surfaces added when the reference employee module was merged in:
 * the HR profile (which is encrypted at rest, so a round-trip is the only way
 * to prove the columns and the cipher agree), the organisation chart, the
 * generated employee record, and the two new tabs on the member detail page.
 */
test.describe('TC-STAFF-HR-001: employee module', () => {
  test('stores, reads back and files an HR record, and shows it in the UI', async ({ page, request }) => {
    test.slow();
    const stamp = Date.now();
    const memberName = `QA HR Member ${stamp}`;

    let token: string | null = null;
    let memberId: string | null = null;
    let profileId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      const memberCreate = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { displayName: memberName },
      });
      await expectOk(memberCreate, 'Team member create');
      const memberBody = (await memberCreate.json()) as { id?: string | null };
      memberId = typeof memberBody.id === 'string' ? memberBody.id : null;
      expect(memberId, 'Team member id should be returned').toBeTruthy();

      // --- HR profile: create ---------------------------------------------
      const profileCreate = await apiRequest(request, 'POST', '/api/staff/employee-profiles', {
        token,
        data: {
          memberId,
          employeeNumber: `E-${stamp}`,
          jobTitle: 'Integration Engineer',
          employmentType: 'full_time',
          startDate: '2026-01-05',
          workPhone: '+48 22 000 0000',
          personalEmail: `qa-${stamp}@example.com`,
          dateOfBirth: '1990-04-17',
          notes: 'Created by TC-STAFF-HR-001.',
        },
      });
      await expectOk(profileCreate, 'HR profile create');
      const profileBody = (await profileCreate.json()) as { id?: string | null };
      profileId = typeof profileBody.id === 'string' ? profileBody.id : null;
      expect(profileId, 'HR profile id should be returned').toBeTruthy();

      // --- HR profile: read back ------------------------------------------
      // personal_email, date_of_birth and notes are encrypted at rest. If the
      // column types and the cipher disagree the write fails or the read
      // returns ciphertext, so this assertion is what proves both.
      const profileList = await apiRequest(
        request,
        'GET',
        `/api/staff/employee-profiles?memberId=${memberId}&pageSize=1`,
        { token },
      );
      await expectOk(profileList, 'HR profile list');
      const listBody = (await profileList.json()) as { items?: Array<Record<string, unknown>> };
      const row = listBody.items?.[0];
      expect(row, 'HR profile should be listed for its member').toBeTruthy();
      expect(row?.job_title).toBe('Integration Engineer');
      expect(row?.employee_number).toBe(`E-${stamp}`);
      expect(row?.personal_email).toBe(`qa-${stamp}@example.com`);
      expect(row?.date_of_birth).toBe('1990-04-17');
      expect(String(row?.start_date ?? '')).toContain('2026-01-05');

      // --- HR profile: update ---------------------------------------------
      const profileUpdate = await apiRequest(request, 'PUT', '/api/staff/employee-profiles', {
        token,
        data: { id: profileId, jobTitle: 'Senior Integration Engineer' },
      });
      await expectOk(profileUpdate, 'HR profile update');

      // --- validation: an end date before the start is refused -------------
      const badDates = await apiRequest(request, 'PUT', '/api/staff/employee-profiles', {
        token,
        data: { id: profileId, startDate: '2026-03-01', endDate: '2026-02-01' },
      });
      expect(badDates.status(), 'End before start should be rejected').toBeGreaterThanOrEqual(400);

      // --- organisation chart ----------------------------------------------
      const orgStructure = await apiRequest(request, 'GET', '/api/staff/org-structure', { token });
      await expectOk(orgStructure, 'Org structure');
      const org = (await orgStructure.json()) as {
        roles?: Array<{ id: string; name: string; parentRoleId: string | null; members: unknown[] }>;
        unassigned?: Array<{ memberId: string }>;
      };
      expect(Array.isArray(org.roles), 'Org structure should list roles').toBeTruthy();
      expect(Array.isArray(org.unassigned), 'Org structure should list unplaced members').toBeTruthy();
      // The fixture holds no role, so it must appear as unplaced rather than vanish.
      const placedIds = new Set((org.unassigned ?? []).map((entry) => entry.memberId));
      expect(placedIds.has(memberId as string), 'A member with no role should be listed as unplaced').toBeTruthy();

      // --- employee record --------------------------------------------------
      const record = await apiRequest(request, 'POST', '/api/staff/employee-record', {
        token,
        data: { memberId },
      });
      await expectOk(record, 'Employee record generate');
      const recordBody = (await record.json()) as { attachmentId?: string; fileName?: string };
      expect(recordBody.attachmentId, 'Record should return the stored attachment id').toBeTruthy();
      expect(recordBody.fileName ?? '', 'Record should be a markdown file').toContain('.md');

      // --- UI: the new tabs are reachable on the member detail page ---------
      await login(page, 'admin');
      await page.goto(`/backend/staff/team-members/${memberId}`);
      await expect(page.getByRole('tab', { name: 'HR profile' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Account' })).toBeVisible();

      await page.getByRole('tab', { name: 'HR profile' }).click();
      await expect(page.getByText('Senior Integration Engineer')).toBeVisible();

      await page.getByRole('tab', { name: 'Account' }).click();
      // The fixture member has no linked user, so the empty state must explain
      // that rather than showing a broken account panel.
      await expect(page.getByText('No sign-in account')).toBeVisible();

      // --- UI: the org chart page renders ----------------------------------
      await page.goto('/backend/staff/org-chart');
      await expect(page.getByRole('heading', { name: 'Organisation chart' })).toBeVisible();
      await expect(page.getByText(memberName)).toBeVisible();
    } finally {
      if (token && profileId) {
        await apiRequest(request, 'DELETE', `/api/staff/employee-profiles?id=${profileId}`, { token })
          .catch(() => undefined);
      }
      if (token && memberId) {
        await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${memberId}`, { token })
          .catch(() => undefined);
      }
    }
  });

  test('places a role under its parent in the chart, and refuses a reporting loop', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    let token: string | null = null;
    let parentId: string | null = null;
    let childId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      const parentCreate = await apiRequest(request, 'POST', '/api/auth/roles', {
        token,
        data: { name: `QA Parent ${stamp}` },
      });
      await expectOk(parentCreate, 'Parent role create');
      parentId = ((await parentCreate.json()) as { id?: string }).id ?? null;
      expect(parentId).toBeTruthy();

      const childCreate = await apiRequest(request, 'POST', '/api/auth/roles', {
        token,
        data: { name: `QA Child ${stamp}`, parentRoleId: parentId },
      });
      await expectOk(childCreate, 'Child role create');
      childId = ((await childCreate.json()) as { id?: string }).id ?? null;
      expect(childId).toBeTruthy();

      // The chart is built from this field, so it is what proves the column is
      // actually settable rather than merely present.
      const structure = await apiRequest(request, 'GET', '/api/staff/org-structure', { token });
      await expectOk(structure, 'Org structure');
      const org = (await structure.json()) as {
        roles?: Array<{ id: string; parentRoleId: string | null }>;
      };
      const child = org.roles?.find((role) => role.id === childId);
      expect(child, 'Child role should appear in the chart').toBeTruthy();
      expect(child?.parentRoleId, 'Child should report to the parent').toBe(parentId);

      // Closing the loop the other way must be refused: the chart survives a
      // cycle only by breaking the branch, which reads as a bug to the editor.
      const loop = await apiRequest(request, 'PUT', '/api/auth/roles', {
        token,
        data: { id: parentId, parentRoleId: childId },
      });
      expect(loop.status(), 'A reporting loop should be rejected').toBeGreaterThanOrEqual(400);

      const selfLoop = await apiRequest(request, 'PUT', '/api/auth/roles', {
        token,
        data: { id: parentId, parentRoleId: parentId },
      });
      expect(selfLoop.status(), 'A role reporting to itself should be rejected').toBeGreaterThanOrEqual(400);
    } finally {
      for (const id of [childId, parentId]) {
        if (token && id) {
          await apiRequest(request, 'DELETE', `/api/auth/roles?id=${id}`, { token }).catch(() => undefined);
        }
      }
    }
  });
});
