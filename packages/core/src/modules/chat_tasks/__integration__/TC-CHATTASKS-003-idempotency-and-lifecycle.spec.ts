import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteRoleIfExists, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  cleanupChatTasks,
  createColleague,
  createTaskFromConversation,
  newIdempotencyKey,
  openDirectConversation,
  sendMessage,
  type Colleague,
} from '@open-mercato/core/helpers/integration/chatTasksFixtures'

export const integrationMeta = { dependsOnModules: ['chat', 'tasks', 'chat_tasks'] }

const CREATOR = ['chat.view', 'chat.send', 'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign']

/**
 * TC-CHATTASKS-003: the things that go wrong when a button is pressed twice.
 *
 * Duplicate submissions, reused keys, a recurring task completed twice, and the three
 * separate acts that a careless implementation would conflate — unlinking, removing a
 * card, and deleting a task.
 */
test.describe('TC-CHATTASKS-003: idempotency, recurrence and lifecycle', () => {
  test('the same key with the same details converges on one task', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'idem-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'idem-bob', CREATOR)
      const conversationId = await openDirectConversation({ request, token: alice.token }, bob.id)

      const key = newIdempotencyKey('idem')
      const payload = { idempotencyKey: key, title: 'Only once', tz: 'UTC' }

      const first = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        { token: alice.token, data: payload },
      )
      expect(first.ok()).toBeTruthy()
      const created = await first.json()
      taskIds.push(created.taskId)
      expect(created.replayed).toBe(false)

      // The retry a timed-out request, a double click or a reconnect produces.
      const second = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        { token: alice.token, data: payload },
      )
      expect(second.ok()).toBeTruthy()
      const replayed = await second.json()
      expect(replayed.replayed).toBe(true)
      expect(replayed.taskId).toBe(created.taskId)
      expect(replayed.linkId).toBe(created.linkId)

      /**
       * A replay must report the card the link actually has.
       *
       * Answering `cardPublished: false` for a create whose card was posted told
       * the user "the task was created but its card could not be posted here" and
       * offered a retry that then failed with `card_already_published` — a dead
       * end reached by doing nothing worse than double-clicking.
       */
      expect(replayed.cardPublished).toBe(true)
      expect(replayed.cardMessageId).toBe(created.cardMessageId)

      // And exactly one task exists with that title, not two.
      const listed = await apiRequest(
        request,
        'GET',
        '/api/tasks/my-tasks?view=all&pageSize=100&search=Only%20once',
        { token: alice.token },
      )
      const matches = (await listed.json()).items.filter(
        (item: { title: string }) => item.title === 'Only once',
      )
      expect(matches).toHaveLength(1)

      // One link and one card, too — the panel shows the task once.
      const panel = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/tasks?state=all`,
        { token: alice.token },
      )
      expect((await panel.json()).items).toHaveLength(1)
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

  test('the same key with different details is refused rather than answered', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'reuse-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'reuse-bob', CREATOR)
      const conversationId = await openDirectConversation({ request, token: alice.token }, bob.id)

      const key = newIdempotencyKey('reuse')
      const first = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        { token: alice.token, data: { idempotencyKey: key, title: 'First intent', tz: 'UTC' } },
      )
      expect(first.ok()).toBeTruthy()
      taskIds.push((await first.json()).taskId)

      /**
       * Answering "already done" here would hand back a task the caller never described.
       * `code` distinguishes this from "still in progress", because the two need
       * different recoveries.
       */
      const reused = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        { token: alice.token, data: { idempotencyKey: key, title: 'A different task', tz: 'UTC' } },
      )
      expect(reused.status()).toBe(409)
      expect((await reused.json()).code).toBe('idempotency_key_reuse')

      // And the second title created nothing.
      const listed = await apiRequest(
        request,
        'GET',
        '/api/tasks/my-tasks?view=all&pageSize=100&search=A%20different%20task',
        { token: alice.token },
      )
      expect((await listed.json()).items).toHaveLength(0)
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

  test('one person’s key cannot replay another person’s result', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'actor-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'actor-bob', CREATOR)
      const conversationId = await openDirectConversation({ request, token: alice.token }, bob.id)

      // The actor is part of the key, so the same string is a different claim for a
      // different person — otherwise a guessed key would hand over a task id.
      const key = newIdempotencyKey('shared')
      const mine = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        { token: alice.token, data: { idempotencyKey: key, title: 'Alice task', tz: 'UTC', assigneeIds: [alice.id] } },
      )
      expect(mine.ok()).toBeTruthy()
      const aliceTask = await mine.json()
      taskIds.push(aliceTask.taskId)

      const theirs = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        { token: bob.token, data: { idempotencyKey: key, title: 'Bob task', tz: 'UTC', assigneeIds: [bob.id] } },
      )
      expect(theirs.ok()).toBeTruthy()
      const bobTask = await theirs.json()
      taskIds.push(bobTask.taskId)

      // Two tasks, not one replayed answer.
      expect(bobTask.taskId).not.toBe(aliceTask.taskId)
      expect(bobTask.replayed).toBe(false)
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

  test('two simultaneous submissions with one key create one task', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'race-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'race-bob', CREATOR)
      const conversationId = await openDirectConversation({ request, token: alice.token }, bob.id)

      const key = newIdempotencyKey('race')
      const payload = { idempotencyKey: key, title: 'Raced task', tz: 'UTC' }

      /**
       * A genuine double-click: both requests in flight at once, neither having seen the
       * other's claim. The unique index picks a winner and the loser either replays it or
       * is told the first attempt is still running — but never creates a second task.
       */
      const [first, second] = await Promise.all([
        apiRequest(request, 'POST', `/api/chat_tasks/conversations/${conversationId}/tasks`, {
          token: alice.token,
          data: payload,
        }),
        apiRequest(request, 'POST', `/api/chat_tasks/conversations/${conversationId}/tasks`, {
          token: alice.token,
          data: payload,
        }),
      ])

      const statuses = [first.status(), second.status()].sort((left, right) => left - right)
      // 200/200 when the loser replayed a finished claim; 200/409 when it met one still
      // in flight. Both are correct; two 200s with two different task ids would not be.
      expect(statuses[0]).toBe(200)
      expect([200, 409]).toContain(statuses[1])

      for (const response of [first, second]) {
        if (response.status() !== 200) continue
        taskIds.push((await response.json()).taskId)
      }

      const listed = await apiRequest(
        request,
        'GET',
        '/api/tasks/my-tasks?view=all&pageSize=100&search=Raced%20task',
        { token: alice.token },
      )
      const matches = (await listed.json()).items.filter(
        (item: { title: string }) => item.title === 'Raced task',
      )
      expect(matches).toHaveLength(1)
    } finally {
      if (alice) {
        await cleanupChatTasks({ request, token: alice.token }, { taskIds: [...new Set(taskIds)] })
        await deleteUserIfExists(request, adminToken, alice.id)
        await deleteRoleIfExists(request, adminToken, alice.roleId)
      }
      if (bob) {
        await deleteUserIfExists(request, adminToken, bob.id)
        await deleteRoleIfExists(request, adminToken, bob.roleId)
      }
    }
  })

  test('completing a recurring task advances it, and a stale retry cannot advance it twice', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'rec-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'rec-bob', CREATOR)
      const ctx = { request, token: alice.token }
      const conversationId = await openDirectConversation(ctx, bob.id)

      const created = await createTaskFromConversation(ctx, conversationId, {
        title: 'Weekly standup notes',
        tz: 'UTC',
        dueDate: '2026-09-14',
        recurrence: { freq: 'weekly' },
        assigneeIds: [alice.id],
      })
      taskIds.push(created.taskId)

      const before = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, { token: alice.token })
      ).json()
      expect(before.recurrence?.freq).toBe('weekly')
      const firstDue = before.dueDate?.slice(0, 10)

      // Completed WITH the expected version, the way a card does.
      const completed = await apiRequest(
        request,
        'PATCH',
        `/api/tasks/tasks/${created.taskId}/complete`,
        {
          token: alice.token,
          data: { tz: 'UTC' },
          headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: before.updatedAt },
        },
      )
      expect(completed.ok()).toBeTruthy()
      const after = await completed.json()

      /**
       * A recurring task is never "done": it rolls to its next occurrence and resets to
       * pending. A card that reported "completed" here would be lying, and the next
       * refetch would contradict it.
       */
      expect(after.status).toBe('pending')
      expect(after.completedAt).toBeNull()
      expect(after.dueDate?.slice(0, 10)).not.toBe(firstDue)

      /**
       * The retry. Same request, same now-stale version — which is exactly what a
       * re-sent timed-out PATCH or a double tap produces. Without the guard this would
       * advance the deadline a second week, silently.
       */
      const stale = await apiRequest(
        request,
        'PATCH',
        `/api/tasks/tasks/${created.taskId}/complete`,
        {
          token: alice.token,
          data: { tz: 'UTC' },
          headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: before.updatedAt },
        },
      )
      expect(stale.status()).toBe(409)
      expect((await stale.json()).code).toBe('optimistic_lock_conflict')

      // The due date did not move again.
      const unchanged = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, { token: alice.token })
      ).json()
      expect(unchanged.dueDate?.slice(0, 10)).toBe(after.dueDate?.slice(0, 10))
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

  test('unlinking, removing the card and deleting the task are three separate acts', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'life-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'life-bob', CREATOR)
      const ctx = { request, token: alice.token }
      const conversationId = await openDirectConversation(ctx, bob.id)

      const created = await createTaskFromConversation(ctx, conversationId, {
        title: 'Survives unlinking',
        tz: 'UTC',
        assigneeIds: [alice.id],
      })
      taskIds.push(created.taskId)

      // 1. Removing the card leaves the link, so it can be re-posted.
      const removedCard = await apiRequest(
        request,
        'DELETE',
        `/api/chat_tasks/links/${created.linkId}?removeCard=true`,
        { token: alice.token },
      )
      expect(removedCard.ok()).toBeTruthy()

      // 2. The task is untouched. No cascade travels from a link to a task, because
      //    there is no foreign key for one to travel down.
      const task = await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, {
        token: alice.token,
      })
      expect(task.ok()).toBeTruthy()
      expect((await task.json()).title).toBe('Survives unlinking')

      // 3. The panel no longer lists it — the link is gone.
      const panel = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/tasks?state=all`,
        { token: alice.token },
      )
      expect((await panel.json()).items).toEqual([])

      // 4. It can be linked again, which is what makes the unique index partial.
      const relinked = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/links`,
        { token: alice.token, data: { taskId: created.taskId } },
      )
      expect(relinked.ok()).toBeTruthy()
      const relink = await relinked.json()
      expect(relink.linkId).toBeTruthy()
      expect(relink.cardPublished).toBe(true)

      // 5. Linking the SAME task again converges rather than stacking a second card.
      const again = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/links`,
        { token: alice.token, data: { taskId: created.taskId } },
      )
      expect(again.ok()).toBeTruthy()
      expect((await again.json()).linkId).toBe(relink.linkId)
      const afterRelink = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/tasks?state=all`,
        { token: alice.token },
      )
      expect((await afterRelink.json()).items).toHaveLength(1)

      // 6. Deleting the TASK does not delete the link row — and the link degrades to
      //    "unavailable" rather than 500ing or disappearing silently.
      const deleted = await apiRequest(request, 'DELETE', `/api/tasks/tasks/${created.taskId}`, {
        token: alice.token,
      })
      expect(deleted.ok()).toBeTruthy()
      const afterDelete = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/tasks?state=all`,
        { token: alice.token },
      )
      expect(afterDelete.ok()).toBeTruthy()
      const body = await afterDelete.json()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].available).toBe(false)
      expect(body.counts.unavailable).toBe(1)
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

  test('a task raised from a message copies nothing from it by default', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'msg-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'msg-bob', CREATOR)
      const ctx = { request, token: alice.token }
      const conversationId = await openDirectConversation(ctx, bob.id)

      const secret = 'The margin on this deal is only 4% — do not tell the client'
      const messageId = await sendMessage({ request, token: bob.token }, conversationId, secret)

      const created = await createTaskFromConversation(ctx, conversationId, {
        title: 'Check the margin',
        tz: 'UTC',
        sourceMessageId: messageId,
        assigneeIds: [alice.id],
      })
      taskIds.push(created.taskId)

      /**
       * Nothing from the message — not its text, not its author's name, not the
       * conversation's title — is anywhere in the task. The reference is kept on the
       * link, behind this module's own authorized boundary.
       */
      const detail = await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, {
        token: alice.token,
      })
      const body = await detail.text()
      expect(body).not.toContain(secret)
      expect(body).not.toContain('QA ChatTasks msg-bob')
      expect(body).not.toContain(conversationId)
      expect(body).not.toContain(messageId)

      const task = JSON.parse(body)
      expect(task.title).toBe('Check the margin')
      expect(task.description).toBe('')
      expect(task.descriptionPlaintext).toBe('')

      // The source is reachable only through this module's own route, and only for a
      // reader who is currently in the conversation.
      const sources = await (
        await apiRequest(request, 'GET', `/api/chat_tasks/tasks/${created.taskId}/sources`, {
          token: alice.token,
        })
      ).json()
      expect(sources.items[0].messageId).toBe(messageId)

      // Explicit copying is a different request, and what it copies is what was shown.
      const explicit = await createTaskFromConversation(ctx, conversationId, {
        title: 'Check the margin again',
        tz: 'UTC',
        sourceMessageId: messageId,
        description: secret,
        descriptionPlaintext: secret,
        assigneeIds: [alice.id],
      })
      taskIds.push(explicit.taskId)
      const copied = await (
        await apiRequest(request, 'GET', `/api/tasks/tasks/${explicit.taskId}`, { token: alice.token })
      ).json()
      expect(copied.descriptionPlaintext).toContain('margin on this deal')
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

  test('a deleted source message stops being offered as a link', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'del-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'del-bob', CREATOR)
      const ctx = { request, token: alice.token }
      const conversationId = await openDirectConversation(ctx, bob.id)

      const messageId = await sendMessage(ctx, conversationId, 'This will be deleted')
      const created = await createTaskFromConversation(ctx, conversationId, {
        title: 'Outlives its source',
        tz: 'UTC',
        sourceMessageId: messageId,
        assigneeIds: [alice.id],
      })
      taskIds.push(created.taskId)

      const deleted = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${conversationId}/messages/${messageId}`,
        { token: alice.token },
      )
      expect(deleted.ok()).toBeTruthy()

      // The conversation is still a valid source; the message reference is dropped,
      // because a link to a message that cannot be shown is worse than none.
      const sources = await (
        await apiRequest(request, 'GET', `/api/chat_tasks/tasks/${created.taskId}/sources`, {
          token: alice.token,
        })
      ).json()
      expect(sources.items).toHaveLength(1)
      expect(sources.items[0].conversationId).toBe(conversationId)
      expect(sources.items[0].messageId).toBeNull()

      // And naming a deleted message on a NEW task is refused outright.
      const refused = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        {
          token: alice.token,
          data: {
            idempotencyKey: newIdempotencyKey('del'),
            title: 'From a ghost',
            tz: 'UTC',
            sourceMessageId: messageId,
          },
        },
      )
      expect(refused.status()).toBe(404)
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
