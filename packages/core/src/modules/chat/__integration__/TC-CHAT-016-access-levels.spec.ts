import { expect, test } from '@playwright/test'
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
  connectedAccount,
  conversationOf,
  incomingChat,
  INBOX_SKIP_REASON,
  inboxConfigured,
  person,
  portalCarries,
  PROVISIONING_SECRET,
  PROVISIONING_URL,
  uniqueStamp,
  type Person,
} from './whatsappInbox'

export const integrationMeta = { dependsOnModules: ['chat', 'chat_matrix', 'notifications'] }

/**
 * TC-CHAT-016: access levels in a client conversation.
 *
 * `viewer` reads and writes internal notes, `participant` also answers the
 * client, `manager` also decides who is in the chat and what they can do. A
 * chat always keeps a manager. Asserted over the API and, for a viewer, on the
 * page: the composer offers notes only.
 */

type Member = { id: string; access: string | null }

async function membersOf(request: Parameters<typeof apiRequest>[0], token: string, conversationId: string): Promise<Member[]> {
  const response = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}/members`, { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).items as Member[]
}

test.describe('TC-CHAT-016: access levels', () => {
  test.skip(!inboxConfigured, INBOX_SKIP_REASON)

  let stub: WhatsAppStub | null = null
  test.beforeAll(async () => {
    stub = await startWhatsAppStub({ url: PROVISIONING_URL!, secret: PROVISIONING_SECRET! })
  })
  test.afterAll(async () => {
    await stub?.close()
  })

  test('a viewer reads and notes, a participant replies, a manager decides — and one always remains', async ({ request }) => {
    test.setTimeout(240_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenScope(adminToken)
    const roleId = await createRoleFixture(request, adminToken, { name: `QA access levels ${uniqueStamp()}` })
    const people: Person[] = []
    let accountId: string | null = null
    try {
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'], organizations: null })
      const lead = await person(request, adminToken, organizationId, roleId, `Lea Lead${uniqueStamp().slice(-4)}`)
      const trainee = await person(request, adminToken, organizationId, roleId, `Tom Trainee${uniqueStamp().slice(-4)}`)
      const third = await person(request, adminToken, organizationId, roleId, `Uma Third${uniqueStamp().slice(-4)}`)
      people.push(lead, trainee, third)

      const account = await connectedAccount(request, adminToken, stub!, [lead.id])
      accountId = account.id
      const { conversation, roomId } = await incomingChat(request, lead.token, account, 'levels')
      expect((await conversationOf(request, lead.token, conversation.id)).viewerAccess).toBe('manager')
      const messagesUrl = `/api/chat/conversations/${conversation.id}/messages`
      const memberUrl = (userId: string) => `/api/chat/conversations/${conversation.id}/members/${userId}`

      // --- someone added without a level is a viewer ---
      const added = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation.id}/members`, {
        token: lead.token,
        data: { memberIds: [trainee.id] },
      })
      expect(added.ok(), await added.text()).toBeTruthy()
      expect((await conversationOf(request, trainee.token, conversation.id)).viewerAccess).toBe('viewer')
      expect((await membersOf(request, lead.token, conversation.id)).find((member) => member.id === trainee.id)?.access).toBe('viewer')

      // --- a viewer notes, never replies, never manages ---
      const viewerReply = `viewer reply ${uniqueStamp()}`
      expect((await apiRequest(request, 'POST', messagesUrl, { token: trainee.token, data: { body: viewerReply } })).status()).toBe(403)
      const viewerNote = await apiRequest(request, 'POST', messagesUrl, {
        token: trainee.token,
        data: { body: `I think they want a refund ${uniqueStamp()}`, visibility: 'internal' },
      })
      expect(viewerNote.ok(), await viewerNote.text()).toBeTruthy()
      expect(
        (await apiRequest(request, 'POST', `/api/chat/conversations/${conversation.id}/members`, {
          token: trainee.token,
          data: { memberIds: [third.id] },
        })).status(),
      ).toBe(403)
      expect(
        (await apiRequest(request, 'PATCH', memberUrl(trainee.id), { token: trainee.token, data: { access: 'manager' } })).status(),
      ).toBe(403)

      // --- made a participant, they answer the client ---
      const promoted = await apiRequest(request, 'PATCH', memberUrl(trainee.id), { token: lead.token, data: { access: 'participant' } })
      expect(promoted.ok(), await promoted.text()).toBeTruthy()
      const participantReply = `Happy to help ${uniqueStamp()}`
      const replied = await apiRequest(request, 'POST', messagesUrl, { token: trainee.token, data: { body: participantReply } })
      expect(replied.ok(), await replied.text()).toBeTruthy()
      await expect.poll(() => portalCarries(roomId, account.identity, participantReply), { timeout: 20_000 }).toBe(true)
      expect(await portalCarries(roomId, account.identity, viewerReply)).toBe(false)

      // --- the last manager stays until there is another ---
      const stepDown = await apiRequest(request, 'PATCH', memberUrl(lead.id), { token: lead.token, data: { access: 'viewer' } })
      expect(stepDown.status()).toBe(400)
      expect((await apiRequest(request, 'DELETE', memberUrl(lead.id), { token: lead.token })).status()).toBe(400)
      expect(
        (await apiRequest(request, 'PATCH', memberUrl(trainee.id), { token: lead.token, data: { access: 'manager' } })).ok(),
      ).toBeTruthy()
      const handedOver = await apiRequest(request, 'PATCH', memberUrl(lead.id), { token: lead.token, data: { access: 'viewer' } })
      expect(handedOver.ok(), await handedOver.text()).toBeTruthy()
      expect((await apiRequest(request, 'POST', messagesUrl, { token: lead.token, data: { body: 'still me?' } })).status()).toBe(403)

      // --- the new manager brings someone in as a participant ---
      const withLevel = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation.id}/members`, {
        token: trainee.token,
        data: { memberIds: [third.id], access: 'participant' },
      })
      expect(withLevel.ok(), await withLevel.text()).toBeTruthy()
      expect((await conversationOf(request, third.token, conversation.id)).viewerAccess).toBe('participant')
      expect(
        (await apiRequest(request, 'PATCH', memberUrl(lead.id), { token: third.token, data: { access: 'manager' } })).status(),
      ).toBe(403)
    } finally {
      if (accountId) await apiRequest(request, 'DELETE', `/api/chat/accounts/${accountId}`, { token: adminToken }).catch(() => undefined)
      for (const someone of people) await deleteUserIfExists(request, adminToken, someone.id)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a viewer’s composer offers internal notes only', async ({ page, request }) => {
    test.setTimeout(240_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, userId: adminId } = getTokenScope(adminToken)
    const roleId = await createRoleFixture(request, adminToken, { name: `QA viewer page ${uniqueStamp()}` })
    const people: Person[] = []
    let accountId: string | null = null
    try {
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'], organizations: null })
      const lead = await person(request, adminToken, organizationId, roleId, `Pia Lead${uniqueStamp().slice(-4)}`)
      people.push(lead)
      const account = await connectedAccount(request, adminToken, stub!, [lead.id])
      accountId = account.id
      const { conversation, roomId } = await incomingChat(request, lead.token, account, 'viewerpage')
      const added = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation.id}/members`, {
        token: lead.token,
        data: { memberIds: [adminId], access: 'viewer' },
      })
      expect(added.ok(), await added.text()).toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/chat/${conversation.id}`)
      await expect(page.getByTestId('chat-access-viewer')).toBeVisible({ timeout: 20_000 })
      const mode = page.getByTestId('chat-compose-mode')
      await expect(mode.getByRole('radio', { name: 'Internal note' })).toBeChecked()
      await expect(mode.getByRole('radio', { name: /Reply to/ })).toBeDisabled()

      const noteText = `viewer page note ${uniqueStamp()}`
      const composer = page.locator('#chat-composer')
      await expect(composer).toHaveAttribute('placeholder', 'Internal note — only colleagues see this')
      await composer.fill(noteText)
      await composer.press('Enter')
      const transcript = page.getByRole('region', { name: 'Messages' })
      await expect(transcript.locator('[data-visibility="internal"]').filter({ hasText: noteText })).toBeVisible({ timeout: 20_000 })
      expect(await portalCarries(roomId, account.identity, noteText)).toBe(false)

      await page.getByRole('button', { name: /People in this conversation/ }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByTestId('chat-external-colleague').first()).toBeVisible()
      await expect(dialog.getByTestId('chat-external-access')).toHaveCount(0)
      await expect(dialog.getByTestId('chat-external-add-button')).toHaveCount(0)

      // Leaving asks first, inside the same dialog, and then takes you out.
      await dialog.getByRole('button', { name: 'Leave', exact: true }).click()
      await expect(dialog.getByText('Leave this chat?')).toBeVisible()
      await dialog.getByTestId('chat-external-remove-confirm').click()
      await page.waitForURL(/\/backend\/chat$/, { timeout: 20_000 })
    } finally {
      if (accountId) await apiRequest(request, 'DELETE', `/api/chat/accounts/${accountId}`, { token: adminToken }).catch(() => undefined)
      for (const someone of people) await deleteUserIfExists(request, adminToken, someone.id)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
