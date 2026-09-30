import fs from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ChatConversation } from '../data/entities'
import { isAuthorOf, loadParticipant } from '../lib/participants'
import { loadConversationContext } from '../lib/spaces'
import { resolveChatActor } from '../commands/shared'

/**
 * The company's phone as an actor: it speaks only in conversations that came
 * in through it, it is the author of everything that left through it, and
 * nothing but the projector can name it.
 */

jest.mock('../lib/messages', () => ({
  ...jest.requireActual('../lib/messages'),
  loadChatMessages: async () => ({ conversationNotFound: 'Conversation not found', unauthorized: 'Unauthorized' }),
}))

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const ACCOUNT = '0a0b0c0d-1111-4222-8333-444455556666'
const OTHER_ACCOUNT = 'ffffffff-1111-4222-8333-444455556666'
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const COLLEAGUE = '55555555-5555-4555-8555-555555555555'
const CONTACT = '66666666-6666-4666-8666-666666666666'
const account = { kind: 'account' as const, accountId: ACCOUNT }

type Row = Record<string, unknown>

function fakeEm(conversations: Row[]): EntityManager {
  return {
    async findOne(entity: unknown, where: Row) {
      if (entity !== ChatConversation) return null
      return conversations.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null
    },
  } as unknown as EntityManager
}

describe('isAuthorOf — the account', () => {
  it('owns what its phone sent and what colleagues sent through it', () => {
    expect(isAuthorOf({ senderUserId: null, senderAccountId: ACCOUNT }, account)).toBe(true)
    expect(isAuthorOf({ senderUserId: COLLEAGUE, senderExternalContactId: null }, account)).toBe(true)
  })

  it('never owns a customer message, or another account’s', () => {
    expect(isAuthorOf({ senderUserId: null, senderExternalContactId: CONTACT }, account)).toBe(false)
    expect(isAuthorOf({ senderUserId: null, senderAccountId: OTHER_ACCOUNT }, account)).toBe(false)
  })

  it('never owns an internal note, which never left', () => {
    expect(isAuthorOf({ senderUserId: COLLEAGUE, senderExternalContactId: null, visibility: 'internal' }, account)).toBe(false)
  })

  it('does not make a colleague the author of the phone’s messages', () => {
    expect(isAuthorOf({ senderUserId: null, senderAccountId: ACCOUNT }, { kind: 'user', userId: COLLEAGUE })).toBe(false)
  })
})

describe('loadConversationContext — the account', () => {
  const conversation = {
    id: CONVERSATION,
    ...scope,
    kind: 'external',
    messagingAccountId: ACCOUNT,
    deletedAt: null,
  }

  it('speaks in a conversation that came in through it, with no seat', async () => {
    const context = await loadConversationContext(fakeEm([conversation]), scope, CONVERSATION, account)
    expect(context.conversation).toBe(conversation)
    expect(context.participant).toBeNull()
  })

  it('is a stranger everywhere else', async () => {
    await expect(
      loadConversationContext(fakeEm([{ ...conversation, messagingAccountId: OTHER_ACCOUNT }]), scope, CONVERSATION, account),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      loadConversationContext(fakeEm([{ ...conversation, kind: 'space' }]), scope, CONVERSATION, account),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('never looks up a participant row for it', async () => {
    await expect(loadParticipant(fakeEm([]), scope, CONVERSATION, account)).resolves.toBeNull()
  })
})

describe('resolveChatActor', () => {
  const ctx = { auth: { sub: COLLEAGUE } } as never

  it('reads the account only from the projector’s externalOrigin', async () => {
    await expect(resolveChatActor(ctx, { senderAccountId: ACCOUNT })).resolves.toEqual(account)
    await expect(resolveChatActor(ctx, undefined)).resolves.toEqual({ kind: 'user', userId: COLLEAGUE })
  })

  it('prefers an outsider when both are named — the sender is never ambiguous', async () => {
    await expect(resolveChatActor(ctx, { externalContactId: CONTACT, senderAccountId: ACCOUNT })).resolves.toEqual({
      kind: 'external',
      externalContactId: CONTACT,
    })
  })
})

describe('messaging accounts — migration', () => {
  const MIGRATIONS = path.resolve(__dirname, '../migrations')
  const source = fs.readFileSync(path.join(MIGRATIONS, 'Migration20260929150708_chat.ts'), 'utf8')
  const [UP, DOWN] = source.split('override down()')

  it.each([
    ['chat_messaging_account_members_account_fk', 'on delete cascade'],
    ['chat_conversations_messaging_account_fk', 'on delete no action'],
    ['chat_messages_sender_account_fk', 'on delete no action'],
  ])('ties %s to the account inside its own organization', (name, onDelete) => {
    const line = UP!.split('\n').find((candidate) => candidate.includes(`"${name}"`))
    expect(line).toContain('references "chat_messaging_accounts" ("id", "tenant_id", "organization_id")')
    expect(line).toContain(onDelete)
  })

  it('keeps exactly one sender per message, and the phone only on user messages', () => {
    expect(UP).toContain(
      `num_nonnulls("sender_user_id", "sender_external_contact_id", "sender_account_id") = 1 and (("sender_external_contact_id" is null and "sender_account_id" is null) or "kind" = 'user')`,
    )
  })

  it('allows one personal account per person per network', () => {
    expect(UP).toContain(
      `create unique index "chat_messaging_accounts_personal_uq" on "chat_messaging_accounts" ("tenant_id", "organization_id", "owner_user_id", "network") where "owner_type" = 'user' and "deleted_at" is null`,
    )
  })

  it('refuses to go down while anything names an account', () => {
    expect(DOWN).toContain('raise exception')
    expect(DOWN).toContain('drop table if exists "chat_messaging_accounts"')
  })
})
