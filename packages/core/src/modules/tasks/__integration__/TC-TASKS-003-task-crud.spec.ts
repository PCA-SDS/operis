import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createProject,
  createTask,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/**
 * TC-TASKS-003: task lifecycle and the per-project reference sequence every
 * task is identified by.
 */
test.describe('TC-TASKS-003: task lifecycle', () => {
  test('numbers tasks sequentially per project', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const projectA = await createProject(ctx, { key: 'SEQA1' })
      const projectB = await createProject(ctx, { key: 'SEQB1' })
      projectIds.push(projectA.id, projectB.id)

      const a1 = await createTask(ctx, projectA.id, { title: 'First' })
      const a2 = await createTask(ctx, projectA.id, { title: 'Second' })
      const b1 = await createTask(ctx, projectB.id, { title: 'Other project' })

      expect(a1.number).toBe(1)
      expect(a2.number).toBe(2)
      // Each project counts independently — a task reference is scoped to it.
      expect(b1.number).toBe(1)
      expect(a1.projectKey).toBe('SEQA1')
      expect(b1.projectKey).toBe('SEQB1')
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('creates, edits and deletes a task', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const task = await createTask(ctx, project.id, {
        title: 'Draft the brief',
        priority: 'high',
        status: 'pending',
        dueDate: '2026-06-01',
        dueTime: '09:30',
      })
      expect(task.number).toBe(1)

      const read = await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      const detail = await read.json()
      expect(detail.title).toBe('Draft the brief')
      expect(detail.priority).toBe('high')
      expect(detail.dueDate).toBe('2026-06-01')
      expect(detail.dueTime).toBe('09:30')
      expect(detail.reporter).not.toBeNull()
      // Whoever creates a task is its reviewer.
      expect(detail.reviewer?.id).toBe(detail.reporter?.id)

      const updated = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}`, {
        token,
        data: { title: 'Draft the brief v2', priority: 'urgent' },
      })
      expect(updated.ok()).toBeTruthy()
      const updatedBody = await updated.json()
      expect(updatedBody.title).toBe('Draft the brief v2')
      expect(updatedBody.priority).toBe('urgent')
      // Untouched fields survive a partial update.
      expect(updatedBody.dueDate).toBe('2026-06-01')

      const deleted = await apiRequest(request, 'DELETE', `/api/tasks/tasks/${task.id}`, { token })
      expect(deleted.ok()).toBeTruthy()
      expect((await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })).status()).toBe(404)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('clearing the due date clears the time that hangs off it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const task = await createTask(ctx, project.id, { dueDate: '2026-06-01', dueTime: '09:30' })

      const cleared = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}`, {
        token,
        data: { dueDate: null },
      })
      const body = await cleared.json()
      expect(body.dueDate).toBeNull()
      expect(body.dueTime).toBeNull()
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('rejects a due time with no due date', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const response = await apiRequest(request, 'POST', `/api/tasks/projects/${project.id}/tasks`, {
        token,
        data: { title: 'Timed but undated', dueTime: '09:30' },
      })
      expect(response.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })
})
