import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createLabel,
  createMilestone,
  createProject,
  createTask,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/** TC-TASKS-012/013: milestones and the label catalog. */
test.describe('TC-TASKS-012: milestones and labels', () => {
  test('derives milestone progress from the tasks pointing at it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const milestone = await createMilestone(ctx, project.id, { name: 'v1', dueDate: '2026-09-01' })

      await createTask(ctx, project.id, { title: 'One', milestoneId: milestone.id, status: 'done' })
      await createTask(ctx, project.id, { title: 'Two', milestoneId: milestone.id })
      await createTask(ctx, project.id, { title: 'Three', milestoneId: milestone.id })
      // A task outside the milestone must not move its numbers.
      await createTask(ctx, project.id, { title: 'Unrelated' })

      const list = await (
        await apiRequest(request, 'GET', `/api/tasks/projects/${project.id}/milestones`, { token })
      ).json()
      const found = list.items.find((item: { id: string }) => item.id === milestone.id)
      expect(found.taskCount).toBe(3)
      expect(found.doneTaskCount).toBe(1)
      expect(found.progress).toBe(33)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('keeps a milestone deletion from taking its tasks', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const milestone = await createMilestone(ctx, project.id)
      const task = await createTask(ctx, project.id, { milestoneId: milestone.id })

      await apiRequest(request, 'DELETE', `/api/tasks/milestones/${milestone.id}`, { token })

      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(detail.milestoneId).toBeNull()
      expect(detail.title).toBeTruthy()
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('rejects a milestone from another project', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const projectA = await createProject(ctx)
      const projectB = await createProject(ctx)
      projectIds.push(projectA.id, projectB.id)
      const foreign = await createMilestone(ctx, projectB.id)

      const response = await apiRequest(request, 'POST', `/api/tasks/projects/${projectA.id}/tasks`, {
        token,
        data: { title: 'Wrong milestone', milestoneId: foreign.id },
      })
      expect(response.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('counts label usage and clears the label off tasks when deleted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []
    const labelIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const label = await createLabel(ctx)
      labelIds.push(label.id)

      const task = await createTask(ctx, project.id, { labelIds: [label.id] })

      const list = await (await apiRequest(request, 'GET', '/api/tasks/labels', { token })).json()
      const found = list.items.find((item: { id: string }) => item.id === label.id)
      expect(found.taskCount).toBe(1)

      await apiRequest(request, 'DELETE', `/api/tasks/labels/${label.id}`, { token })
      labelIds.length = 0

      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(detail.labels).toHaveLength(0)
    } finally {
      await cleanupTasks(ctx, { projectIds, labelIds })
    }
  })

  test('rejects a duplicate label name', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const labelIds: string[] = []
    const name = `dup-${Date.now()}`

    try {
      const first = await createLabel(ctx, { name })
      labelIds.push(first.id)

      const second = await apiRequest(request, 'POST', '/api/tasks/labels', {
        token,
        data: { name },
      })
      expect(second.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { labelIds })
    }
  })
})
