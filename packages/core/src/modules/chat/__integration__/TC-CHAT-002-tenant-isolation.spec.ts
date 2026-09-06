import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

export const integrationMeta = { dependsOnModules: ['chat'] }

// Satisfies the default password policy (`buildPasswordSchema`): length, a
// digit, an uppercase letter and a symbol. `secret` is rejected with a 400.
const PASSWORD = 'Valid1!Pass'

type Person = { id: string; email: string; token: string }

async function createColleague(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  label: string,
): Promise<Person> {
  const email = `chat-iso-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@qa.test`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
    name: `QA Iso ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

/**
 * TC-CHAT-002: the isolation boundary.
 *
 * Alice and Bob share organization A; Carol lives in organization B. Every
 * assertion here is a way someone could try to reach across that line — through
 * search, through a forged conversation id, through a forged body field — and
 * every one of them must fail on the server, not in the UI.
 */
test.describe('TC-CHAT-002: organization isolation', () => {
  test('a member of another organization can neither be found nor reach the conversation', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId: orgA } = getTokenContext(adminToken)
    expect(orgA, 'the admin token should carry an organization').toBeTruthy()

    let orgB: string | null = null
    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null
    let carol: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Iso ${Date.now()}` })
      // No organization restriction on the role: isolation must come from the
      // module's own scoping, not from an ACL that happens to narrow it.
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['chat.view', 'chat.send'],
        organizations: null,
      })

      orgB = await createOrganizationFixture(request, adminToken, { name: `QA Iso Org ${Date.now()}` })

      alice = await createColleague(request, adminToken, orgA, roleId, 'alice')
      bob = await createColleague(request, adminToken, orgA, roleId, 'bob')
      carol = await createColleague(request, adminToken, orgB, roleId, 'carol')

      // 1. Carol never appears in Alice's directory.
      const directory = await apiRequest(request, 'GET', '/api/chat/directory?q=QA%20Iso', {
        token: alice.token,
      })
      expect(directory.ok()).toBeTruthy()
      const visibleIds = (await directory.json()).items.map((item: { id: string }) => item.id)
      expect(visibleIds).toContain(bob.id)
      expect(visibleIds, 'a member of another organization must not be discoverable').not.toContain(carol.id)

      // 2. Naming Carol's id directly does not create a conversation.
      const crossOrg = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: carol.id },
      })
      expect(
        [400, 403, 404],
        'messaging across organizations must be refused server-side',
      ).toContain(crossOrg.status())

      // 3. Alice and Bob's conversation is invisible to Carol.
      const opened = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { userId: bob.id },
      })
      const conversationId = (await opened.json()).id as string

      await apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/messages`, {
        token: alice.token,
        data: { body: 'internal to org A' },
      })

      // Every conversation-scoped route, probed with a real id Carol should not have.
      const probes: Array<[string, string, unknown]> = [
        ['GET', `/api/chat/conversations/${conversationId}`, undefined],
        ['GET', `/api/chat/conversations/${conversationId}/messages`, undefined],
        ['POST', `/api/chat/conversations/${conversationId}/messages`, { body: 'let me in' }],
        ['POST', `/api/chat/conversations/${conversationId}/read`, {}],
      ]
      for (const [method, path, data] of probes) {
        const response = await apiRequest(request, method, path, { token: carol.token, data })
        expect(
          [403, 404],
          `${method} ${path} must not be reachable from another organization`,
        ).toContain(response.status())
      }

      // 4. Carol's conversation list and unread count know nothing about it.
      const carolList = await apiRequest(request, 'GET', '/api/chat/conversations', { token: carol.token })
      const carolIds = (await carolList.json()).items.map((item: { id: string }) => item.id)
      expect(carolIds).not.toContain(conversationId)

      const carolUnread = await apiRequest(request, 'GET', '/api/chat/unread-count', { token: carol.token })
      expect((await carolUnread.json()).unreadCount).toBe(0)

      // 5. A forged scope in the request body changes nothing: scope comes from
      //    the session, so these fields are simply ignored.
      const forged = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: carol.token,
        data: { userId: bob.id, organizationId: orgA, tenantId: 'anything' },
      })
      expect([400, 403, 404]).toContain(forged.status())

      // 6. A random conversation id is refused the same way a real-but-foreign
      //    one is, so probing cannot distinguish "exists" from "not yours".
      const guessed = await apiRequest(
        request,
        'GET',
        '/api/chat/conversations/00000000-0000-4000-8000-000000000000',
        { token: carol.token },
      )
      expect(guessed.status()).toBe(404)

      // 7. An unauthenticated caller gets nothing at all.
      const anonymous = await request.fetch(`/api/chat/conversations/${conversationId}`, { method: 'GET' })
      expect([401, 403]).toContain(anonymous.status())
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteUserIfExists(request, adminToken, carol?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, adminToken, orgB)
    }
  })

  test('a user without chat features cannot reach any chat endpoint', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    // The admin's own organization, read from their token rather than from an
    // endpoint — the JWT already carries the scope every chat request is pinned to.
    const { organizationId } = getTokenContext(adminToken)
    expect(organizationId, 'the admin token should carry an organization').toBeTruthy()

    let roleId: string | null = null
    let outsider: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA NoChat ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: [] })
      outsider = await createColleague(request, adminToken, organizationId, roleId, 'nofeature')

      for (const path of ['/api/chat/directory', '/api/chat/conversations', '/api/chat/unread-count']) {
        const response = await apiRequest(request, 'GET', path, { token: outsider.token })
        expect([403], `${path} must be feature-gated`).toContain(response.status())
      }
    } finally {
      await deleteUserIfExists(request, adminToken, outsider?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
