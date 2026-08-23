import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createProject,
  createTask,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

function isoDay(offsetDays: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

/** TC-TASKS-014/015/016: the personal views, the calendar and the team surface. */
test.describe('TC-TASKS-014: personal views, calendar and team', () => {
  test('each view applies its own predicate', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const overdue = await createTask(ctx, project.id, { title: 'Overdue', dueDate: isoDay(-3) })
      const future = await createTask(ctx, project.id, { title: 'Future', dueDate: isoDay(30) })
      const undated = await createTask(ctx, project.id, { title: 'Undated' })
      const finished = await createTask(ctx, project.id, { title: 'Finished', status: 'done' })

      const idsIn = async (view: string): Promise<string[]> => {
        const response = await apiRequest(
          request,
          'GET',
          `/api/tasks/my-tasks?view=${view}&pageSize=100&tz=UTC`,
          { token },
        )
        return ((await response.json()).items as { id: string }[]).map((item) => item.id)
      }

      const all = await idsIn('all')
      expect(all).toEqual(expect.arrayContaining([overdue.id, future.id, undated.id]))
      // Every view but `completed` shows open work only.
      expect(all).not.toContain(finished.id)

      const today = await idsIn('today')
      expect(today).toContain(overdue.id)
      expect(today).not.toContain(future.id)
      expect(today).not.toContain(undated.id)

      const upcoming = await idsIn('upcoming')
      expect(upcoming).toEqual(expect.arrayContaining([overdue.id, future.id]))
      expect(upcoming).not.toContain(undated.id)

      const completed = await idsIn('completed')
      expect(completed).toContain(finished.id)
      expect(completed).not.toContain(undated.id)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('shows only tasks assigned to the caller in the assigned view', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const me = await (await apiRequest(request, 'GET', '/api/tasks/team/members', { token })).json()
      const self = me.members.find((member: { isSelf: boolean }) => member.isSelf)
      expect(self, 'the caller should be listed in their own team').toBeTruthy()

      const mine = await createTask(ctx, project.id, { title: 'Mine', assigneeIds: [self.id] })
      const notMine = await createTask(ctx, project.id, { title: 'Not mine' })

      const response = await apiRequest(request, 'GET', '/api/tasks/my-tasks?view=assigned&pageSize=100', {
        token,
      })
      const ids = ((await response.json()).items as { id: string }[]).map((item) => item.id)
      expect(ids).toContain(mine.id)
      expect(ids).not.toContain(notMine.id)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('searches across title and description', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []
    const stamp = Date.now()

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const match = await createTask(ctx, project.id, { title: `Zephyr ${stamp}` })
      const noMatch = await createTask(ctx, project.id, { title: 'Something else' })

      const response = await apiRequest(
        request,
        'GET',
        `/api/tasks/my-tasks?view=all&pageSize=100&search=Zephyr%20${stamp}`,
        { token },
      )
      const ids = ((await response.json()).items as { id: string }[]).map((item) => item.id)
      expect(ids).toContain(match.id)
      expect(ids).not.toContain(noMatch.id)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('places tasks on the calendar by due date and by completion', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const me = await (await apiRequest(request, 'GET', '/api/tasks/team/members', { token })).json()
      const self = me.members.find((member: { isSelf: boolean }) => member.isSelf)

      const due = isoDay(2)
      const scheduled = await createTask(ctx, project.id, {
        title: 'On the calendar',
        dueDate: due,
        dueTime: '10:00',
        assigneeIds: [self.id],
      })

      const window = `from=${isoDay(-1)}&to=${isoDay(10)}&tz=UTC`
      const scheduledView = await (
        await apiRequest(request, 'GET', `/api/tasks/my-tasks/calendar?mode=scheduled&${window}`, {
          token,
        })
      ).json()

      const placed = scheduledView.items.find((item: { id: string }) => item.id === scheduled.id)
      expect(placed, 'the task should appear on its due day').toBeTruthy()
      expect(placed.calendarDate).toBe(due)
      expect(placed.calendarTime).toBe('10:00')
      expect(scheduledView.truncated).toBe(false)

      // The done view is keyed on completion, so an open task is not in it.
      const doneView = await (
        await apiRequest(request, 'GET', `/api/tasks/my-tasks/calendar?mode=done&${window}`, { token })
      ).json()
      expect(doneView.items.map((item: { id: string }) => item.id)).not.toContain(scheduled.id)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('lists the caller first among their team', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/tasks/team/members', { token })
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body.members.length).toBeGreaterThan(0)
    expect(body.members[0].isSelf).toBe(true)
  })

  test('lets the caller read their own board and forbids an unknown peer', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const members = await (
      await apiRequest(request, 'GET', '/api/tasks/team/members', { token })
    ).json()
    const self = members.members.find((member: { isSelf: boolean }) => member.isSelf)

    const own = await apiRequest(request, 'GET', `/api/tasks/team/members/${self.id}/board`, { token })
    expect(own.ok()).toBeTruthy()

    const stranger = '11111111-2222-4333-8444-777777777777'
    const foreign = await apiRequest(request, 'GET', `/api/tasks/team/members/${stranger}/board`, {
      token,
    })
    expect(foreign.status()).toBe(403)
  })
})
