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

const PASSWORD = 'Valid1!Pass'

type Person = { id: string; email: string; token: string }

async function makePerson(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  roleId: string,
  label: string,
): Promise<Person> {
  const email = `chat-tr-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@qa.test`
  const id = await createUserFixture(request, adminToken, {
    email, password: PASSWORD, organizationId, roles: [roleId], name: `QA ${label}`,
  })
  return { id, email, token: await getAuthToken(request, email, PASSWORD) }
}

/**
 * Translation runs against a deterministic fake engine here
 * (`OM_TRANSLATION_FAKE_PROVIDER`), which prefixes `[<target>]`. Asserting on
 * real machine-translated prose would be asserting on the model, which changes
 * between revisions; what these prove is the plumbing around it - caching,
 * scoping, mention survival, and the reasons a translation is declined.
 */
test.describe('TC-CHAT-007: message translation', () => {
  test('translations are cached, shared between readers, and mentions survive', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let alice: Person | null = null
    let bob: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA Tr ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      alice = await makePerson(request, adminToken, organizationId, roleId, 'alice')
      bob = await makePerson(request, adminToken, organizationId, roleId, 'bob')

      const created = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: alice.token,
        data: { kind: 'space', title: 'QA Translation', memberIds: [bob.id] },
      })
      const spaceId = (await created.json()).id as string

      const send = async (body: string) => {
        const response = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
          token: alice!.token, data: { body },
        })
        expect(response.ok(), await response.text()).toBeTruthy()
        return (await response.json()).message.id as string
      }
      const translate = (token: string, messageIds: string[], targetLocale: string) =>
        apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/translate`, {
          token, data: { messageIds, targetLocale },
        })

      const plain = await send('Bonjour tout le monde')
      const withMention = await send(`<@${bob.id}> peux-tu regarder la facture`)

      // ---- first pass reaches the engine ---------------------------------
      const first = await translate(alice.token, [plain, withMention], 'vi')
      expect(first.ok()).toBeTruthy()
      const firstRows = (await first.json()).translations as Array<Record<string, unknown>>
      expect(firstRows).toHaveLength(2)
      for (const row of firstRows) {
        expect(row.cached, 'nothing was cached yet').toBe(false)
        expect(String(row.body)).toContain('[vi]')
      }

      // The mention token comes back intact. A translated `<@uuid>` no longer
      // matches the mention pattern, so this silently stops being a mention.
      const mentionRow = firstRows.find((r) => r.messageId === withMention)!
      expect(String(mentionRow.body)).toContain(`<@${bob.id}>`)

      // ---- second pass is served from the cache ---------------------------
      const second = await translate(alice.token, [plain], 'vi')
      const secondRow = (await second.json()).translations[0]
      expect(secondRow.cached, 'the same request again costs nothing').toBe(true)
      expect(secondRow.body).toBe(firstRows.find((r) => r.messageId === plain)!.body)

      // ---- and shared with the next reader who wants that language --------
      const forBob = await translate(bob.token, [plain], 'vi')
      const bobRow = (await forBob.json()).translations[0]
      expect(bobRow.cached, 'a translation belongs to the message and language, not the reader').toBe(true)
      expect(bobRow.body).toBe(secondRow.body)

      // A different language is a different row, not a cache hit.
      const inFrench = await translate(alice.token, [plain], 'fr')
      expect((await inFrench.json()).translations[0].cached).toBe(false)

      // ---- messages with nothing to translate are declined, not faked -----
      const emoji = await send('👍')
      const emojiRow = (await (await translate(alice.token, [emoji], 'vi')).json()).translations[0]
      expect(emojiRow.body).toBeNull()
      expect(emojiRow.skipped).toBe('nothing-to-translate')

      // ---- already in the reader's language -------------------------------
      const declared = await send('[[vi]] xin chao moi nguoi')
      const sameRow = (await (await translate(alice.token, [declared], 'vi')).json()).translations[0]
      expect(sameRow.skipped, 'saying so beats returning the same words').toBe('same-language')
      expect(sameRow.body).toBeNull()

      // ...and recorded, so it is answered from the row next time. In a
      // conversation held mostly in the reader's language this is the dominant
      // case, so leaving it uncached spent an engine call per press, forever.
      const sameAgain = (await (await translate(alice.token, [declared], 'vi')).json()).translations[0]
      expect(sameAgain.cached, 'the answer is known and must not be re-asked').toBe(true)
      expect(sameAgain.skipped, 'a cached non-answer still says why').toBe('same-language')
      expect(sameAgain.body, 'the reader must not get their own words back as a translation').toBeNull()

      // ---- one bad message does not fail the batch ------------------------
      const bad = await send('FAIL_TRANSLATION please')
      const good = await send('Encore une phrase ordinaire')
      const mixed = await translate(alice.token, [bad, good], 'vi')
      expect(mixed.ok(), 'the batch still succeeds').toBeTruthy()
      const mixedRows = (await mixed.json()).translations as Array<Record<string, unknown>>
      expect(mixedRows.find((r) => r.messageId === bad)!.skipped).toBe('failed')
      expect(String(mixedRows.find((r) => r.messageId === good)!.body)).toContain('[vi]')
    } finally {
      await deleteUserIfExists(request, adminToken, alice?.id ?? null)
      await deleteUserIfExists(request, adminToken, bob?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('translation never crosses a conversation, a membership or an organization', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId: orgA } = getTokenContext(adminToken)

    let orgB: string | null = null
    let roleId: string | null = null
    let owner: Person | null = null
    let member: Person | null = null
    let outsider: Person | null = null

    try {
      orgB = await createOrganizationFixture(request, adminToken, { name: `QA Tr Org ${Date.now()}` })
      roleId = await createRoleFixture(request, adminToken, { name: `QA TrSec ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      owner = await makePerson(request, adminToken, orgA, roleId, 'owner')
      member = await makePerson(request, adminToken, orgA, roleId, 'member')
      outsider = await makePerson(request, adminToken, orgB, roleId, 'outsider')

      const space = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: owner.token,
        data: { kind: 'space', title: 'QA Tr Security', memberIds: [member.id] },
      })
      const spaceId = (await space.json()).id as string

      const sent = await apiRequest(request, 'POST', `/api/chat/conversations/${spaceId}/messages`, {
        token: owner.token, data: { body: 'Bonjour, ceci est confidentiel' },
      })
      const messageId = (await sent.json()).message.id as string

      const translate = (token: string, conversationId: string, ids: string[]) =>
        apiRequest(request, 'POST', `/api/chat/conversations/${conversationId}/translate`, {
          token, data: { messageIds: ids, targetLocale: 'vi' },
        })

      // A member of the conversation can.
      expect((await translate(member.token, spaceId, [messageId])).ok()).toBeTruthy()

      // Another organization cannot, and is told nothing that confirms the
      // message exists.
      expect(
        (await translate(outsider.token, spaceId, [messageId])).status(),
        'another organization gets 404, not 403',
      ).toBe(404)

      // Nor can a member of one conversation reach a message in another. The
      // composite foreign key would refuse the row even if this check were gone.
      const other = await apiRequest(request, 'POST', '/api/chat/conversations', {
        token: owner.token, data: { kind: 'space', title: 'QA Tr Elsewhere' },
      })
      expect(other.ok(), await other.text()).toBeTruthy()
      const otherId = (await other.json()).id as string
      expect(
        (await translate(owner.token, otherId, [messageId])).status(),
        'the message does not belong to that conversation',
      ).toBe(404)

      // Losing membership closes it, like every other read in the module.
      await apiRequest(request, 'DELETE', `/api/chat/conversations/${spaceId}/members/${member.id}`, {
        token: owner.token,
      })
      expect(
        (await translate(member.token, spaceId, [messageId])).status(),
        'a removed member cannot translate what they can no longer read',
      ).toBe(404)
    } finally {
      await deleteUserIfExists(request, adminToken, owner?.id ?? null)
      await deleteUserIfExists(request, adminToken, member?.id ?? null)
      await deleteUserIfExists(request, adminToken, outsider?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, adminToken, orgB)
    }
  })

  test('the reading language is the caller own, and not limited to the interface locales', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)

    let roleId: string | null = null
    let reader: Person | null = null
    let other: Person | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: `QA TrLoc ${Date.now()}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['chat.view', 'chat.send'] })
      reader = await makePerson(request, adminToken, organizationId, roleId, 'reader')
      other = await makePerson(request, adminToken, organizationId, roleId, 'other')

      const read = async (person: Person) => {
        const response = await apiRequest(request, 'GET', '/api/chat/settings', { token: person.token })
        expect(response.ok()).toBeTruthy()
        return (await response.json()).translationLocale as string | null
      }
      const set = (person: Person, translationLocale: string | null) =>
        apiRequest(request, 'PUT', '/api/chat/settings', { token: person.token, data: { translationLocale } })

      expect(await read(reader), 'unset means follow the interface').toBeNull()

      // Vietnamese is not one of the five interface locales. Being able to store
      // it is the entire point: someone reading Vietnamese runs the UI in
      // English because there is no Vietnamese UI.
      expect((await set(reader, 'vi')).ok()).toBeTruthy()
      expect(await read(reader)).toBe('vi')

      // French likewise.
      expect((await set(reader, 'fr')).ok()).toBeTruthy()
      expect(await read(reader)).toBe('fr')

      // It is per person, not global.
      expect(await read(other), "another colleague's setting is untouched").toBeNull()

      // Not a language.
      expect((await set(reader, 'zzz')).status()).toBe(400)
      expect(await read(reader), 'a rejected write changes nothing').toBe('fr')

      // Cleared, back to following the interface.
      expect((await set(reader, null)).ok()).toBeTruthy()
      expect(await read(reader)).toBeNull()
    } finally {
      await deleteUserIfExists(request, adminToken, reader?.id ?? null)
      await deleteUserIfExists(request, adminToken, other?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
