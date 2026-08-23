import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createProject,
  createTask,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/**
 * TC-TASKS-009: subtasks — nesting, the progress counter's exclusion rules, and
 * the cycle guard that stops a task becoming its own ancestor.
 */
test.describe('TC-TASKS-009: subtasks', () => {
  test('counts open and done children, excluding cancelled ones', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const parent = await createTask(ctx, project.id, { title: 'Parent' })

      await createTask(ctx, project.id, { title: 'Open child', parentTaskId: parent.id })
      await createTask(ctx, project.id, { title: 'Done child', parentTaskId: parent.id, status: 'done' })
      await createTask(ctx, project.id, {
        title: 'Cancelled child',
        parentTaskId: parent.id,
        status: 'cancelled',
      })

      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${parent.id}`, { token })
      ).json()

      // Cancelled work is neither outstanding nor an achievement, so it is out
      // of both halves of the counter.
      expect(detail.subtaskCount).toBe(2)
      expect(detail.subtaskDoneCount).toBe(1)
      expect(detail.subtasks).toHaveLength(3)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('nests to any depth and reports the parent on the child', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const a = await createTask(ctx, project.id, { title: 'A' })
      const b = await createTask(ctx, project.id, { title: 'B', parentTaskId: a.id })
      const c = await createTask(ctx, project.id, { title: 'C', parentTaskId: b.id })

      const detail = await (await apiRequest(request, 'GET', `/api/tasks/tasks/${c.id}`, { token })).json()
      expect(detail.parentTaskId).toBe(b.id)
      expect(detail.parent?.title).toBe('B')
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('rejects a cycle at every depth', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const a = await createTask(ctx, project.id, { title: 'A' })
      const b = await createTask(ctx, project.id, { title: 'B', parentTaskId: a.id })
      const c = await createTask(ctx, project.id, { title: 'C', parentTaskId: b.id })

      for (const [child, parent] of [
        [a.id, a.id],
        [a.id, b.id],
        [a.id, c.id],
      ]) {
        const response = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${child}`, {
          token,
          data: { parentTaskId: parent },
        })
        expect(response.status(), `${child} under ${parent} should be rejected`).toBe(400)
      }
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('rejects a parent from another project', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const projectA = await createProject(ctx)
      const projectB = await createProject(ctx)
      projectIds.push(projectA.id, projectB.id)

      const foreign = await createTask(ctx, projectB.id, { title: 'Elsewhere' })
      const response = await apiRequest(request, 'POST', `/api/tasks/projects/${projectA.id}/tasks`, {
        token,
        data: { title: 'Child', parentTaskId: foreign.id },
      })
      expect(response.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('deleting a parent takes its whole subtree', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const a = await createTask(ctx, project.id, { title: 'A' })
      const b = await createTask(ctx, project.id, { title: 'B', parentTaskId: a.id })
      const c = await createTask(ctx, project.id, { title: 'C', parentTaskId: b.id })

      await apiRequest(request, 'DELETE', `/api/tasks/tasks/${a.id}`, { token })

      for (const id of [a.id, b.id, c.id]) {
        const response = await apiRequest(request, 'GET', `/api/tasks/tasks/${id}`, { token })
        expect(response.status(), `${id} should be gone`).toBe(404)
      }
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })
})
