import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createProject,
  uniqueProjectKey,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/**
 * TC-TASKS-001: project lifecycle — create, read, update, archive, restore,
 * delete, plus the key-uniqueness rule that every task reference depends on.
 */
test.describe('TC-TASKS-001: project lifecycle', () => {
  test('creates, updates, archives, restores and deletes a project', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx, { name: 'QA Lifecycle', description: 'Created by QA' })
      projectIds.push(project.id)
      expect(project.key).toMatch(/^[A-Z][A-Z0-9]{1,9}$/)

      const read = await apiRequest(request, 'GET', `/api/tasks/projects/${project.id}`, { token })
      expect(read.ok()).toBeTruthy()
      const detail = await read.json()
      expect(detail.name).toBe('QA Lifecycle')
      expect(detail.isInbox).toBe(false)
      expect(detail.taskCount).toBe(0)
      expect(detail.openTaskCount).toBe(0)

      const updated = await apiRequest(request, 'PATCH', `/api/tasks/projects/${project.id}`, {
        token,
        data: { name: 'QA Lifecycle Renamed' },
      })
      expect(updated.ok()).toBeTruthy()
      expect((await updated.json()).name).toBe('QA Lifecycle Renamed')

      const archived = await apiRequest(request, 'PATCH', `/api/tasks/projects/${project.id}/archive`, {
        token,
        data: { archived: true },
      })
      expect(archived.ok()).toBeTruthy()
      expect((await archived.json()).archivedAt).not.toBeNull()

      // The default list hides archived projects; the archived filter shows them.
      const activeList = await apiRequest(request, 'GET', '/api/tasks/projects?pageSize=100', { token })
      const activeIds = (await activeList.json()).items.map((item: { id: string }) => item.id)
      expect(activeIds).not.toContain(project.id)

      const archivedList = await apiRequest(
        request,
        'GET',
        '/api/tasks/projects?archived=archived&pageSize=100',
        { token },
      )
      const archivedIds = (await archivedList.json()).items.map((item: { id: string }) => item.id)
      expect(archivedIds).toContain(project.id)

      const restored = await apiRequest(request, 'PATCH', `/api/tasks/projects/${project.id}/archive`, {
        token,
        data: { archived: false },
      })
      expect(restored.ok()).toBeTruthy()
      expect((await restored.json()).archivedAt).toBeNull()

      const deleted = await apiRequest(request, 'DELETE', `/api/tasks/projects/${project.id}`, { token })
      expect(deleted.ok()).toBeTruthy()
      projectIds.length = 0

      const gone = await apiRequest(request, 'GET', `/api/tasks/projects/${project.id}`, { token })
      expect(gone.status()).toBe(404)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('rejects a duplicate project key', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []
    const key = uniqueProjectKey('DUP')

    try {
      const first = await createProject(ctx, { key })
      projectIds.push(first.id)

      const second = await apiRequest(request, 'POST', '/api/tasks/projects', {
        token,
        data: { key, name: 'Duplicate' },
      })
      expect(second.status()).toBe(400)
      expect((await second.json()).error).toContain(key)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('rejects a malformed project key rather than normalising it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    for (const key of ['E', '1ENG', 'EN-G', 'ENGINEERING1']) {
      const response = await apiRequest(request, 'POST', '/api/tasks/projects', {
        token,
        data: { key, name: 'Bad key' },
      })
      expect(response.status(), `key ${key} should be rejected`).toBe(400)
    }
  })
})
