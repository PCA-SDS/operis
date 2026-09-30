import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { startWhatsAppStub, type WhatsAppStub } from './whatsappStub'
import {
  accountMxid,
  conversations,
  INBOX_SKIP_REASON,
  inboxConfigured,
  matrix,
  notificationsOf,
  person,
  portal,
  PROVISIONING_SECRET,
  PROVISIONING_URL,
  push,
  roomEvent,
  timeline,
  transcript,
  uniqueStamp,
  whatsappGhost,
  WHATSAPP_AS_TOKEN,
  type Conversation,
  type MatrixEvent,
  type Message,
  type Person,
} from './whatsappInbox'

export const integrationMeta = { dependsOnModules: ['chat', 'chat_matrix', 'notifications'] }

/**
 * TC-CHAT-014: the team inbox for a connected WhatsApp number.
 *
 * A company account is connected (through the provisioning stub), then a chat
 * arrives the way the bridge delivers one: a portal room on the real
 * homeserver with the account's identity and a WhatsApp ghost in it, and the
 * events pushed to the appservice endpoint with the `hs_token`. Everything
 * after that — adoption, the team seated, quiet history, replies leaving as
 * the company number, messages from the company phone, handover and a
 * disconnected account — is asserted over the ordinary API and on the
 * homeserver.
 *
 * Needs, besides TC-CHAT-013's settings, the homeserver's appservice tokens
 * and the WhatsApp bridge's `as_token` as OM_TEST_WHATSAPP_AS_TOKEN — ghosts
 * live in the bridge's exclusive namespace, and only its token can make one.
 */

test.describe('TC-CHAT-014: the WhatsApp team inbox', () => {
  test.skip(!inboxConfigured, INBOX_SKIP_REASON)

  let stub: WhatsAppStub | null = null
  test.beforeAll(async () => {
    stub = await startWhatsAppStub({ url: PROVISIONING_URL!, secret: PROVISIONING_SECRET! })
  })
  test.afterAll(async () => {
    await stub?.close()
  })

  test('a chat arrives for the team, replies leave as the number, and it can be handed over', async ({ request }) => {
    test.setTimeout(300_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const roleId = await createRoleFixture(request, adminToken, { name: `QA WhatsApp inbox ${uniqueStamp()}` })
    const people: Person[] = []
    let accountId: string | null = null
    try {
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'], organizations: null })
      const agent = await person(request, adminToken, organizationId, roleId, `Jules Agent${uniqueStamp().slice(-4)}`)
      const helper = await person(request, adminToken, organizationId, roleId, `Mira Helper${uniqueStamp().slice(-4)}`)
      const outsider = await person(request, adminToken, organizationId, roleId, `Otto Other${uniqueStamp().slice(-4)}`)
      people.push(agent, helper, outsider)

      // --- the account, connected ---
      const created = await apiRequest(request, 'POST', '/api/chat/accounts', {
        token: adminToken,
        data: { network: 'whatsapp', name: `QA Inbox ${uniqueStamp()}`, ownerType: 'company', memberUserIds: [agent.id] },
      })
      expect(created.ok(), await created.text()).toBeTruthy()
      const account = (await created.json()).account as { id: string; name: string; updatedAt: string | null }
      accountId = account.id
      expect((await apiRequest(request, 'POST', `/api/chat/accounts/${account.id}/connect`, { token: adminToken, data: { flow: 'qr' } })).ok()).toBeTruthy()
      await expect.poll(() => stub!.complete(accountMxid(account.id)), { timeout: 20_000 }).toBe(true)
      let connectedAt = ''
      await expect
        .poll(async () => {
          const read = await apiRequest(request, 'GET', `/api/chat/accounts/${account.id}`, { token: adminToken })
          const body = (await read.json()).account as { status: string; connectedAt: string | null }
          connectedAt = body.connectedAt ?? ''
          return body.status
        }, { timeout: 20_000 })
        .toBe('connected')

      // --- a customer writes: the bridge opens a portal and pushes it ---
      const identity = accountMxid(account.id)
      const ghost = await whatsappGhost('first')
      const roomId = await portal(ghost.userId, identity)
      const history = `an old question ${uniqueStamp()}`
      const fresh = `where is my order? ${uniqueStamp()}`
      await push(request, [
        roomEvent(roomId, identity, 'm.room.member', { membership: 'join' }, { state_key: identity }),
        { ...roomEvent(roomId, ghost.userId, 'm.room.message', { msgtype: 'm.text', body: history }), origin_server_ts: Date.parse(connectedAt) - 3_600_000 },
        roomEvent(roomId, ghost.userId, 'm.room.message', { msgtype: 'm.text', body: fresh }),
      ])

      let conversation: Conversation | undefined
      await expect
        .poll(async () => {
          conversation = (await conversations(request, agent.token)).find((item) => item.external?.account?.id === account.id)
          return Boolean(conversation)
        }, { message: 'the chat should be adopted for the team', timeout: 30_000 })
        .toBe(true)
      expect(conversation!.kind).toBe('external')
      expect(conversation!.external).toMatchObject({ network: 'whatsapp', account: { name: account.name, connected: true } })
      expect(conversation!.external!.contacts.map((contact) => contact.name)).toEqual([ghost.displayName])
      expect((await conversations(request, outsider.token)).some((item) => item.id === conversation!.id)).toBe(false)

      await expect
        .poll(async () => (await transcript(request, agent.token, conversation!.id)).map((message) => message.body), { timeout: 30_000 })
        .toEqual(expect.arrayContaining([history, fresh]))
      // History arrives read; only what was said after connecting is news.
      await expect
        .poll(async () => (await conversations(request, agent.token)).find((item) => item.id === conversation!.id)?.unreadCount, { timeout: 20_000 })
        .toBe(1)
      await expect.poll(() => notificationsOf(request, agent.token, 'chat.external.received', conversation!.id), { timeout: 20_000 }).toBe(1)

      // --- a reply leaves as the company number, signed ---
      const signed = await apiRequest(request, 'PATCH', `/api/chat/accounts/${account.id}`, {
        token: adminToken,
        data: { showSenderName: true },
      })
      expect(signed.ok(), await signed.text()).toBeTruthy()
      const reply = `It ships today ${uniqueStamp()}`
      const sent = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation!.id}/messages`, {
        token: agent.token,
        data: { body: reply },
      })
      expect(sent.ok(), await sent.text()).toBeTruthy()
      let outbound: MatrixEvent | undefined
      await expect
        .poll(async () => {
          outbound = (await timeline(roomId, identity)).find((event) => String(event.content?.body ?? '').endsWith(reply))
          return Boolean(outbound)
        }, { message: 'the reply should reach the portal', timeout: 20_000 })
        .toBe(true)
      expect(outbound!.sender, 'it leaves as the account, never as the colleague').toBe(identity)
      expect(outbound!.content.body).toBe(`Jules: ${reply}`)
      // Operis keeps the colleague's own words, unsigned.
      const mine = (await transcript(request, agent.token, conversation!.id)).find((message) => message.body === reply)
      expect(mine).toMatchObject({ senderUserId: agent.id, senderAccountId: null })

      // --- the company phone answers directly ---
      const fromPhone = `answered on the phone ${uniqueStamp()}`
      await push(request, [roomEvent(roomId, identity, 'm.room.message', { msgtype: 'm.text', body: fromPhone })])
      let phoneMessage: Message | undefined
      await expect
        .poll(async () => {
          phoneMessage = (await transcript(request, agent.token, conversation!.id)).find((message) => message.body === fromPhone)
          return Boolean(phoneMessage)
        }, { timeout: 20_000 })
        .toBe(true)
      expect(phoneMessage).toMatchObject({ senderUserId: null, senderExternalContactId: null, senderAccountId: account.id, senderName: account.name })

      // --- handover: the chat and the say over it move to the helper ---
      const added = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation!.id}/members`, {
        token: agent.token,
        data: { memberIds: [helper.id], access: 'manager' },
      })
      expect(added.ok(), await added.text()).toBeTruthy()
      await expect.poll(() => notificationsOf(request, helper.token, 'chat.external.assigned', conversation!.id), { timeout: 20_000 }).toBe(1)
      expect((await conversations(request, helper.token)).some((item) => item.id === conversation!.id)).toBe(true)
      const agentLeaves = await apiRequest(request, 'DELETE', `/api/chat/conversations/${conversation!.id}/members/${agent.id}`, {
        token: agent.token,
      })
      expect(agentLeaves.ok(), await agentLeaves.text()).toBeTruthy()
      const lastLeaves = await apiRequest(request, 'DELETE', `/api/chat/conversations/${conversation!.id}/members/${helper.id}`, {
        token: helper.token,
      })
      expect(lastLeaves.status(), 'the last colleague stays with the customer').toBe(400)

      // --- a disconnected account pauses replies ---
      const disconnected = await apiRequest(request, 'POST', `/api/chat/accounts/${account.id}/disconnect`, {
        token: adminToken,
        data: {},
      })
      expect(disconnected.ok(), await disconnected.text()).toBeTruthy()
      const refused = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation!.id}/messages`, {
        token: helper.token,
        data: { body: 'anyone there?' },
      })
      expect(refused.status()).toBe(409)
      const paused = (await conversations(request, helper.token)).find((item) => item.id === conversation!.id)
      expect(paused?.external?.account?.connected).toBe(false)
    } finally {
      if (accountId) await apiRequest(request, 'DELETE', `/api/chat/accounts/${accountId}`, { token: adminToken }).catch(() => undefined)
      for (const someone of people) await deleteUserIfExists(request, adminToken, someone.id)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a room without the account, or without a contact, is never adopted', async ({ request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const before = (await conversations(request, adminToken)).length
    const ghost = await whatsappGhost('stray')
    // A ghost's room nobody from Operis is in.
    const stray = await matrix<{ room_id: string }>('/_matrix/client/v3/createRoom', {
      token: WHATSAPP_AS_TOKEN,
      params: { user_id: ghost.userId },
      init: { method: 'POST', body: JSON.stringify({ preset: 'private_chat' }) },
    })
    await push(request, [roomEvent(stray.room_id, ghost.userId, 'm.room.message', { msgtype: 'm.text', body: 'hello?' })])
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    expect((await conversations(request, adminToken)).length).toBe(before)
  })
})
