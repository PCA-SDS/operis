import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupTasks,
  createLabel,
  createProject,
  createTask,
} from '@open-mercato/core/helpers/integration/tasksFixtures'

export const integrationMeta = { dependsOnModules: ['tasks'] }

/**
 * TC-TASKS-017/018/022: the security properties.
 *
 * Every read and write is scoped by tenant AND organization server-side. These
 * probe the boundary directly rather than trusting that the UI never asks — an
 * id is guessable, and a 404 on someone else's record is the whole contract.
 */
test.describe('TC-TASKS-017: scope isolation and input safety', () => {
  test('refuses every unauthenticated request', async ({ request }) => {
    const paths = [
      '/api/tasks/projects',
      '/api/tasks/labels',
      '/api/tasks/my-tasks?view=today',
      '/api/tasks/inbox',
      '/api/tasks/assignable-users',
      '/api/tasks/team/members',
    ]
    for (const path of paths) {
      const response = await request.get(path)
      expect([401, 403], `${path} must not be public`).toContain(response.status())
    }
  })

  test('answers 404 for a well-formed id that does not exist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ghost = '11111111-2222-4333-8444-555555555555'

    for (const path of [
      `/api/tasks/projects/${ghost}`,
      `/api/tasks/tasks/${ghost}`,
      `/api/tasks/docs/${ghost}`,
    ]) {
      const response = await apiRequest(request, 'GET', path, { token })
      expect(response.status(), path).toBe(404)
    }
  })

  test('rejects a malformed id rather than leaking a query error', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/tasks/projects/not-a-uuid', { token })
    expect([400, 404]).toContain(response.status())
    const body = await response.text()
    // No stack traces, SQL, or table names in the response.
    expect(body).not.toMatch(/select |from |tasks_tasks|at Object\./i)
  })

  test('refuses to assign a task to a user id from outside the scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const stranger = '11111111-2222-4333-8444-999999999999'

      const response = await apiRequest(request, 'POST', `/api/tasks/projects/${project.id}/tasks`, {
        token,
        data: { title: 'Cross-scope assignment', assigneeIds: [stranger] },
      })
      expect(response.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('refuses a label id from outside the scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)
      const stranger = '11111111-2222-4333-8444-888888888888'

      const response = await apiRequest(request, 'POST', `/api/tasks/projects/${project.id}/tasks`, {
        token,
        data: { title: 'Cross-scope label', labelIds: [stranger] },
      })
      expect(response.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('ignores scope fields smuggled into a request body', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      // Scope always comes from the session, never the payload.
      const response = await apiRequest(request, 'POST', '/api/tasks/projects', {
        token,
        data: {
          key: 'MASS01',
          name: 'Mass assignment probe',
          tenantId: '11111111-2222-4333-8444-000000000001',
          organizationId: '11111111-2222-4333-8444-000000000002',
          isInbox: true,
          taskSeq: 500,
        },
      })
      expect(response.ok()).toBeTruthy()
      const project = await response.json()
      projectIds.push(project.id)

      // The smuggled `isInbox` must not have taken.
      expect(project.isInbox).toBe(false)

      // …and the project is readable in the caller's own scope, which it would
      // not be had the tenant/organization overrides been honoured.
      const read = await apiRequest(request, 'GET', `/api/tasks/projects/${project.id}`, { token })
      expect(read.ok()).toBeTruthy()

      // The task counter starts at zero regardless of the smuggled seed.
      const task = await createTask(ctx, project.id, { title: 'First' })
      expect(task.number).toBe(1)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('strips script content out of rich text before storing it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const payload = '<p>Hello<script>alert(1)</script><img src=x onerror="alert(2)"></p>'
      const task = await createTask(ctx, project.id, {
        title: 'XSS probe',
        description: payload,
        descriptionPlaintext: 'Hello',
      })

      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(detail.description).not.toContain('<script')
      expect(detail.description).not.toContain('onerror')
      expect(detail.description).toContain('Hello')

      const comment = await apiRequest(request, 'POST', `/api/tasks/tasks/${task.id}/comments`, {
        token,
        data: { body: payload, plaintext: 'Hello' },
      })
      const commentBody = await comment.json()
      expect(commentBody.body).not.toContain('<script')
      expect(commentBody.body).not.toContain('onerror')
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('caps the calendar window instead of letting a caller pull a year', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      '/api/tasks/my-tasks/calendar?mode=scheduled&from=2026-01-01&to=2026-12-31&tz=UTC',
      { token },
    )
    expect(response.status()).toBe(400)
  })

  test('caps the page size on every list endpoint', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    for (const path of [
      '/api/tasks/projects?pageSize=100000',
      '/api/tasks/my-tasks?view=all&pageSize=100000',
    ]) {
      const response = await apiRequest(request, 'GET', path, { token })
      expect(response.status(), path).toBe(400)
    }
  })
})
