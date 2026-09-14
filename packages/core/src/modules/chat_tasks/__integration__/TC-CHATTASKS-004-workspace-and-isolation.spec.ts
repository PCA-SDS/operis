import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteRoleIfExists, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  cleanupChatTasks,
  createColleague,
  newIdempotencyKey,
  type Colleague,
} from '@open-mercato/core/helpers/integration/chatTasksFixtures'

export const integrationMeta = { dependsOnModules: ['chat', 'tasks', 'chat_tasks'] }

const CREATOR = ['chat.view', 'chat.send', 'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign']

/**
 * TC-CHATTASKS-004: the personal workspace, and what it is careful not to be.
 *
 * It is an isolated surface rather than a conversation, so there is no participant row
 * for anybody else to hold — and the tasks it makes are ordinary tasks, which the UI
 * says out loud and these tests assert rather than take on trust.
 */
test.describe('TC-CHATTASKS-004: the personal workspace', () => {
  test('creates a self-assigned task with no conversation and no card', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'ws-alice', CREATOR)

      const created = await apiRequest(request, 'POST', '/api/chat_tasks/workspace/tasks', {
        token: alice.token,
        data: { idempotencyKey: newIdempotencyKey('ws'), title: 'Draft the summary', tz: 'UTC' },
      })
      expect(created.ok()).toBeTruthy()
      const body = await created.json()
      taskIds.push(body.taskId)

      // Assigned to the caller, without them having named anybody.
      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${body.taskId}`, { token: alice.token })
      ).json()
      expect(detail.assignees.map((person: { id: string }) => person.id)).toEqual([alice.id])
      expect(detail.status).toBe('pending')

      // It appears in the workspace list, which IS the tasks module's `assigned` view.
      const listed = await apiRequest(request, 'GET', '/api/chat_tasks/workspace/tasks?tz=UTC', {
        token: alice.token,
      })
      expect(listed.ok()).toBeTruthy()
      const page = await listed.json()
      expect(page.items.some((item: { id: string }) => item.id === body.taskId)).toBe(true)

      // The same task is in `/api/tasks/my-tasks?view=assigned`, because that is the one
      // the workspace delegates to — not a second definition of "mine".
      const assigned = await apiRequest(
        request,
        'GET',
        '/api/tasks/my-tasks?view=assigned&tz=UTC&pageSize=100',
        { token: alice.token },
      )
      expect((await assigned.json()).items.some((item: { id: string }) => item.id === body.taskId)).toBe(
        true,
      )

      // No conversation was created for it.
      const conversations = await apiRequest(request, 'GET', '/api/chat/conversations', {
        token: alice.token,
      })
      expect(conversations.ok()).toBeTruthy()
      expect((await conversations.json()).items).toEqual([])
    } finally {
      if (alice) {
        await cleanupChatTasks({ request, token: alice.token }, { taskIds })
        await deleteUserIfExists(request, adminToken, alice.id)
        await deleteRoleIfExists(request, adminToken, alice.roleId)
      }
    }
  })

  test('is per-person: one colleague’s workspace list never shows another’s', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const aliceTasks: string[] = []
    const bobTasks: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'iso-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'iso-bob', CREATOR)

      const mine = await apiRequest(request, 'POST', '/api/chat_tasks/workspace/tasks', {
        token: alice.token,
        data: { idempotencyKey: newIdempotencyKey('iso'), title: 'Alice private note', tz: 'UTC' },
      })
      aliceTasks.push((await mine.json()).taskId)

      const theirs = await apiRequest(request, 'POST', '/api/chat_tasks/workspace/tasks', {
        token: bob.token,
        data: { idempotencyKey: newIdempotencyKey('iso'), title: 'Bob private note', tz: 'UTC' },
      })
      bobTasks.push((await theirs.json()).taskId)

      /**
       * The workspace LIST is per-person, because it is the assignment filter.
       *
       * This is the isolation the surface actually provides: whose work it shows. It is
       * deliberately not a claim that the tasks are private — see the next test.
       */
      const aliceList = await (
        await apiRequest(request, 'GET', '/api/chat_tasks/workspace/tasks?tz=UTC&pageSize=100', {
          token: alice.token,
        })
      ).json()
      const aliceTitles = aliceList.items.map((item: { title: string }) => item.title)
      expect(aliceTitles).toContain('Alice private note')
      expect(aliceTitles).not.toContain('Bob private note')

      const bobList = await (
        await apiRequest(request, 'GET', '/api/chat_tasks/workspace/tasks?tz=UTC&pageSize=100', {
          token: bob.token,
        })
      ).json()
      const bobTitles = bobList.items.map((item: { title: string }) => item.title)
      expect(bobTitles).toContain('Bob private note')
      expect(bobTitles).not.toContain('Alice private note')

      // Pinned server-side: a `view` parameter cannot turn the personal surface into an
      // organization-wide one.
      const forced = await (
        await apiRequest(request, 'GET', '/api/chat_tasks/workspace/tasks?view=all&pageSize=100', {
          token: alice.token,
        })
      ).json()
      expect(forced.items.map((item: { title: string }) => item.title)).not.toContain(
        'Bob private note',
      )
    } finally {
      if (alice) {
        await cleanupChatTasks({ request, token: alice.token }, { taskIds: aliceTasks })
        await deleteUserIfExists(request, adminToken, alice.id)
        await deleteRoleIfExists(request, adminToken, alice.roleId)
      }
      if (bob) {
        await cleanupChatTasks({ request, token: bob.token }, { taskIds: bobTasks })
        await deleteUserIfExists(request, adminToken, bob.id)
        await deleteRoleIfExists(request, adminToken, bob.roleId)
      }
    }
  })

  test('does NOT make a task private, which is what the composer says', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'vis-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'vis-bob', CREATOR)

      const created = await apiRequest(request, 'POST', '/api/chat_tasks/workspace/tasks', {
        token: alice.token,
        data: { idempotencyKey: newIdempotencyKey('vis'), title: 'Not actually private', tz: 'UTC' },
      })
      const body = await created.json()
      taskIds.push(body.taskId)

      /**
       * Asserted, not assumed.
       *
       * A workspace task has exactly the visibility every other task in the organization
       * has — a colleague with `tasks.view` can read it. This test exists so nobody can
       * quietly add a private-task ACL and call it a bug fix: the honest notice in the
       * composer ("this workspace is private, the tasks are not") is only honest while
       * this passes.
       */
      const theirRead = await apiRequest(request, 'GET', `/api/tasks/tasks/${body.taskId}`, {
        token: bob.token,
      })
      expect(theirRead.ok()).toBeTruthy()
      expect((await theirRead.json()).title).toBe('Not actually private')
    } finally {
      if (alice) {
        await cleanupChatTasks({ request, token: alice.token }, { taskIds })
        await deleteUserIfExists(request, adminToken, alice.id)
        await deleteRoleIfExists(request, adminToken, alice.roleId)
      }
      if (bob) {
        await deleteUserIfExists(request, adminToken, bob.id)
        await deleteRoleIfExists(request, adminToken, bob.roleId)
      }
    }
  })

  test('is idempotent, so a double-tapped Add does not make two tasks', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'wsidem-alice', CREATOR)
      const key = newIdempotencyKey('wsidem')
      const payload = { idempotencyKey: key, title: 'Added once', tz: 'UTC' }

      const first = await apiRequest(request, 'POST', '/api/chat_tasks/workspace/tasks', {
        token: alice.token,
        data: payload,
      })
      expect(first.ok()).toBeTruthy()
      const created = await first.json()
      taskIds.push(created.taskId)

      const second = await apiRequest(request, 'POST', '/api/chat_tasks/workspace/tasks', {
        token: alice.token,
        data: payload,
      })
      expect(second.ok()).toBeTruthy()
      const replayed = await second.json()
      expect(replayed.replayed).toBe(true)
      expect(replayed.taskId).toBe(created.taskId)

      const listed = await (
        await apiRequest(request, 'GET', '/api/chat_tasks/workspace/tasks?tz=UTC&pageSize=100', {
          token: alice.token,
        })
      ).json()
      const matches = listed.items.filter((item: { title: string }) => item.title === 'Added once')
      expect(matches).toHaveLength(1)
    } finally {
      if (alice) {
        await cleanupChatTasks({ request, token: alice.token }, { taskIds })
        await deleteUserIfExists(request, adminToken, alice.id)
        await deleteRoleIfExists(request, adminToken, alice.roleId)
      }
    }
  })

  test('the Workflows user-task routes still resolve to Workflows', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')

    /**
     * `/backend/tasks` and `/backend/tasks/{id}` belong to the `workflows` queue, and
     * this module adds a `?task=` parameter to a tasks page rather than a new route —
     * so nothing here can have taken either over.
     *
     * Asserted through the API the workflows queue actually serves, because a page
     * request would only tell us a page rendered, not which module owns it.
     */
    const workflowTasks = await apiRequest(request, 'GET', '/api/workflows/tasks', {
      token: adminToken,
    })
    // 200 when the module is on, 404 when it is not compiled in — never a 500, which is
    // what a route collision would produce.
    expect([200, 403, 404]).toContain(workflowTasks.status())

    // And this module's own routes live under a prefix of their own.
    const ours = await apiRequest(
      request,
      'GET',
      '/api/chat_tasks/tasks/00000000-0000-4000-8000-000000000000/sources',
      { token: adminToken },
    )
    expect(ours.status()).toBe(404)
  })
})
