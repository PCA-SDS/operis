import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { startWhatsAppStub, type WhatsAppStub } from './whatsappStub'
import {
  conversationOf,
  conversations,
  DOUBLE_PUPPET_TOKEN,
  ghostSays,
  INBOX_SKIP_REASON,
  inboxConfigured,
  person,
  personalMxid,
  personalPortal,
  PROVISIONING_SECRET,
  PROVISIONING_URL,
  push,
  roomEvent,
  timeline,
  transcript,
  uniquePhone,
  uniqueStamp,
  whatsappGhost,
  type Person,
} from './whatsappInbox'

export const integrationMeta = { dependsOnModules: ['chat', 'chat_matrix'] }

/**
 * TC-CHAT-018: an employee's personal WhatsApp.
 *
 * Private until its owner moves a chat: nothing on the number is projected,
 * the chat list is read live for its owner alone, and a moved chat brings only
 * what is said from the move on — its replies leaving from the employee's own
 * number. Asserted over the API, on the homeserver and on the profile page.
 */

type Account = { id: string; name: string; status: string; ownerType: string }
type Chat = { id: string; name: string; kind: string; conversationId: string | null }

async function connectPersonal(request: APIRequestContext, token: string, stub: WhatsAppStub): Promise<Account> {
  const created = await apiRequest(request, 'POST', '/api/chat/accounts', {
    token,
    data: { network: 'whatsapp', ownerType: 'user', memberUserIds: [] },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const account = (await created.json()).account as Account
  const connect = await apiRequest(request, 'POST', `/api/chat/accounts/${account.id}/connect`, { token, data: { flow: 'qr' } })
  expect(connect.ok(), await connect.text()).toBeTruthy()
  await expect.poll(() => stub.complete(personalMxid(account.id)), { timeout: 20_000 }).toBe(true)
  await expect
    .poll(async () => {
      const read = await apiRequest(request, 'GET', `/api/chat/accounts/${account.id}`, { token })
      return ((await read.json()).account as Account).status
    }, { timeout: 20_000 })
    .toBe('connected')
  return account
}

async function chatsOf(request: APIRequestContext, token: string, accountId: string): Promise<Chat[]> {
  const response = await apiRequest(request, 'GET', `/api/chat/accounts/${accountId}/chats`, { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).items as Chat[]
}

test.describe('TC-CHAT-018: personal WhatsApp accounts', () => {
  test.skip(!inboxConfigured || !DOUBLE_PUPPET_TOKEN, `${INBOX_SKIP_REASON}, and OM_MATRIX_DOUBLE_PUPPET_AS_TOKEN`)

  let stub: WhatsAppStub | null = null
  test.beforeAll(async () => {
    stub = await startWhatsAppStub({ url: PROVISIONING_URL!, secret: PROVISIONING_SECRET! })
  })
  test.afterAll(async () => {
    await stub?.close()
  })

  test('nothing comes in until a chat is moved, and then only what is said after', async ({ request }) => {
    test.setTimeout(240_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenScope(adminToken)
    const roleId = await createRoleFixture(request, adminToken, { name: `QA personal WhatsApp ${uniqueStamp()}` })
    const people: Person[] = []
    let accountId: string | null = null
    try {
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['chat.view', 'chat.send', 'chat.accounts.connect_own'],
        organizations: null,
      })
      const employee = await person(request, adminToken, organizationId, roleId, `Ana Field${uniqueStamp().slice(-4)}`)
      people.push(employee)

      const account = await connectPersonal(request, employee.token, stub!)
      accountId = account.id
      expect(account.name, 'a personal number speaks for its owner').toBe(employee.name)
      const identity = personalMxid(account.id)

      // --- chats on the number, and nothing projected from them ---
      const phone = uniquePhone()
      const ghost = await whatsappGhost('personal', { phone })
      const roomId = await personalPortal(ghost.userId, identity)
      const groupGhost = await whatsappGhost('group')
      const groupName = `Family ${uniqueStamp().slice(-5)}`
      const groupId = await personalPortal(groupGhost.userId, identity, { name: groupName })
      const secret = `my private plans ${uniqueStamp()}`
      await ghostSays(roomId, ghost.userId, secret)
      await push(request, [
        roomEvent(roomId, identity, 'm.room.member', { membership: 'join' }, { state_key: identity }),
        roomEvent(roomId, ghost.userId, 'm.room.message', { msgtype: 'm.text', body: secret }),
      ])
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      const external = (await conversations(request, employee.token)).filter(
        (item) => item.external?.account?.id === account.id,
      )
      expect(external, 'a personal number is never adopted').toEqual([])

      // --- the owner, and only the owner, sees the list ---
      const chats = await chatsOf(request, employee.token, account.id)
      expect(chats).toEqual(
        expect.arrayContaining([
          { id: roomId, name: ghost.displayName, kind: 'direct', conversationId: null },
          expect.objectContaining({ id: groupId, name: groupName }),
        ]),
      )
      const stranger = await apiRequest(request, 'GET', `/api/chat/accounts/${account.id}/chats`, { token: adminToken })
      expect(stranger.status()).toBe(404)
      const strangerMove = await apiRequest(request, 'POST', `/api/chat/accounts/${account.id}/chats/move`, {
        token: adminToken,
        data: { chatId: roomId },
      })
      expect(strangerMove.status()).toBe(404)

      // --- moved ---
      const movedAt = Date.now()
      const moved = await apiRequest(request, 'POST', `/api/chat/accounts/${account.id}/chats/move`, {
        token: employee.token,
        data: { chatId: roomId },
      })
      expect(moved.ok(), await moved.text()).toBeTruthy()
      const { conversationId } = (await moved.json()) as { conversationId: string }
      const conversation = await conversationOf(request, employee.token, conversationId)
      expect(conversation).toMatchObject({ kind: 'external', viewerAccess: 'manager' })
      expect(conversation.external?.account?.id).toBe(account.id)
      expect(conversation.external?.contacts.map((contact) => contact.name)).toEqual([ghost.displayName])
      const again = await apiRequest(request, 'POST', `/api/chat/accounts/${account.id}/chats/move`, {
        token: employee.token,
        data: { chatId: roomId },
      })
      expect(((await again.json()) as { conversationId: string }).conversationId, 'moving twice is one move').toBe(conversationId)
      expect((await chatsOf(request, employee.token, account.id)).find((chat) => chat.id === roomId)?.conversationId).toBe(
        conversationId,
      )

      // --- only what is said from the move on comes in ---
      const fresh = `can we talk about the order? ${uniqueStamp()}`
      await push(request, [
        { ...roomEvent(roomId, ghost.userId, 'm.room.message', { msgtype: 'm.text', body: secret }), origin_server_ts: movedAt - 60_000 },
        roomEvent(roomId, ghost.userId, 'm.room.message', { msgtype: 'm.text', body: fresh }),
      ])
      await expect
        .poll(async () => (await transcript(request, employee.token, conversationId)).map((message) => message.body), {
          timeout: 20_000,
        })
        .toContain(fresh)
      expect((await transcript(request, employee.token, conversationId)).map((message) => message.body)).not.toContain(secret)

      // --- replies leave from the employee's own number ---
      const reply = `Sure, sending it now ${uniqueStamp()}`
      const sent = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
        token: employee.token,
        data: { body: reply },
      })
      expect(sent.ok(), await sent.text()).toBeTruthy()
      await expect
        .poll(async () =>
          (await timeline(roomId, identity, DOUBLE_PUPPET_TOKEN)).find((event) => event.content?.body === reply)?.sender,
        { timeout: 20_000 })
        .toBe(identity)

      // --- disconnected, the chat stays with the company and falls quiet ---
      const disconnected = await apiRequest(request, 'POST', `/api/chat/accounts/${account.id}/disconnect`, {
        token: employee.token,
        data: {},
      })
      expect(disconnected.ok(), await disconnected.text()).toBeTruthy()
      expect((await conversations(request, employee.token)).some((item) => item.id === conversationId)).toBe(true)
      const refused = await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
        token: employee.token,
        data: { body: 'still there?' },
      })
      expect(refused.status()).toBe(409)
    } finally {
      if (accountId) {
        const owner = people[0]
        if (owner) await apiRequest(request, 'DELETE', `/api/chat/accounts/${accountId}`, { token: owner.token }).catch(() => undefined)
      }
      for (const someone of people) await deleteUserIfExists(request, adminToken, someone.id)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('the profile page connects the number and moves a chat', async ({ page, request }) => {
    test.setTimeout(240_000)
    const adminToken = await getAuthToken(request, 'admin')
    let accountId: string | null = null
    try {
      await login(page, 'admin')
      await page.goto('/backend/profile/whatsapp')
      // Scoped to the page body: the shell keeps a hidden copy of the page too.
      const main = page.getByRole('main')
      await expect(main.getByTestId('chat-personal-privacy')).toBeVisible()
      await main.getByRole('button', { name: 'Connect my WhatsApp' }).click()

      const connectDialog = page.getByRole('dialog')
      await connectDialog.getByRole('button', { name: 'Connect', exact: true }).click()
      await expect(connectDialog.getByRole('img', { name: 'WhatsApp QR code' })).toBeVisible({ timeout: 20_000 })
      const listed = await apiRequest(request, 'GET', '/api/chat/accounts', { token: adminToken })
      accountId = ((await listed.json()).items as Account[]).find((item) => item.ownerType === 'user')?.id ?? null
      expect(accountId).toBeTruthy()
      const identity = personalMxid(accountId!)
      await expect.poll(() => stub!.complete(identity), { timeout: 20_000 }).toBe(true)
      await expect(connectDialog.getByTestId('chat-account-connected')).toBeVisible({ timeout: 20_000 })
      await connectDialog.getByRole('button', { name: 'Close' }).last().click()

      const ghost = await whatsappGhost('page', { phone: uniquePhone() })
      const roomId = await personalPortal(ghost.userId, identity)

      await main.getByTestId('chat-personal-move').click()
      const moveDialog = page.getByRole('dialog')
      const chat = moveDialog.getByTestId('chat-personal-chat').filter({ hasText: ghost.displayName })
      await expect(chat).toBeVisible({ timeout: 20_000 })
      await chat.click()
      await expect(moveDialog.getByText(`Move “${ghost.displayName}” to the company?`)).toBeVisible()
      await moveDialog.getByRole('button', { name: 'Move to the company', exact: true }).click()
      await page.waitForURL(/\/backend\/chat\/[0-9a-f-]{36}$/, { timeout: 20_000 })
      await expect(page.getByRole('button', { name: /People in this conversation/ })).toContainText(ghost.displayName)

      const chats = await chatsOf(request, adminToken, accountId!)
      expect(chats.find((item) => item.id === roomId)?.conversationId).toBeTruthy()
    } finally {
      if (accountId) await apiRequest(request, 'DELETE', `/api/chat/accounts/${accountId}`, { token: adminToken }).catch(() => undefined)
    }
  })
})
