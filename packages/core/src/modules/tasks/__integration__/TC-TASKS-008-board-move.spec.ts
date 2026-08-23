import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createProject,
  createTask,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

type BoardTask = { id: string; status: string; rank: number }

async function board(request: Parameters<typeof apiRequest>[0], token: string, projectId: string) {
  const response = await apiRequest(request, 'GET', `/api/tasks/projects/${projectId}/board`, { token })
  return ((await response.json()).tasks as BoardTask[]).sort((a, b) => a.rank - b.rank)
}

function idsIn(tasks: BoardTask[], status: string): string[] {
  return tasks.filter((task) => task.status === status).map((task) => task.id)
}

/**
 * TC-TASKS-008: board ordering. The point of these is that a drag is a
 * *persisted* change — every assertion re-reads the board rather than trusting
 * the move response.
 */
test.describe('TC-TASKS-008: board moves persist', () => {
  test('reorders within a column and survives a reload', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const a = await createTask(ctx, project.id, { title: 'A', status: 'backlog' })
      const b = await createTask(ctx, project.id, { title: 'B', status: 'backlog' })
      const c = await createTask(ctx, project.id, { title: 'C', status: 'backlog' })

      expect(idsIn(await board(request, token, project.id), 'backlog')).toEqual([a.id, b.id, c.id])

      // Move A to sit after C — the bottom of the column.
      const moved = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${a.id}/move`, {
        token,
        data: { status: 'backlog', afterTaskId: c.id },
      })
      expect(moved.ok()).toBeTruthy()

      expect(idsIn(await board(request, token, project.id), 'backlog')).toEqual([b.id, c.id, a.id])

      // Move C to the top.
      await apiRequest(request, 'PATCH', `/api/tasks/tasks/${c.id}/move`, {
        token,
        data: { status: 'backlog', afterTaskId: null },
      })
      expect(idsIn(await board(request, token, project.id), 'backlog')).toEqual([c.id, b.id, a.id])
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('moves between columns and sets completion state', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const task = await createTask(ctx, project.id, { title: 'Crossing', status: 'backlog' })

      await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}/move`, {
        token,
        data: { status: 'done', afterTaskId: null },
      })

      const afterMove = await board(request, token, project.id)
      expect(idsIn(afterMove, 'done')).toEqual([task.id])
      expect(idsIn(afterMove, 'backlog')).toEqual([])

      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(detail.completedAt).not.toBeNull()

      // Moving back out of done clears the completion stamp.
      await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}/move`, {
        token,
        data: { status: 'in_progress', afterTaskId: null },
      })
      const reopened = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(reopened.completedAt).toBeNull()
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('lands a move sensibly when the client anchor is stale', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const a = await createTask(ctx, project.id, { title: 'A', status: 'backlog' })
      const b = await createTask(ctx, project.id, { title: 'B', status: 'backlog' })

      // Anchor on a task that is not in the target column.
      const response = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${a.id}/move`, {
        token,
        data: { status: 'review', afterTaskId: b.id },
      })
      expect(response.ok()).toBeTruthy()
      expect(idsIn(await board(request, token, project.id), 'review')).toEqual([a.id])
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })
})
