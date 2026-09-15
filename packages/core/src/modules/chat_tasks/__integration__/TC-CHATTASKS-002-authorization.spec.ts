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
  sendMessage,
  type Colleague,
} from '@open-mercato/core/helpers/integration/chatTasksFixtures'

export const integrationMeta = { dependsOnModules: ['chat', 'tasks', 'chat_tasks'] }

const CREATOR = ['chat.view', 'chat.send', 'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign']
/** A chat member with no task access at all. */
const CHAT_ONLY = ['chat.view', 'chat.send']
/** Every task grant and every chat grant — but membership of no conversation. */
const TASK_ADMIN = ['chat.view', 'chat.send', 'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign']

/**
 * TC-CHATTASKS-002: the two boundaries, asserted in both directions.
 *
 * Chat access never grants task access, and task access never grants chat access. Every
 * test here is about somebody who legitimately holds one side and must not receive the
 * other — which is the property the whole integration rests on.
 */
test.describe('TC-CHATTASKS-002: chat access and task access stay independent', () => {
  test('a chat member without task access sees a card with no task details in it', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'auth-alice', CREATOR)
      // Bob is in the conversation and has no task grant whatsoever.
      bob = await createColleague(request, adminToken, organizationId, 'auth-bob', CHAT_ONLY)
      const ctx = { request, token: alice.token }

      const conversationId = await openDirectConversation(ctx, bob.id)
      const created = await createTaskFromConversation(ctx, conversationId, {
        title: 'Confidential proposal wording',
        tz: 'UTC',
        assigneeIds: [alice.id],
      })
      taskIds.push(created.taskId)

      // Bob can read the conversation, and the card resolves for him as unavailable.
      const cards = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/cards?messageIds=${created.cardMessageId}`,
        { token: bob.token },
      )
      expect(cards.ok()).toBeTruthy()
      const body = await cards.text()
      const parsed = JSON.parse(body)
      expect(parsed.items).toHaveLength(1)
      expect(parsed.items[0].available).toBe(false)
      expect(parsed.items[0].task).toBeNull()

      // Nothing about the task is anywhere in the payload — not the title, not the
      // reference, not the project, not the status, not even the id.
      for (const secret of ['Confidential proposal wording', created.task.reference, created.taskId]) {
        expect(body).not.toContain(secret)
      }

      // The panel tells him honestly that there is something he cannot see, as a count.
      const panel = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/tasks?state=all`,
        { token: bob.token },
      )
      expect(panel.ok()).toBeTruthy()
      const panelBody = await panel.text()
      expect(JSON.parse(panelBody).counts.unavailable).toBe(1)
      expect(panelBody).not.toContain('Confidential proposal wording')

      // And he cannot reach the task directly either — the tasks module refuses him.
      const direct = await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, {
        token: bob.token,
      })
      expect(direct.ok()).toBeFalsy()
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

  test('a full task administrator who is not in the conversation learns nothing about it', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    let outsider: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'src-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'src-bob', CREATOR)
      outsider = await createColleague(request, adminToken, organizationId, 'src-outsider', TASK_ADMIN)
      const ctx = { request, token: alice.token }

      const conversationId = await openDirectConversation(ctx, bob.id)
      const messageId = await sendMessage(ctx, conversationId, 'The client is unhappy about the price')
      const created = await createTaskFromConversation(ctx, conversationId, {
        title: 'Follow up with the client',
        tz: 'UTC',
        sourceMessageId: messageId,
      })
      taskIds.push(created.taskId)

      // The outsider CAN read the task: they hold every task grant in the scope, and
      // project membership is not an access boundary in this product.
      const task = await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, {
        token: outsider.token,
      })
      expect(task.ok()).toBeTruthy()

      /**
       * And yet the source is invisible to them. Not masked, not counted — absent.
       * Reporting "1 hidden source" would tell somebody with full task access that a
       * private conversation about this task exists, which is the relationship being
       * protected.
       */
      const sources = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/tasks/${created.taskId}/sources`,
        { token: outsider.token },
      )
      expect(sources.ok()).toBeTruthy()
      const sourcesBody = await sources.text()
      expect(JSON.parse(sourcesBody).items).toEqual([])
      expect(sourcesBody).not.toContain(conversationId)
      expect(sourcesBody).not.toContain(messageId)

      // Alice, who is in it, does see the source and its message.
      const mine = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/tasks/${created.taskId}/sources`,
        { token: alice.token },
      )
      const mineBody = await mine.json()
      expect(mineBody.items).toHaveLength(1)
      expect(mineBody.items[0].conversationId).toBe(conversationId)
      expect(mineBody.items[0].messageId).toBe(messageId)

      // The outsider also cannot read the conversation, the panel or the cards — 404
      // rather than 403, so they cannot tell an existing conversation from a made-up id.
      for (const endpoint of [
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        `/api/chat_tasks/conversations/${conversationId}/composer`,
        `/api/chat_tasks/conversations/${conversationId}/cards?messageIds=${created.cardMessageId}`,
      ]) {
        const response = await apiRequest(request, 'GET', endpoint, { token: outsider.token })
        expect(response.status(), endpoint).toBe(404)
      }
    } finally {
      if (alice) {
        await cleanupChatTasks({ request, token: alice.token }, { taskIds })
        await deleteUserIfExists(request, adminToken, alice.id)
        await deleteRoleIfExists(request, adminToken, alice.roleId)
      }
      for (const person of [bob, outsider]) {
        if (!person) continue
        await deleteUserIfExists(request, adminToken, person.id)
        await deleteRoleIfExists(request, adminToken, person.roleId)
      }
    }
  })

  test('a guessed conversation id, a guessed task id and a mismatched message are all refused', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let alice: Colleague | null = null
    let bob: Colleague | null = null
    let carol: Colleague | null = null
    const taskIds: string[] = []

    try {
      alice = await createColleague(request, adminToken, organizationId, 'atk-alice', CREATOR)
      bob = await createColleague(request, adminToken, organizationId, 'atk-bob', CREATOR)
      carol = await createColleague(request, adminToken, organizationId, 'atk-carol', CREATOR)
      const ctx = { request, token: alice.token }

      const mine = await openDirectConversation(ctx, bob.id)
      // A conversation Alice is not in: Bob and Carol, opened by Bob.
      const theirs = await openDirectConversation({ request, token: bob.token }, carol.id)
      const theirMessageId = await sendMessage({ request, token: bob.token }, theirs, 'Between us')

      // A conversation that does not exist at all.
      const invented = '00000000-0000-4000-8000-000000000000'
      for (const conversationId of [theirs, invented]) {
        const response = await apiRequest(
          request,
          'POST',
          `/api/chat_tasks/conversations/${conversationId}/tasks`,
          {
            token: alice.token,
            data: { idempotencyKey: newIdempotencyKey('atk'), title: 'Not mine', tz: 'UTC' },
          },
        )
        // The same answer for both, which is the point: one cannot be told from the other.
        expect(response.status()).toBe(404)
      }

      /**
       * A source message from another conversation, named against one Alice IS in.
       *
       * Without the server-side check this would record somebody else's private message
       * as this task's origin, and then show it to everyone who can read Alice's
       * conversation.
       */
      const mismatched = await apiRequest(request, 'POST', `/api/chat_tasks/conversations/${mine}/tasks`, {
        token: alice.token,
        data: {
          idempotencyKey: newIdempotencyKey('atk'),
          title: 'Borrowed context',
          tz: 'UTC',
          sourceMessageId: theirMessageId,
        },
      })
      expect(mismatched.status()).toBe(404)

      // A guessed task id cannot be linked into a conversation Alice controls.
      const linked = await apiRequest(request, 'POST', `/api/chat_tasks/conversations/${mine}/links`, {
        token: alice.token,
        data: { taskId: invented },
      })
      expect(linked.status()).toBe(404)

      // Nor can a guessed task id be probed for its source conversations.
      const sources = await apiRequest(request, 'GET', `/api/chat_tasks/tasks/${invented}/sources`, {
        token: alice.token,
      })
      expect(sources.status()).toBe(404)

      // A guessed link id is refused the same way.
      const link = await apiRequest(request, 'GET', `/api/chat_tasks/links/${invented}`, {
        token: alice.token,
      })
      expect(link.status()).toBe(404)
    } finally {
      if (alice) {
        await cleanupChatTasks({ request, token: alice.token }, { taskIds })
      }
      for (const person of [alice, bob, carol]) {
        if (!person) continue
        await deleteUserIfExists(request, adminToken, person.id)
        await deleteRoleIfExists(request, adminToken, person.roleId)
      }
    }
  })

  test('creating needs the task grant, and assigning to somebody else needs the assign grant', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let chatOnly: Colleague | null = null
    let noAssign: Colleague | null = null
    let peer: Colleague | null = null
    const taskIds: string[] = []

    try {
      chatOnly = await createColleague(request, adminToken, organizationId, 'grant-chatonly', CHAT_ONLY)
      noAssign = await createColleague(request, adminToken, organizationId, 'grant-noassign', [
        'chat.view',
        'chat.send',
        'tasks.view',
        'tasks.create',
      ])
      peer = await createColleague(request, adminToken, organizationId, 'grant-peer', CREATOR)

      // Chat membership alone grants nothing: the route's own feature gate refuses.
      const chatOnlyConversation = await openDirectConversation(
        { request, token: chatOnly.token },
        peer.id,
      )
      const refusedCreate = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${chatOnlyConversation}/tasks`,
        {
          token: chatOnly.token,
          data: { idempotencyKey: newIdempotencyKey('grant'), title: 'Not allowed', tz: 'UTC' },
        },
      )
      expect([401, 403]).toContain(refusedCreate.status())

      /**
       * `tasks.create` without `tasks.assign`, in a DIRECT conversation.
       *
       * The composer would default the assignee to the counterpart, and defaulting to
       * somebody else is still assigning to them — so this is refused rather than
       * quietly handing work to a colleague on the strength of chat membership.
       */
      const conversation = await openDirectConversation({ request, token: noAssign.token }, peer.id)
      const refusedAssign = await apiRequest(
        request,
        'POST',
        `/api/chat_tasks/conversations/${conversation}/tasks`,
        {
          token: noAssign.token,
          data: { idempotencyKey: newIdempotencyKey('grant'), title: 'Hand it over', tz: 'UTC' },
        },
      )
      expect(refusedAssign.status()).toBe(400)

      // The same person CAN make a task for themselves, in their own workspace.
      const own = await apiRequest(request, 'POST', '/api/chat_tasks/workspace/tasks', {
        token: noAssign.token,
        data: { idempotencyKey: newIdempotencyKey('grant'), title: 'Mine to do', tz: 'UTC' },
      })
      expect(own.ok()).toBeTruthy()
      taskIds.push((await own.json()).taskId)
    } finally {
      if (noAssign) await cleanupChatTasks({ request, token: noAssign.token }, { taskIds })
      for (const person of [chatOnly, noAssign, peer]) {
        if (!person) continue
        await deleteUserIfExists(request, adminToken, person.id)
        await deleteRoleIfExists(request, adminToken, person.roleId)
      }
    }
  })

  test('a member removed from a space loses the panel, the cards and the source', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let owner: Colleague | null = null
    let member: Colleague | null = null
    const taskIds: string[] = []

    try {
      owner = await createColleague(request, adminToken, organizationId, 'revoke-owner', CREATOR)
      member = await createColleague(request, adminToken, organizationId, 'revoke-member', CREATOR)
      const ctx = { request, token: owner.token }

      const conversationId = await createSpace(ctx, [member.id])
      const created = await createTaskFromConversation(ctx, conversationId, {
        title: 'Shared work',
        assigneeIds: [member.id],
        tz: 'UTC',
      })
      taskIds.push(created.taskId)

      // While a member, they can read the card and the source.
      const before = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/conversations/${conversationId}/cards?messageIds=${created.cardMessageId}`,
        { token: member.token },
      )
      expect(before.ok()).toBeTruthy()
      expect((await before.json()).items[0].available).toBe(true)

      // Removed from the space.
      const removed = await apiRequest(
        request,
        'DELETE',
        `/api/chat/conversations/${conversationId}/members/${member.id}`,
        { token: owner.token },
      )
      expect(removed.ok()).toBeTruthy()

      /**
       * Access goes with the participant row, immediately — there is no cache to wait
       * for and no grace period. This is the concurrent-revocation case: somebody with
       * the page still open loses the data on their next request.
       */
      for (const endpoint of [
        `/api/chat_tasks/conversations/${conversationId}/tasks`,
        `/api/chat_tasks/conversations/${conversationId}/cards?messageIds=${created.cardMessageId}`,
      ]) {
        const response = await apiRequest(request, 'GET', endpoint, { token: member.token })
        expect(response.status(), endpoint).toBe(404)
      }

      // The task is still theirs — it was assigned to them, and losing a conversation
      // does not take work away.
      const stillMine = await apiRequest(request, 'GET', `/api/tasks/tasks/${created.taskId}`, {
        token: member.token,
      })
      expect(stillMine.ok()).toBeTruthy()

      // But it no longer tells them where it came from.
      const sources = await apiRequest(
        request,
        'GET',
        `/api/chat_tasks/tasks/${created.taskId}/sources`,
        { token: member.token },
      )
      expect((await sources.json()).items).toEqual([])
    } finally {
      if (owner) {
        await cleanupChatTasks({ request, token: owner.token }, { taskIds })
        await deleteUserIfExists(request, adminToken, owner.id)
        await deleteRoleIfExists(request, adminToken, owner.roleId)
      }
      if (member) {
        await deleteUserIfExists(request, adminToken, member.id)
        await deleteRoleIfExists(request, adminToken, member.roleId)
      }
    }
  })
})
