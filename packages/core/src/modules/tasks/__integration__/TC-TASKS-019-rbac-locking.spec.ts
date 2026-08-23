import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  cleanupTasks,
  createProject,
  createTask,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/**
 * TC-TASKS-019/021: authorization on every write, and the concurrent-edit
 * contract. Both are properties the UI cannot be trusted to enforce.
 */
test.describe('TC-TASKS-019: authorization and concurrent edits', () => {
  test('grants the seeded employee role the read and write features it needs', async ({ request }) => {
    // The default grants are part of the module's setup contract: an employee
    // can run their own work without being able to reshape the workspace.
    const token = await getAuthToken(request, 'employee')

    const canRead = await apiRequest(request, 'GET', '/api/tasks/my-tasks?view=today&tz=UTC', { token })
    expect(canRead.ok(), 'employee should read their own tasks').toBeTruthy()

    const canSeeProjects = await apiRequest(request, 'GET', '/api/tasks/projects', { token })
    expect(canSeeProjects.ok(), 'employee should read projects').toBeTruthy()
  })

  test('refuses project management to a role without the grant', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const response = await apiRequest(request, 'POST', '/api/tasks/projects', {
      token,
      data: { key: 'NOPE01', name: 'Should not exist' },
    })
    // 403 when the feature is denied; a 200 here would be a privilege escalation.
    expect(response.status(), 'employee must not create projects').toBe(403)
  })

  test('refuses label-catalog management to a role without the grant', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const response = await apiRequest(request, 'POST', '/api/tasks/labels', {
      token,
      data: { name: `nope-${Date.now()}` },
    })
    expect(response.status()).toBe(403)
  })

  test('refuses a stale task edit with the documented 409 body', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const task = await createTask(ctx, project.id, { title: 'Contended' })

      const original = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      const staleStamp = original.updatedAt as string

      // Someone else saves first.
      const first = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}`, {
        token,
        data: { title: 'Saved by the first editor' },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: staleStamp },
      })
      expect(first.ok()).toBeTruthy()

      // The second editor is still holding the stamp they loaded.
      const second = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}`, {
        token,
        data: { title: 'Saved by the second editor' },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: staleStamp },
      })
      expect(second.status(), 'the stale save must be refused').toBe(409)
      const body = await second.json()
      expect(body.code).toBe('optimistic_lock_conflict')

      // The first editor's write is what survived — the second did not clobber it.
      const current = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(current.title).toBe('Saved by the first editor')
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('accepts a write that carries the current stamp', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const task = await createTask(ctx, project.id)

      const current = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()

      const response = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}`, {
        token,
        data: { title: 'Fresh save' },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt },
      })
      expect(response.ok()).toBeTruthy()
      expect((await response.json()).title).toBe('Fresh save')
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })
})
