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
  connectedAccount,
  incomingChat,
  INBOX_SKIP_REASON,
  inboxConfigured,
  notificationsOf,
  person,
  portalCarries,
  PROVISIONING_SECRET,
  PROVISIONING_URL,
  transcript,
  uniqueStamp,
  type Message,
  type Person,
} from './whatsappInbox'

export const integrationMeta = { dependsOnModules: ['chat', 'chat_matrix', 'notifications'] }

/**
 * TC-CHAT-015: internal notes in a client conversation.
 *
 * Colleagues talk about the customer beside the customer's chat. A note is in
 * the transcript for every colleague, tells the colleagues it names, survives
 * an edit as a note — and nothing of it ever reaches the portal on the
 * homeserver, which is the only way anything reaches the customer's phone.
 */

test.describe('TC-CHAT-015: internal notes', () => {
  test.skip(!inboxConfigured, INBOX_SKIP_REASON)

  let stub: WhatsAppStub | null = null
  test.beforeAll(async () => {
    stub = await startWhatsAppStub({ url: PROVISIONING_URL!, secret: PROVISIONING_SECRET! })
  })
  test.afterAll(async () => {
    await stub?.close()
  })

  test('a note stays among colleagues, and tells whom it names', async ({ request }) => {
    test.setTimeout(240_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const roleId = await createRoleFixture(request, adminToken, { name: `QA internal notes ${uniqueStamp()}` })
    const people: Person[] = []
    let accountId: string | null = null
    let spaceId: string | null = null
    try {
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'], organizations: null })
      const agent = await person(request, adminToken, organizationId, roleId, `Nora Agent${uniqueStamp().slice(-4)}`)
      const helper = await person(request, adminToken, organizationId, roleId, `Ivo Helper${uniqueStamp().slice(-4)}`)
      people.push(agent, helper)

      const account = await connectedAccount(request, adminToken, stub!, [agent.id, helper.id])
      accountId = account.id
      const { conversation, roomId } = await incomingChat(request, agent.token, account, 'notes')

      // --- a note naming a colleague ---
      const noteText = `the invoice total looks wrong ${uniqueStamp()}`
      const posted = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation.id}/messages`, {
        token: agent.token,
        data: { body: `<@${helper.id}> ${noteText}`, visibility: 'internal' },
      })
      expect(posted.ok(), await posted.text()).toBeTruthy()
      const note = (await posted.json()).message as Message
      expect(note.visibility).toBe('internal')

      await expect
        .poll(() => notificationsOf(request, helper.token, 'chat.mention.received', conversation.id), {
          message: 'the named colleague should be told',
          timeout: 20_000,
        })
        .toBe(1)
      const seen = (await transcript(request, helper.token, conversation.id)).find((message) => message.id === note.id)
      expect(seen).toMatchObject({ visibility: 'internal', senderUserId: agent.id })

      // --- edited, it is still a note ---
      const correction = `${noteText} — checked, it is right`
      const edited = await apiRequest(request, 'PATCH', `/api/chat/conversations/${conversation.id}/messages/${note.id}`, {
        token: agent.token,
        data: { body: correction },
      })
      expect(edited.ok(), await edited.text()).toBeTruthy()

      // --- a reply after it reaches the portal; the note never does ---
      const reply = `Thanks for waiting ${uniqueStamp()}`
      const sent = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation.id}/messages`, {
        token: helper.token,
        data: { body: reply },
      })
      expect(sent.ok(), await sent.text()).toBeTruthy()
      await expect
        .poll(() => portalCarries(roomId, account.identity, reply), { message: 'the reply should reach the portal', timeout: 20_000 })
        .toBe(true)
      expect(await portalCarries(roomId, account.identity, noteText), 'the note must never reach the customer').toBe(false)

      // --- a colleague cannot name anybody in a reply to the customer ---
      const leaking = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation.id}/messages`, {
        token: agent.token,
        data: { body: `<@${helper.id}> can you take this?` },
      })
      expect(leaking.status()).toBe(400)

      // --- notes belong to client conversations only ---
      const space = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: agent.token,
        data: { kind: 'space', title: `QA notes ${uniqueStamp()}`, memberIds: [helper.id] },
      })
      expect(space.ok(), await space.text()).toBeTruthy()
      spaceId = ((await space.json()) as { id: string }).id
      const inSpace = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: agent.token,
        data: { body: 'just us', visibility: 'internal' },
      })
      expect(inSpace.status()).toBe(400)
    } finally {
      if (spaceId) {
        // The owner goes last, so the space goes with them.
        for (const someone of [...people].reverse()) {
          await apiRequest(request, 'DELETE', `/api/chat/conversations/${spaceId}/members/${someone.id}`, { token: someone.token }).catch(
            () => undefined,
          )
        }
      }
      if (accountId) await apiRequest(request, 'DELETE', `/api/chat/accounts/${accountId}`, { token: adminToken }).catch(() => undefined)
      for (const someone of people) await deleteUserIfExists(request, adminToken, someone.id)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
