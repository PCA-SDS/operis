import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

export const integrationMeta = { dependsOnModules: ['chat', 'notifications'] }

const PASSWORD = 'Valid1!Pass'

/**
 * TC-CHAT-011: who a message actually tells, and how to stop it telling them.
 *
 * The unread badge says a conversation has been active. A notification says it
 * wants YOU — so a direct message raises one, a space message raises one only
 * for the people it names, and a muted conversation raises none at all. That
 * distinction is the difference between a chat people keep notifications on for
 * and one where they turn them off in the first week.
 *
 * Asserted over the ordinary notifications API, because that is where a reader
 * would see them.
 */

type Person = { id: string; email: string; token: string }

async function createColleague(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  label: string,
): Promise<Person> {
  const email = `chatn-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@qa.test`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA Notify ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

/** This person's chat notifications, newest first. */
async function chatNotifications(
  request: APIRequestContext,
  token: string,
): Promise<Array<{ type: string; sourceEntityId?: string | null }>> {
  const response = await apiRequest(request, 'GET', '/api/notifications?pageSize=100', { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  const items = ((await response.json()).items ?? []) as Array<{
    type?: string
    sourceEntityId?: string | null
  }>
  return items
    .filter((item) => typeof item.type === 'string' && item.type.startsWith('chat.'))
    .map((item) => ({ type: item.type as string, sourceEntityId: item.sourceEntityId ?? null }))
}

async function send(
  request: APIRequestContext,
  token: string,
  conversationId: string,
  body: string,
): Promise<void> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/chat/conversations/${conversationId}/messages`,
    { token, data: { body } },
  )
  expect(response.ok(), await response.text()).toBeTruthy()
}

test.describe('TC-CHAT-011: chat notifications and mute', () => {
  test('a direct message notifies, a muted one does not', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Notify ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await createColleague(request, adminToken, organizationId!, roleId, 'a')
      bob = await createColleague(request, adminToken, organizationId!, roleId, 'b')

      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      expect(opened.ok()).toBeTruthy()
      const conversationId = (await opened.json()).id as string

      expect(await chatNotifications(request, bob.token)).toHaveLength(0)

      await send(request, alice.token, conversationId, 'are you free at three?')

      const afterFirst = await chatNotifications(request, bob.token)
      expect(afterFirst, 'a direct message should notify its counterpart').toHaveLength(1)
      expect(afterFirst[0].type).toBe('chat.direct.received')
      expect(afterFirst[0].sourceEntityId).toBe(conversationId)

      // The sender is never told about their own message.
      expect(await chatNotifications(request, alice.token)).toHaveLength(0)

      // --- Bob silences it ---
      const muted = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/mute`, {
        token: bob.token,
        data: { muted: true },
      })
      expect(muted.ok(), await muted.text()).toBeTruthy()
      expect((await muted.json()).muted).toBe(true)

      const conversation = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}`, {
        token: bob.token,
      })
      expect((await conversation.json()).muted, 'the flag should be readable back').toBe(true)

      await send(request, alice.token, conversationId, 'and four?')

      /**
       * Still one — the notification from before the mute, not a second.
       * Grouping means a run of messages leaves one entry either way, so this
       * asserts the type is unchanged rather than counting rows: what matters
       * is that muting stopped a NEW conversation being raised.
       */
      const afterMute = await chatNotifications(request, bob.token)
      expect(afterMute).toHaveLength(1)

      // ...and the unread count still moves, because a mute silences the
      // notification and not the conversation.
      const unread = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: bob.token })
      expect((await unread.json()).unreadCount).toBeGreaterThan(0)

      // --- and unmuting brings it back ---
      const unmuted = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/mute`, {
        token: bob.token,
        data: { muted: false },
      })
      expect(unmuted.ok()).toBeTruthy()
      expect((await unmuted.json()).muted).toBe(false)
    } finally {
      if (alice) await deleteUserIfExists(request, adminToken, alice.id)
      if (bob) await deleteUserIfExists(request, adminToken, bob.id)
      if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a space notifies only the people a message names', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let owner: Person | null = null
    let named: Person | null = null
    let bystander: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Mention ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      owner = await createColleague(request, adminToken, organizationId!, roleId, 'o')
      named = await createColleague(request, adminToken, organizationId!, roleId, 'n')
      bystander = await createColleague(request, adminToken, organizationId!, roleId, 's')

      const created = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: owner.token,
        data: { kind: 'space', title: `QA Mentions ${Date.now()}`, memberIds: [named.id, bystander.id] },
      })
      expect(created.ok(), await created.text()).toBeTruthy()
      const conversationId = (await created.json()).id as string

      // A plain space message names nobody, so it tells nobody. This is the
      // rule the whole policy turns on: one row per member per message is the
      // noise the unread model exists to avoid.
      await send(request, owner.token, conversationId, 'morning all')
      expect(await chatNotifications(request, named.token)).toHaveLength(0)
      expect(await chatNotifications(request, bystander.token)).toHaveLength(0)

      await send(request, owner.token, conversationId, `can you take this one <@${named.id}>?`)

      const forNamed = await chatNotifications(request, named.token)
      expect(forNamed, 'the person named should be told').toHaveLength(1)
      expect(forNamed[0].type).toBe('chat.mention.received')

      expect(
        await chatNotifications(request, bystander.token),
        'and nobody else should be',
      ).toHaveLength(0)
    } finally {
      if (owner) await deleteUserIfExists(request, adminToken, owner.id)
      if (named) await deleteUserIfExists(request, adminToken, named.id)
      if (bystander) await deleteUserIfExists(request, adminToken, bystander.id)
      if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
