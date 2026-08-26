import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createInteractionFixture,
  gridBlockName,
  INTERACTIONS_PATH,
  localTimeAt,
  seedShowWeekendsPreference,
  waitForCalendarLoaded,
} from './helpers/calendarFixtures';

/**
 * TC-CAL-004: Calendar tabs & filtering.
 * Source spec: .ai/specs/2026-06-11-crm-calendar.md ("Integration Test Coverage").
 *
 * - Segment counts are derived from the searched item set (`countByCategory`), so
 *   searching the unique run token first makes the Meetings/Events counts
 *   deterministic even when seeded/demo interactions exist in the same week.
 * - Activating the Meetings segment hides event and task items; Events hides the
 *   meeting; All shows every category.
 * - The search input ([data-calendar-search]) narrows items by title.
 *
 * Fixtures: meeting (10:00) + event (13:00) + task (15:00) today, all sharing
 * a unique `QA Cal Tabs ${stamp}` title prefix.
 */
test.describe('TC-CAL-004: Calendar tabs & filtering', () => {
  test('segment counts, category cuts and title search narrow the visible items', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const runToken = `QA Cal Tabs ${stamp}`;
    const meetingTitle = `${runToken} Meeting`;
    const eventTitle = `${runToken} Event`;
    const taskTitle = `${runToken} Task`;
    let adminToken: string | null = null;
    let personId: string | null = null;
    let meetingId: string | null = null;
    let eventId: string | null = null;
    let taskId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const scope = getTokenScope(adminToken);
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'CalTabs',
        lastName: `Person${stamp}`,
        displayName: `CalTabs Person ${stamp}`,
      });
      meetingId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'meeting',
        title: meetingTitle,
        status: 'planned',
        scheduledAt: localTimeAt(0, 10, 0),
        durationMinutes: 60,
        participants: [{ userId: scope.userId, name: 'QA Admin', email: 'admin@acme.com' }],
      });
      eventId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'event',
        title: eventTitle,
        status: 'planned',
        scheduledAt: localTimeAt(0, 13, 0),
        durationMinutes: 60,
      });
      taskId = await createInteractionFixture(request, adminToken, {
        entityId: personId,
        interactionType: 'task',
        title: taskTitle,
        status: 'planned',
        scheduledAt: localTimeAt(0, 15, 0),
      });

      // Force "Show weekends" on so today's fixtures are visible even on a weekend.
      await seedShowWeekendsPreference(page, scope.userId);

      await login(page, 'admin');
      await page.goto('/backend/calendar');
      await waitForCalendarLoaded(page);

      const meetingBlock = page.getByRole('button', { name: gridBlockName(meetingTitle) });
      const eventBlock = page.getByRole('button', { name: gridBlockName(eventTitle) });
      const taskBlock = page.getByRole('button', { name: gridBlockName(taskTitle) });

      // The category filter is a segmented control (radiogroup), so scope every
      // lookup to it — the view switcher beside it is a radiogroup too.
      const categoryFilter = page.getByRole('radiogroup', { name: 'Calendar category' });

      // -- Narrow to this run's fixtures, then counts are exact ---------------
      await page.locator('[data-calendar-search]').fill(runToken);
      await expect(meetingBlock).toBeVisible();
      await expect(eventBlock).toBeVisible();
      await expect(taskBlock).toBeVisible();
      await expect(categoryFilter.getByRole('radio', { name: 'Meetings (1)' })).toBeVisible();
      await expect(categoryFilter.getByRole('radio', { name: 'Events (1)' })).toBeVisible();

      // -- Meetings segment hides the event and task items ---------------------
      await categoryFilter.getByRole('radio', { name: 'Meetings (1)' }).click();
      await expect(categoryFilter.getByRole('radio', { name: 'Meetings (1)' })).toBeChecked();
      await expect(meetingBlock).toBeVisible();
      await expect(eventBlock).toBeHidden();
      await expect(taskBlock).toBeHidden();

      // -- Events segment shows only the event ---------------------------------
      await categoryFilter.getByRole('radio', { name: 'Events (1)' }).click();
      await expect(categoryFilter.getByRole('radio', { name: 'Events (1)' })).toBeChecked();
      await expect(eventBlock).toBeVisible();
      await expect(meetingBlock).toBeHidden();
      await expect(taskBlock).toBeHidden();

      // -- Back to All Scheduled: every category visible ------------------------
      await categoryFilter.getByRole('radio', { name: 'All Scheduled' }).click();
      await expect(categoryFilter.getByRole('radio', { name: 'All Scheduled' })).toBeChecked();
      await expect(meetingBlock).toBeVisible();
      await expect(eventBlock).toBeVisible();
      await expect(taskBlock).toBeVisible();

      // -- Search narrows to a single fixture by full title ---------------------
      await page.locator('[data-calendar-search]').fill(meetingTitle);
      await expect(meetingBlock).toBeVisible();
      await expect(eventBlock).toBeHidden();
      await expect(taskBlock).toBeHidden();
      await expect(categoryFilter.getByRole('radio', { name: 'Meetings (1)' })).toBeVisible();
      await expect(categoryFilter.getByRole('radio', { name: 'Events (0)' })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, meetingId);
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, eventId);
      await deleteEntityIfExists(request, adminToken, INTERACTIONS_PATH, taskId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId);
    }
  });
});
