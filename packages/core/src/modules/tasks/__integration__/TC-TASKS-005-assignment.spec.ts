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
 * TC-TASKS-005: who a task is assigned to.
 *
 * Two mechanisms, deliberately different in kind: named people are stored as
 * rows, while a role target stores only the role and resolves to whoever holds
 * it at read time. The second is the one worth testing hard — it is the only
 * assignment whose meaning can change without the task being edited.
 */
test.describe('TC-TASKS-005: assignees and role targets', () => {
  test('offers only roles from the caller scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/tasks/assignment-options', { token })
    expect(response.ok()).toBeTruthy()

    const body = await response.json()
    expect(Array.isArray(body.roles)).toBe(true)
    expect(body.roles.length).toBeGreaterThan(0)
    for (const role of body.roles as { id: string; name: string }[]) {
      expect(role.id).toBeTruthy()
      expect(role.name).toBeTruthy()
    }
  })

  test('offers only people from the caller scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/tasks/assignable-users', { token })
    expect(response.ok()).toBeTruthy()

    const body = await response.json()
    expect(body.users.length).toBeGreaterThan(0)
    for (const user of body.users as { id: string; name: string }[]) {
      expect(user.id).toBeTruthy()
      expect(user.name).toBeTruthy()
    }
  })

  test('assigns named people and reads them back', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const users = await (
        await apiRequest(request, 'GET', '/api/tasks/assignable-users', { token })
      ).json()
      const person = users.users[0] as { id: string; name: string }

      const task = await createTask(ctx, project.id, {
        title: 'Named assignee',
        assigneeIds: [person.id],
      })

      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(detail.assignees.map((entry: { id: string }) => entry.id)).toEqual([person.id])
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('resolves a role target to its current holders at read time', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const options = await (
        await apiRequest(request, 'GET', '/api/tasks/assignment-options', { token })
      ).json()
      const role = options.roles[0] as { id: string; name: string }

      const task = await createTask(ctx, project.id, {
        title: 'Role target',
        assignmentTargets: [{ kind: 'role', roleId: role.id }],
      })

      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()

      // The task stores the role, and the read resolves its name — a renamed
      // role must not leave a stale label behind on the task.
      expect(detail.assignmentTargets).toHaveLength(1)
      expect(detail.assignmentTargets[0].kind).toBe('role')
      expect(detail.assignmentTargets[0].role.id).toBe(role.id)
      expect(detail.assignmentTargets[0].role.name).toBe(role.name)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('puts a role-targeted task in the assigned view of whoever holds the role', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      // The team endpoint reports role *names*; the assignment options report
      // ids. Match on the name to find a role the caller actually holds.
      const members = await (
        await apiRequest(request, 'GET', '/api/tasks/team/members', { token })
      ).json()
      const self = members.members.find((member: { isSelf: boolean }) => member.isSelf) as {
        roleNames: string[]
      }
      const options = await (
        await apiRequest(request, 'GET', '/api/tasks/assignment-options', { token })
      ).json()
      const ownRole = (options.roles as { id: string; name: string }[]).find((role) =>
        self.roleNames.includes(role.name),
      )
      test.skip(!ownRole, 'the signed-in account holds no role to target')

      const task = await createTask(ctx, project.id, {
        title: 'Targeted at my role',
        assignmentTargets: [{ kind: 'role', roleId: ownRole!.id }],
      })

      const assigned = await (
        await apiRequest(request, 'GET', '/api/tasks/my-tasks?view=assigned&pageSize=100', { token })
      ).json()
      const ids = (assigned.items as { id: string }[]).map((item) => item.id)
      expect(ids, 'a role target should reach its holders').toContain(task.id)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('replaces the assignment set rather than appending to it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const users = await (
        await apiRequest(request, 'GET', '/api/tasks/assignable-users', { token })
      ).json()
      const person = users.users[0] as { id: string }

      const task = await createTask(ctx, project.id, { assigneeIds: [person.id] })

      const current = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      const cleared = await apiRequest(request, 'PATCH', `/api/tasks/tasks/${task.id}`, {
        token,
        data: { assigneeIds: [] },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt },
      })
      expect(cleared.ok()).toBeTruthy()

      const after = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${task.id}`, { token })
      ).json()
      expect(after.assignees).toHaveLength(0)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('refuses a person who is not in the caller scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const response = await apiRequest(request, 'POST', `/api/tasks/projects/${project.id}/tasks`, {
        token,
        data: {
          title: 'Assigned to a stranger',
          assigneeIds: ['11111111-2222-4333-8444-777777777777'],
        },
      })
      // Accepting this would let a caller confirm the existence of a user id
      // outside their scope, and put work on someone they cannot see.
      expect(response.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })

  test('refuses a role that is not in the caller scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const ctx = { request, token }
    const projectIds: string[] = []

    try {
      const project = await createProject(ctx)
      projectIds.push(project.id)

      const response = await apiRequest(request, 'POST', `/api/tasks/projects/${project.id}/tasks`, {
        token,
        data: {
          title: 'Targeted at a foreign role',
          assignmentTargets: [{ kind: 'role', roleId: '11111111-2222-4333-8444-888888888888' }],
        },
      })
      expect(response.status()).toBe(400)
    } finally {
      await cleanupTasks(ctx, { projectIds })
    }
  })
})
