import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteRoleIfExists, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  cleanupChatTasks,
  createColleague,
  createSpace,
  createTaskFromConversation,
  newIdempotencyKey,
  openDirectConversation,
  type Colleague,
} from '@open-mercato/core/helpers/integration/chatTasksFixtures'

export const integrationMeta = { dependsOnModules: ['chat', 'tasks', 'chat_tasks'] }

const CREATOR = ['chat.view', 'chat.send', 'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign']

/**
 * TC-CHATTASKS-001: raising a task from a conversation.
 *
 * The end-to-end flow the integration exists for — open a conversation, create a task
 * from it, get a real task back with a card in the transcript — plus the two
 * assignment rules that differ by conversation kind.
 */
test.describe('TC-CHATTASKS-001: creating a task from a conversation', () => {
  test('a direct conversation defaults the assignee to the other person', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    expect(organizationId, 'the admin token should carry an organization').toBeTruthy()

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'bob', CREATOR)
      const ctx = { request, token: alice.token }

      const conversationId = await openDirectConversation(ctx, bob.id)

      // 1. The composer's own defaults, resolved from server-verified membership.
      const composer = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/composer`,
        { token: alice.token },
      )
      expect(composer.ok()).toBeTruthy()
      const context = await composer.json()
      expect(context.kind).toBe('direct')
      expect(context.defaultAssignee?.id).toBe(bob.id)
      expect(context.requiresExplicitAssignee).toBe(false)
      expect(context.canCreate).toBe(true)
      // The Inbox is where a task with no project goes, exactly as quick-add behaves.
      expect(context.inboxProjectId).toBeTruthy()

      // 2. Creating with no assignee named at all uses that default.
      const created = await createTaskFromConversation(ctx, conversationId, {
        title: 'Prepare the proposal',
        tz: 'UTC',
      })
      taskIds.push(created.taskId)
      expect(created.task.title).toBe('Prepare the proposal')
      expect(created.cardPublished).toBe(true)
      expect(created.cardMessageId).toBeTruthy()
      expect(created.replayed).toBe(false)

      // 3. It is a REAL task in the tasks module, not a copy of one.
      const detail = await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, {
        token: alice.token,
      })
      expect(detail.ok()).toBeTruthy()
      const task = await detail.json()
      expect(task.assignees.map((person: { id: string }) => person.id)).toEqual([bob.id])
      // Work raised from a conversation is meant to be started, not filed.
      expect(task.status).toBe('pending')
      // Whoever raised it is its reviewer and reporter, as with any other create.
      expect(task.reporter?.id).toBe(alice.id)

      // 4. The card is a row in the transcript, and it carries no text of its own —
      //    which is what keeps a task title out of chat's search index and preview.
      const messages = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${conversationId}/messages`,
        { token: alice.token },
      )
      const page = await messages.json()
      const card = page.items.find((item: { id: string }) => item.id === created.cardMessageId)
      expect(card, 'the card row should be in the transcript').toBeTruthy()
      expect(card.kind).toBe('system')
      expect(card.systemEvent).toBe('card')
      expect(card.body).toBe('')

      // 5. And the card resolves to the task for a viewer who may read it.
      const cards = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/cards?messageIds=${created.cardMessageId}`,
        { token: alice.token },
      )
      expect(cards.ok()).toBeTruthy()
      const resolved = await cards.json()
      expect(resolved.items).toHaveLength(1)
      expect(resolved.items[0].available).toBe(true)
      expect(resolved.items[0].task.title).toBe('Prepare the proposal')
      expect(resolved.items[0].task.reference).toMatch(/^[A-Z][A-Z0-9]*-\d+$/)

      // 6. Bob sees the same card — the other participant's authorized read.
      const bobCards = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/cards?messageIds=${created.cardMessageId}`,
        { token: bob.token },
      )
      expect(bobCards.ok()).toBeTruthy()
      expect((await bobCards.json()).items[0].task.title).toBe('Prepare the proposal')
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

  test('a space has no default assignee and refuses a create without one', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'space-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'space-bob', CREATOR)
      const ctx = { request, token: alice.token }

      const conversationId = await createSpace(ctx, [bob.id])

      const composer = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/composer`,
        { token: alice.token },
      )
      const context = await composer.json()
      expect(context.kind).toBe('space')
      // No default, and the client is told to ask. `@everyone` is never expanded into
      // a list of assignees — a task addressed to a room is a task nobody owns.
      expect(context.defaultAssignee).toBeNull()
      expect(context.requiresExplicitAssignee).toBe(true)
      expect(context.suggestedAssignees.map((person: { id: string }) => person.id)).toContain(bob.id)

      // Refused, rather than silently assigned to a participant.
      const refused = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        {
          token: alice.token,
          data: { idempotencyKey: newIdempotencyKey('space'), title: 'Nobody owns this', tz: 'UTC' },
        },
      )
      expect(refused.status()).toBe(400)

      // With an explicit assignee it succeeds.
      const created = await createTaskFromConversation(ctx, conversationId, {
        title: 'Review the contract',
        assigneeIds: [bob.id],
        tz: 'UTC',
      })
      taskIds.push(created.taskId)
      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, { token: alice.token })
      ).json()
      expect(detail.assignees.map((person: { id: string }) => person.id)).toEqual([bob.id])
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

  test('honours the quick-add grammar the tasks module already ships', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'qa-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'qa-bob', CREATOR)
      const ctx = { request, token: alice.token }
      const conversationId = await openDirectConversation(ctx, bob.id)

      /**
       * The composer runs the tasks module's own parser and then creates through this
       * endpoint with the parsed fields. This asserts the round trip end to end: the
       * parse endpoint is the authority, and the fields it returns are the ones that
       * get stored.
       */
      const parsed = await apiRequest(request, 'POST', '/api/tasks/quick-add/parse', {
        token: alice.token,
        data: { text: 'Ship the release tomorrow 3pm p1', tz: 'UTC' },
      })
      expect(parsed.ok()).toBeTruthy()
      const interpretation = await parsed.json()
      expect(interpretation.title).toBe('Ship the release')
      expect(interpretation.dueTime).toBe('15:00')
      expect(interpretation.priority).toBe('urgent')
      expect(interpretation.dueDate).toBeTruthy()

      const created = await createTaskFromConversation(ctx, conversationId, {
        title: interpretation.title,
        dueDate: interpretation.dueDate,
        dueTime: interpretation.dueTime,
        priority: interpretation.priority,
        tz: 'UTC',
      })
      taskIds.push(created.taskId)

      const detail = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, { token: alice.token })
      ).json()
      expect(detail.title).toBe('Ship the release')
      expect(detail.dueTime).toBe('15:00')
      expect(detail.priority).toBe('urgent')
      expect(detail.dueDate?.slice(0, 10)).toBe(interpretation.dueDate)
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
})
