import { spawn } from 'node:child_process'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenContext, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { startWhatsAppStub, type WhatsAppStub } from './whatsappStub'

export const integrationMeta = { dependsOnModules: ['chat', 'chat_matrix', 'notifications'] }

/**
 * TC-CHAT-013: connecting a company WhatsApp number.
 *
 * An admin adds an account and a team, connects it by QR code or pairing code,
 * cancels, fails, disconnects and removes it — over the API and on the page.
 * The bridge is `whatsappStub.ts`, speaking mautrix-whatsapp's provisioning
 * API, because only a real phone can finish a real login; the homeserver the
 * account identity is registered on is real.
 *
 * Runs only when the app is on the Matrix transport with the WhatsApp
 * provisioning URL pointing at a free local port the stub can take:
 *
 *   OM_CHAT_TRANSPORT=matrix, the OM_MATRIX_* values, OM_MATRIX_BRIDGE_GHOSTS
 *   with whatsapp=whatsapp_, and OM_MATRIX_WHATSAPP_PROVISIONING_URL /
 *   _SECRET = http://127.0.0.1:<port> and any secret (the app and this process).
 */

const PASSWORD = 'Valid1!Pass'
const TRANSPORT = (process.env.OM_CHAT_TRANSPORT ?? 'local').toLowerCase()
const PROVISIONING_URL = process.env.OM_MATRIX_WHATSAPP_PROVISIONING_URL
const PROVISIONING_SECRET = process.env.OM_MATRIX_WHATSAPP_PROVISIONING_SECRET
const SERVER_NAME = process.env.OM_MATRIX_SERVER_NAME
const USER_PREFIX = process.env.OM_MATRIX_USER_PREFIX ?? 'om_'
const configured =
  TRANSPORT === 'matrix' &&
  Boolean(PROVISIONING_URL && PROVISIONING_SECRET && SERVER_NAME && /^http:\/\/127\.0\.0\.1:\d+$/.test(PROVISIONING_URL ?? ''))

const uniqueStamp = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
const accountMxid = (accountId: string) => `@${USER_PREFIX}a_${accountId.replace(/-/g, '')}:${SERVER_NAME}`

type Account = {
  id: string
  name: string
  status: string
  statusReason: string | null
  remoteHandle: string | null
  updatedAt: string | null
  loginStep: { flow: string; kind: string; data: string | null } | null
  members: Array<{ id: string; name: string }>
}

async function createAccount(
  request: APIRequestContext,
  token: string,
  name: string,
  memberUserIds: string[],
): Promise<Account> {
  const response = await apiRequest(request, 'POST', '/api/chat/accounts', {
    token,
    data: { network: 'whatsapp', name, ownerType: 'company', memberUserIds },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).account as Account
}

async function readAccount(request: APIRequestContext, token: string, id: string): Promise<Account> {
  const response = await apiRequest(request, 'GET', `/api/chat/accounts/${id}`, { token })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).account as Account
}

async function connect(
  request: APIRequestContext,
  token: string,
  id: string,
  data: Record<string, unknown> = { flow: 'qr' },
) {
  return apiRequest(request, 'POST', `/api/chat/accounts/${id}/connect`, { token, data })
}

async function removeAccount(request: APIRequestContext, token: string, id: string | null): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `/api/chat/accounts/${id}`, { token }).catch(() => undefined)
}

type CliResult = { code: number | null; stdout: string; stderr: string }

async function mercato(args: string[]): Promise<CliResult> {
  const appRoot = process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato')
  return new Promise<CliResult>((resolve, reject) => {
    const child = spawn('yarn', ['mercato', ...args], {
      cwd: path.resolve(appRoot, '..', '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

type Colleague = { id: string; email: string; token: string }

async function colleague(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  label: string,
): Promise<Colleague> {
  const email = `wa-${label}-${uniqueStamp()}@qa.test`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA WhatsApp ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

test.describe('TC-CHAT-013: connecting a company WhatsApp number', () => {
  test.skip(
    !configured,
    'requires OM_CHAT_TRANSPORT=matrix and OM_MATRIX_WHATSAPP_PROVISIONING_URL=http://127.0.0.1:<free port> with its secret',
  )

  let stub: WhatsAppStub | null = null
  test.beforeAll(async () => {
    stub = await startWhatsAppStub({ url: PROVISIONING_URL!, secret: PROVISIONING_SECRET! })
  })
  test.afterAll(async () => {
    await stub?.close()
  })

  test('connects by QR code, following each new code to the finished login', async ({ request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const roleId = await createRoleFixture(request, adminToken, { name: `QA WhatsApp team ${uniqueStamp()}` })
    let agent: Colleague | null = null
    let accountId: string | null = null
    try {
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'], organizations: null })
      agent = await colleague(request, adminToken, organizationId, roleId, 'agent')

      const listed = await apiRequest(request, 'GET', '/api/chat/accounts', { token: adminToken })
      const list = (await listed.json()) as { networks: string[]; canManageCompany: boolean }
      expect(list.networks).toContain('whatsapp')
      expect(list.canManageCompany).toBe(true)

      const created = await createAccount(request, adminToken, `QA Sales ${uniqueStamp()}`, [agent.id])
      accountId = created.id
      expect(created).toMatchObject({ status: 'pending', members: [{ id: agent.id }] })

      const started = await connect(request, adminToken, created.id)
      expect(started.ok(), await started.text()).toBeTruthy()
      const connecting = (await started.json()).account as Account
      expect(connecting.status).toBe('connecting')
      expect(connecting.loginStep?.kind).toBe('qr')
      expect(connecting.loginStep?.data).toMatch(/^https:\/\/wa\.me\/settings\/linked_devices#stub-\d+$/)
      expect(JSON.stringify(connecting)).not.toMatch(/attemptId|processId/)

      // WhatsApp rotates the code; the account follows.
      const firstCode = connecting.loginStep?.data
      await expect.poll(() => stub!.rotate(accountMxid(created.id)), { timeout: 20_000 }).toBe(true)
      await expect
        .poll(async () => (await readAccount(request, adminToken, created.id)).loginStep?.data, { timeout: 20_000 })
        .not.toBe(firstCode)

      // The phone scans it.
      await expect
        .poll(() => stub!.complete(accountMxid(created.id), { phone: '+4915199990000', name: 'QA Stub GmbH' }), {
          timeout: 20_000,
        })
        .toBe(true)
      await expect.poll(async () => (await readAccount(request, adminToken, created.id)).status, { timeout: 20_000 }).toBe('connected')
      const connected = await readAccount(request, adminToken, created.id)
      expect(connected).toMatchObject({ remoteHandle: '+4915199990000', loginStep: null, statusReason: null })

      // Connecting again is refused until it is disconnected.
      expect((await connect(request, adminToken, created.id)).status()).toBe(409)

      // --- disconnect: the bridge forgets the login, the account says so ---
      const disconnected = await apiRequest(request, 'POST', `/api/chat/accounts/${created.id}/disconnect`, {
        token: adminToken,
        data: {},
      })
      expect(disconnected.ok(), await disconnected.text()).toBeTruthy()
      expect(((await disconnected.json()).account as Account).status).toBe('disconnected')
      expect(stub!.loginsOf(accountMxid(created.id))).toEqual([])
    } finally {
      await removeAccount(request, adminToken, accountId)
      if (agent) await deleteUserIfExists(request, adminToken, agent.id)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('connects by pairing code, and reports what the bridge refuses', async ({ request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    let accountId: string | null = null
    try {
      const { userId } = getTokenScope(adminToken)
      const account = await createAccount(request, adminToken, `QA Support ${uniqueStamp()}`, [userId])
      accountId = account.id

      const invalid = await connect(request, adminToken, account.id, { flow: 'phone', phoneNumber: '0151 2345' })
      expect(invalid.status(), 'a number without its country code is refused before the bridge sees it').toBe(400)

      const started = await connect(request, adminToken, account.id, { flow: 'phone', phoneNumber: '+49 151 23456789' })
      expect(started.ok(), await started.text()).toBeTruthy()
      const step = ((await started.json()).account as Account).loginStep
      expect(step).toMatchObject({ flow: 'phone', kind: 'code', data: 'STUB1234' })
      expect(stub!.calls.some((call) => call.path.endsWith('/user_input'))).toBe(true)

      // The code expires unused.
      await expect.poll(() => stub!.fail(accountMxid(account.id), 'FI.MAU.WHATSAPP.LOGIN_TIMEOUT'), { timeout: 20_000 }).toBe(true)
      await expect.poll(async () => (await readAccount(request, adminToken, account.id)).status, { timeout: 20_000 }).toBe('failed')
      expect((await readAccount(request, adminToken, account.id)).statusReason).toBe('timeout')

      // Trying again, then changing one's mind.
      expect((await connect(request, adminToken, account.id)).ok()).toBeTruthy()
      const cancelled = await apiRequest(request, 'POST', `/api/chat/accounts/${account.id}/connect/cancel`, {
        token: adminToken,
        data: {},
      })
      expect(cancelled.ok(), await cancelled.text()).toBeTruthy()
      expect(((await cancelled.json()).account as Account)).toMatchObject({ status: 'pending', loginStep: null })
      expect(stub!.calls.some((call) => call.path.includes('/login/cancel/'))).toBe(true)
    } finally {
      await removeAccount(request, adminToken, accountId)
    }
  })

  test('is for managers only, and never crosses into another organization', async ({ request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const roleId = await createRoleFixture(request, adminToken, { name: `QA WhatsApp nobody ${uniqueStamp()}` })
    let agent: Colleague | null = null
    let accountId: string | null = null
    try {
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'], organizations: null })
      agent = await colleague(request, adminToken, organizationId, roleId, 'nomanage')
      const account = await createAccount(request, adminToken, `QA Private ${uniqueStamp()}`, [agent.id])
      accountId = account.id

      const listed = await apiRequest(request, 'GET', '/api/chat/accounts', { token: agent.token })
      expect(listed.ok()).toBeTruthy()
      const list = (await listed.json()) as { items: Account[]; canManageCompany: boolean }
      expect(list.canManageCompany).toBe(false)
      expect(list.items.map((item) => item.id)).not.toContain(account.id)

      for (const [method, route, data] of [
        ['GET', `/api/chat/accounts/${account.id}`, undefined],
        ['POST', `/api/chat/accounts/${account.id}/connect`, { flow: 'qr' }],
        ['POST', `/api/chat/accounts/${account.id}/disconnect`, {}],
        ['DELETE', `/api/chat/accounts/${account.id}`, undefined],
      ] as const) {
        const response = await apiRequest(request, method, route, { token: agent.token, data })
        expect(response.status(), `${method} ${route} must look like a missing account`).toBe(404)
      }
      const create = await apiRequest(request, 'POST', '/api/chat/accounts', {
        token: agent.token,
        data: { network: 'whatsapp', name: 'Mine now', ownerType: 'company', memberUserIds: [agent.id] },
      })
      expect(create.status()).toBe(403)
    } finally {
      await removeAccount(request, adminToken, accountId)
      if (agent) await deleteUserIfExists(request, adminToken, agent.id)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('a dropped account is marked and its managers are told', async ({ request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    let accountId: string | null = null
    try {
      const { userId } = getTokenScope(adminToken)
      const account = await createAccount(request, adminToken, `QA Drop ${uniqueStamp()}`, [userId])
      accountId = account.id
      expect((await connect(request, adminToken, account.id)).ok()).toBeTruthy()
      await expect.poll(() => stub!.complete(accountMxid(account.id)), { timeout: 20_000 }).toBe(true)
      await expect.poll(async () => (await readAccount(request, adminToken, account.id)).status, { timeout: 20_000 }).toBe('connected')

      // The link is removed on the phone.
      stub!.setState(accountMxid(account.id), 'LOGGED_OUT')
      const checked = await mercato(['chat_matrix', 'accounts', '--organization', organizationId])
      expect(checked.code, checked.stderr.slice(0, 400)).toBe(0)
      const dropped = await readAccount(request, adminToken, account.id)
      expect(dropped).toMatchObject({ status: 'disconnected', statusReason: 'logged_out' })

      const notifications = await apiRequest(request, 'GET', '/api/notifications?pageSize=100', { token: adminToken })
      const items = ((await notifications.json()).items ?? []) as Array<{ type?: string; sourceEntityId?: string }>
      expect(items.filter((item) => item.type === 'chat.account.disconnected' && item.sourceEntityId === account.id)).toHaveLength(1)

      // Checking again is not a second drop.
      await mercato(['chat_matrix', 'accounts', '--organization', organizationId])
      const again = await apiRequest(request, 'GET', '/api/notifications?pageSize=100', { token: adminToken })
      const itemsAgain = ((await again.json()).items ?? []) as Array<{ type?: string; sourceEntityId?: string }>
      expect(itemsAgain.filter((item) => item.type === 'chat.account.disconnected' && item.sourceEntityId === account.id)).toHaveLength(1)
    } finally {
      await removeAccount(request, adminToken, accountId)
    }
  })

  test('the page walks an admin from a new account to a connected one', async ({ page, request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const roleId = await createRoleFixture(request, adminToken, { name: `QA WhatsApp page ${uniqueStamp()}` })
    const name = `QA Page ${uniqueStamp()}`
    let accountId: string | null = null
    let agent: Colleague | null = null
    try {
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'], organizations: null })
      agent = await colleague(request, adminToken, organizationId, roleId, 'page')

      await login(page, 'admin')
      await page.goto('/backend/chat/accounts')
      await expect(page.getByRole('heading', { name: 'WhatsApp' })).toBeVisible()

      await page.getByRole('button', { name: 'Add account' }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox').first().fill(name)
      // The admin setting it up may be on the team too — unlike a space, the
      // account does not seat its creator by itself.
      await dialog.getByLabel('Search colleagues').fill('admin@acme.com')
      // Anchored: "superadmin@acme.com" contains the same address.
      await expect(dialog.getByRole('checkbox', { name: /^admin@acme\.com/ })).toBeVisible()
      await dialog.getByLabel('Search colleagues').fill(agent.email)
      await dialog.getByRole('checkbox').first().click()
      await dialog.getByRole('button', { name: 'Add account' }).click()

      // The connect step follows on its own.
      const connectDialog = page.getByRole('dialog')
      await expect(connectDialog.getByText(`Connect ${name}`)).toBeVisible()
      await connectDialog.getByRole('button', { name: 'Connect' }).click()
      await expect(connectDialog.getByRole('img', { name: 'WhatsApp QR code' })).toBeVisible({ timeout: 20_000 })

      const listed = await apiRequest(request, 'GET', '/api/chat/accounts', { token: adminToken })
      accountId = ((await listed.json()).items as Account[]).find((item) => item.name === name)?.id ?? null
      expect(accountId).toBeTruthy()
      await expect.poll(() => stub!.complete(accountMxid(accountId!)), { timeout: 20_000 }).toBe(true)

      await expect(connectDialog.getByTestId('chat-account-connected')).toBeVisible({ timeout: 20_000 })
      // The footer's Close, not the corner one — both are named "Close".
      await connectDialog.getByRole('button', { name: 'Close' }).last().click()
      const card = page.locator(`[data-account-id="${accountId}"]`)
      // Exact: "Not connected" contains the word too.
      await expect(card.getByText('Connected', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(card.getByText(/\+4915100000000/)).toBeVisible()
    } finally {
      await removeAccount(request, adminToken, accountId)
      if (agent) await deleteUserIfExists(request, adminToken, agent.id)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
