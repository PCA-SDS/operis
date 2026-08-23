import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createProject,
  createTask,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/** TC-TASKS-010/011: task comments and project documentation pages. */
test.describe('TC-TASKS-010: comments and docs', () => {
  test('posts, edits and deletes a comment, and counts it on the task', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const task = await createTask(ctx, project.id)

      const created = await apiRequest(request, 'POST', `/api/tasks/tasks/${task.id}/comments`, {
        token,
        data: { body: '<p>First note</p>', plaintext: 'First note' },
      })
      expect(created.ok()).toBeTruthy()
      const comment = await created.json()
      expect(comment.plaintext).toBe('First note')
      // Authorship comes from the session, never the payload.
      expect(comment.author).not.toBeNull()
      expect(comment.isEdited).toBe(false)

      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(detail.commentCount).toBe(1)

      const edited = await apiRequest(request, 'PATCH', `/api/tasks/comments/${comment.id}`, {
        token,
        data: { body: '<p>Edited note</p>', plaintext: 'Edited note' },
      })
      expect((await edited.json()).plaintext).toBe('Edited note')

      const deleted = await apiRequest(request, 'DELETE', `/api/tasks/comments/${comment.id}`, { token })
      expect(deleted.ok()).toBeTruthy()

      const after = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(after.commentCount).toBe(0)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('rejects an empty comment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const task = await createTask(ctx, project.id)

      const response = await apiRequest(request, 'POST', `/api/tasks/tasks/${task.id}/comments`, {
        token,
        data: { body: '<p></p>', plaintext: '   ' },
      })
      expect(response.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('builds a page tree and keeps sub-pages when a parent is deleted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const root = await (
        await apiRequest(request, 'POST', `/api/tasks/projects/${project.id}/docs`, {
          token,
          data: { title: 'Specs', body: '<p>Root</p>', plaintext: 'Root' },
        })
      ).json()

      const child = await (
        await apiRequest(request, 'POST', `/api/tasks/projects/${project.id}/docs`, {
          token,
          data: { title: 'Details', parentId: root.id },
        })
      ).json()
      expect(child.parentId).toBe(root.id)

      const tree = await (
        await apiRequest(request, 'GET', `/api/tasks/projects/${project.id}/docs`, { token })
      ).json()
      expect(tree.items).toHaveLength(2)
      // The tree carries titles and hierarchy only — bodies are fetched per page.
      expect(tree.items[0]).not.toHaveProperty('body')

      await apiRequest(request, 'DELETE', `/api/tasks/docs/${root.id}`, { token })

      const afterDelete = await (
        await apiRequest(request, 'GET', `/api/tasks/projects/${project.id}/docs`, { token })
      ).json()
      // The sub-page survives, moved up a level.
      expect(afterDelete.items).toHaveLength(1)
      expect(afterDelete.items[0].id).toBe(child.id)
      expect(afterDelete.items[0].parentId).toBeNull()
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('rejects a page cycle', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const a = await (
        await apiRequest(request, 'POST', `/api/tasks/projects/${project.id}/docs`, {
          token,
          data: { title: 'A' },
        })
      ).json()
      const b = await (
        await apiRequest(request, 'POST', `/api/tasks/projects/${project.id}/docs`, {
          token,
          data: { title: 'B', parentId: a.id },
        })
      ).json()

      const response = await apiRequest(request, 'PATCH', `/api/tasks/docs/${a.id}`, {
        token,
        data: { parentId: b.id },
      })
      expect(response.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })
})
