import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createProject,
  createTask,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/**
 * TC-TASKS-006/007: completing a task, reopening it, and the rule that makes a
 * recurring task roll forward instead of finishing.
 */
test.describe('TC-TASKS-006: completion and recurrence', () => {
  test('completes and reopens a plain task', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const task = await createTask(ctx, project.id, { status: 'pending' })

      const completed = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}/complete`, {
        token,
        data: { tz: 'UTC' },
      })
      expect(completed.ok()).toBeTruthy()
      const done = await completed.json()
      expect(done.status).toBe('done')
      expect(done.completedAt).not.toBeNull()

      const reopened = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}/reopen`, { token })
      const open = await reopened.json()
      expect(open.status).toBe('pending')
      expect(open.completedAt).toBeNull()
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('rolls a recurring task forward instead of finishing it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const task = await createTask(ctx, project.id, {
        title: 'Daily standup',
        status: 'pending',
        recurrence: { freq: 'daily' },
        tz: 'UTC',
      })

      const detail = await (await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })).json()
      expect(detail.recurrence?.freq).toBe('daily')
      // A recurrence with no due date still gets a first occurrence.
      expect(detail.dueDate).not.toBeNull()
      const firstDue = detail.dueDate as string

      const completed = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}/complete`, {
        token,
        data: { tz: 'UTC' },
      })
      const rolled = await completed.json()

      // There is only ever one row per recurring commitment.
      expect(rolled.status).toBe('pending')
      expect(rolled.completedAt).toBeNull()
      expect(rolled.dueDate > firstDue).toBe(true)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('changing status through the update endpoint records completion time', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const task = await createTask(ctx, project.id, { status: 'in_progress' })

      const toDone = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}`, {
        token,
        data: { status: 'done' },
      })
      expect((await toDone.json()).completedAt).not.toBeNull()

      const back = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}`, {
        token,
        data: { status: 'in_progress' },
      })
      expect((await back.json()).completedAt).toBeNull()
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })
})
