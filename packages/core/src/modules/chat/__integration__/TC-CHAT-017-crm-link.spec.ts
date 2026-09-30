import { randomUUID } from 'node:crypto'
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
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { startWhatsAppStub, type WhatsAppStub } from './whatsappStub'
import {
  connectedAccount,
  incomingChat,
  INBOX_SKIP_REASON,
  inboxConfigured,
  person,
  PROVISIONING_SECRET,
  PROVISIONING_URL,
  uniquePhone,
  uniqueStamp,
  type Person,
} from './whatsappInbox'

export const integrationMeta = { dependsOnModules: ['chat', 'chat_matrix', 'customers'] }

/**
 * TC-CHAT-017: a WhatsApp contact linked to their CRM record.
 *
 * The contact's number comes from the bridge; the CRM person with that number
 * is suggested, a colleague links it, and every colleague sees the link — named
 * only for those the CRM lets open it. Asserted over the API and on the page.
 */

type CustomerRef = { id: string; kind: string | null; name: string | null; href: string | null }
type Outsider = { id: string; handle: string | null; customer: CustomerRef | null; suggestion: CustomerRef | null }
type MemberList = { externalMembers: Outsider[]; crm: { available: boolean; canLink: boolean } }

async function membersOf(request: APIRequestContext, token: string, conversationId: string): Promise<MemberList> {
  const response = await apiRequest(request, 'GET', `/api/chat/conversations/${conversationId}/members`, { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()) as MemberList
}

async function crmPerson(request: APIRequestContext, token: string, phone: string): Promise<{ id: string; name: string }> {
  const lastName = `Nguyen${uniqueStamp().slice(-6)}`
  const name = `Linh ${lastName}`
  const response = await apiRequest(request, 'POST', '/api/customers/people', {
    token,
    data: { firstName: 'Linh', lastName, displayName: name, primaryPhone: phone },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(body.id).toBeTruthy()
  return { id: body.id as string, name }
}

test.describe('TC-CHAT-017: CRM link', () => {
  test.skip(!inboxConfigured, INBOX_SKIP_REASON)

  let stub: WhatsAppStub | null = null
  test.beforeAll(async () => {
    stub = await startWhatsAppStub({ url: PROVISIONING_URL!, secret: PROVISIONING_SECRET! })
  })
  test.afterAll(async () => {
    await stub?.close()
  })

  test('the CRM person with the number is suggested, linked, and shown as far as each colleague may see', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, userId: adminId } = getTokenScope(adminToken)
    const crmRole = await createRoleFixture(request, adminToken, { name: `QA chat CRM ${uniqueStamp()}` })
    const chatRole = await createRoleFixture(request, adminToken, { name: `QA chat only ${uniqueStamp()}` })
    const people: Person[] = []
    let accountId: string | null = null
    let personId: string | null = null
    let companyId: string | null = null
    try {
      await setRoleAclFeatures(request, adminToken, {
        roleId: crmRole,
        features: ['chat.view', 'chat.send', 'customers.people.view', 'customers.companies.view'],
        organizations: null,
      })
      await setRoleAclFeatures(request, adminToken, { roleId: chatRole, features: ['chat.view', 'chat.send'], organizations: null })
      const agent = await person(request, adminToken, organizationId, crmRole, `Kai Agent${uniqueStamp().slice(-4)}`)
      const helper = await person(request, adminToken, organizationId, chatRole, `Rae Helper${uniqueStamp().slice(-4)}`)
      people.push(agent, helper)

      const phone = uniquePhone()
      const customer = await crmPerson(request, adminToken, phone)
      personId = customer.id
      const companyName = `Nguyen Trading ${uniqueStamp().slice(-6)}`
      companyId = await createCompanyFixture(request, adminToken, companyName)

      const account = await connectedAccount(request, adminToken, stub!, [agent.id, helper.id])
      accountId = account.id
      const { conversation } = await incomingChat(request, agent.token, account, 'crm', { phone })
      const contactUrl = (contactId: string) =>
        `/api/chat/conversations/${conversation.id}/contacts/${contactId}/customer`

      // --- the number, and the CRM person who has it ---
      const seen = await membersOf(request, agent.token, conversation.id)
      expect(seen.crm).toEqual({ available: true, canLink: true })
      const contact = seen.externalMembers[0]
      expect(contact.handle).toBe(phone)
      expect(contact.customer).toBeNull()
      expect(contact.suggestion).toMatchObject({ id: customer.id, kind: 'person', name: customer.name })

      // --- a colleague the CRM keeps out sees neither, and cannot link ---
      const blind = await membersOf(request, helper.token, conversation.id)
      expect(blind.crm.canLink).toBe(false)
      expect(blind.externalMembers[0].suggestion).toBeNull()
      const blindSearch = await apiRequest(
        request,
        'GET',
        `/api/chat/conversations/${conversation.id}/crm-search?q=${encodeURIComponent(companyName)}`,
        { token: helper.token },
      )
      expect(blindSearch.ok(), await blindSearch.text()).toBeTruthy()
      expect(((await blindSearch.json()) as { items: unknown[] }).items).toEqual([])
      const blindLink = await apiRequest(request, 'PUT', contactUrl(contact.id), {
        token: helper.token,
        data: { customerEntityId: customer.id },
      })
      expect(blindLink.status()).toBe(403)

      // --- search finds a company by name, once the CRM has indexed it ---
      await expect
        .poll(
          async () => {
            const search = await apiRequest(
              request,
              'GET',
              `/api/chat/conversations/${conversation.id}/crm-search?q=${encodeURIComponent(companyName)}`,
              { token: agent.token },
            )
            expect(search.ok(), await search.text()).toBeTruthy()
            return ((await search.json()) as { items: Array<{ id: string; kind: string }> }).items
          },
          { timeout: 20_000 },
        )
        .toEqual(expect.arrayContaining([expect.objectContaining({ id: companyId, kind: 'company' })]))

      // --- linked, as each colleague may see it ---
      const linked = await apiRequest(request, 'PUT', contactUrl(contact.id), {
        token: agent.token,
        data: { customerEntityId: customer.id },
      })
      expect(linked.ok(), await linked.text()).toBeTruthy()
      expect((await membersOf(request, agent.token, conversation.id)).externalMembers[0].customer).toEqual({
        id: customer.id,
        kind: 'person',
        name: customer.name,
        href: `/backend/customers/people-v2/${customer.id}`,
      })
      expect((await membersOf(request, helper.token, conversation.id)).externalMembers[0].customer).toEqual({
        id: customer.id,
        kind: null,
        name: null,
        href: null,
      })

      // --- nothing that is not a record here links ---
      const nowhere = await apiRequest(request, 'PUT', contactUrl(contact.id), {
        token: agent.token,
        data: { customerEntityId: randomUUID() },
      })
      expect(nowhere.status()).toBe(404)

      // --- unlinked, the suggestion is back ---
      const unlinked = await apiRequest(request, 'PUT', contactUrl(contact.id), {
        token: agent.token,
        data: { customerEntityId: null },
      })
      expect(unlinked.ok(), await unlinked.text()).toBeTruthy()
      const after = (await membersOf(request, agent.token, conversation.id)).externalMembers[0]
      expect(after.customer).toBeNull()
      expect(after.suggestion?.id).toBe(customer.id)

      // --- on the page: take the suggestion ---
      const seated = await apiRequest(request, 'POST', `/api/chat/conversations/${conversation.id}/members`, {
        token: agent.token,
        data: { memberIds: [adminId], access: 'participant' },
      })
      expect(seated.ok(), await seated.text()).toBeTruthy()
      await login(page, 'admin')
      await page.goto(`/backend/chat/${conversation.id}`)
      await page.getByRole('button', { name: /People in this conversation/ }).click()
      const dialog = page.getByRole('dialog')
      const row = dialog.locator(`[data-contact-id="${contact.id}"]`)
      await expect(row.getByText(phone)).toBeVisible({ timeout: 20_000 })
      await expect(row.getByTestId('chat-crm-suggestion')).toContainText(customer.name)
      await row.getByRole('button', { name: 'Link', exact: true }).click()
      const record = row.getByRole('link', { name: customer.name })
      await expect(record).toBeVisible({ timeout: 20_000 })
      await expect(record).toHaveAttribute('href', `/backend/customers/people-v2/${customer.id}`)
    } finally {
      if (accountId) await apiRequest(request, 'DELETE', `/api/chat/accounts/${accountId}`, { token: adminToken }).catch(() => undefined)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      for (const someone of people) await deleteUserIfExists(request, adminToken, someone.id)
      await deleteRoleIfExists(request, adminToken, crmRole)
      await deleteRoleIfExists(request, adminToken, chatRole)
    }
  })
})
