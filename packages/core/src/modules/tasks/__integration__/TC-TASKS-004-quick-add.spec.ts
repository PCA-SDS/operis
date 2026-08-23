import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createLabel,
  createProject,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/**
 * TC-TASKS-004: quick add — the parse endpoint resolves references against real
 * records, and the structured result round-trips through the normal create
 * endpoint so every server-side rule still applies.
 */
test.describe('TC-TASKS-004: quick add', () => {
  test('resolves a project, an assignee and labels from one line', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []
    const labelIds: string[] = []

    try {
      const project = await createProject(ctx, { key: 'QADD1', name: 'Quickadd' })
      projectIds.push(project.id)
      const label = await createLabel(ctx, { name: `qa-${Date.now()}` })
      labelIds.push(label.id)

      const users = await (
        await apiRequest(request, 'GET', '/api/tasks/assignable-users', { token })
      ).json()
      const assignee = users.items[0] as { id: string; name: string }
      expect(assignee, 'at least one assignable user is needed').toBeTruthy()

      const parsed = await apiRequest(request, 'POST', '/api/tasks/quick-add/parse', {
        token,
        data: {
          text: `Ship the release #Quickadd @"${assignee.name}" +${label.name} tomorrow at 3pm p1`,
          tz: 'UTC',
        },
      })
      expect(parsed.ok()).toBeTruthy()
      const result = await parsed.json()

      expect(result.title).toBe('Ship the release')
      expect(result.project?.id).toBe(project.id)
      expect(result.assignee?.id).toBe(assignee.id)
      expect(result.labels.map((entry: { id: string }) => entry.id)).toContain(label.id)
      expect(result.dueTime).toBe('15:00')
      expect(result.priority).toBe('urgent')
      expect(result.recognizedTokens.length).toBeGreaterThan(0)

      // Create through the normal endpoint with the parsed fields.
      const created = await apiRequest(request, 'POST', `/api/tasks/projects/${result.project.id}/tasks`, {
        token,
        data: {
          title: result.title,
          status: 'pending',
          priority: result.priority,
          assigneeIds: [result.assignee.id],
          labelIds: result.labels.map((entry: { id: string }) => entry.id),
          dueDate: result.dueDate,
          dueTime: result.dueTime,
          tz: 'UTC',
        },
      })
      expect(created.ok()).toBeTruthy()
      const task = await created.json()
      expect(task.title).toBe('Ship the release')
      expect(task.priority).toBe('urgent')
      expect(task.assignees.map((entry: { id: string }) => entry.id)).toContain(assignee.id)
      expect(task.labels.map((entry: { id: string }) => entry.id)).toContain(label.id)
      expect(task.dueTime).toBe('15:00')
    } finally {
      await cleanupTasks(ctx, { projectIds, labelIds })
    }
  })

  test('warns rather than guessing when a reference does not resolve', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const parsed = await apiRequest(request, 'POST', '/api/tasks/quick-add/parse', {
      token,
      data: { text: 'Ship it #NoSuchProjectAnywhere', tz: 'UTC' },
    })
    const result = await parsed.json()
    expect(result.project).toBeNull()
    expect(result.warnings.map((warning: { code: string }) => warning.code)).toContain('projectNotFound')
  })

  test('returns structured warning codes, never prose', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const parsed = await apiRequest(request, 'POST', '/api/tasks/quick-add/parse', {
      token,
      data: { text: 'Standup every 2 weeks', tz: 'UTC' },
    })
    const result = await parsed.json()
    expect(result.warnings.length).toBeGreaterThan(0)
    for (const warning of result.warnings) {
      // Codes keep the message translatable on the client.
      expect(typeof warning.code).toBe('string')
      expect(warning).not.toHaveProperty('message')
    }
  })

  test('rejects text past the one-line cap', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', '/api/tasks/quick-add/parse', {
      token,
      data: { text: 'x'.repeat(501), tz: 'UTC' },
    })
    expect(response.status()).toBe(400)
  })
})
