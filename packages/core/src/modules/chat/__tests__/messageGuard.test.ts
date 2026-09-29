import type { EntityManager } from '@mikro-orm/postgresql'
import { ChatConversation, ChatMessage, ChatParticipant } from '../data/entities'
import { requireMessageInConversation } from '../commands/shared'

/**
 * The guard four commands stand on: react, pin, edit and delete all reach a
 * message through it, and it is the only thing between a forged message id from
 * another space and a write.
 */

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const MESSAGE = '44444444-4444-4444-8444-444444444444'
const USER = '55555555-5555-4555-8555-555555555555'
const CONTACT = '66666666-6666-4666-8666-666666666666'

const asUser = (userId: string) => ({ kind: 'user' as const, userId })

type Row = Record<string, unknown>

/**
 * Enough EntityManager to answer three `findOne` calls by entity and predicate.
 * A row matches when every key in the query equals the row's — which is what
 * makes the `deletedAt: null` clause the thing under test rather than a detail
 * the fake papers over.
 */
function fakeEm(rows: Map<unknown, Row[]>): EntityManager {
  return {
    async findOne(entity: unknown, where: Row) {
      return (
        (rows.get(entity) ?? []).find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) ?? null
      )
    },
  } as unknown as EntityManager
}

function harness(options: { deletedAt?: Date | null } = {}) {
  const rows = new Map<unknown, Row[]>()
  rows.set(ChatParticipant, [{ ...scope, conversationId: CONVERSATION, userId: USER, role: 'member' }])
  rows.set(ChatConversation, [{ ...scope, id: CONVERSATION, kind: 'space', deletedAt: null }])
  rows.set(ChatMessage, [
    {
      ...scope,
      id: MESSAGE,
      conversationId: CONVERSATION,
      senderUserId: USER,
      kind: 'user',
      deletedAt: options.deletedAt ?? null,
    },
  ])
  return fakeEm(rows)
}

describe('requireMessageInConversation', () => {
  it('returns a live message with its conversation and the caller’s participation', async () => {
    const context = await requireMessageInConversation(
      harness(),
      scope,
      CONVERSATION,
      MESSAGE,
      asUser(USER),
    )
    expect(context.message.id).toBe(MESSAGE)
    expect(context.conversation.id).toBe(CONVERSATION)
    expect(context.participant.role).toBe('member')
  })

  it('refuses a message id that names another conversation', async () => {
    // The composite foreign keys would refuse to store a reaction or a pin
    // against it, but as a 500 rather than the 404 it actually is — and an edit
    // writes to `chat_messages` itself, where no constraint would catch it.
    await expect(
      requireMessageInConversation(harness(), scope, CONVERSATION, 'not-this-one', asUser(USER)),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a caller who is not in the conversation', async () => {
    await expect(
      requireMessageInConversation(harness(), scope, CONVERSATION, MESSAGE, asUser('someone-else')),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses another tenant’s scope for the same ids', async () => {
    await expect(
      requireMessageInConversation(
        harness(),
        { tenantId: 'other-tenant', organizationId: scope.organizationId },
        CONVERSATION,
        MESSAGE,
        asUser(USER),
      ),
    ).rejects.toMatchObject({ status: 404 })
  })

  describe('a message that has been deleted', () => {
    const deleted = () => harness({ deletedAt: new Date('2026-09-10T12:00:00.000Z') })

    /** Reacting to, pinning or rewriting something that is gone is a real 404. */
    it('is invisible by default', async () => {
      await expect(
        requireMessageInConversation(deleted(), scope, CONVERSATION, MESSAGE, asUser(USER)),
      ).rejects.toMatchObject({ status: 404 })
    })

    /**
     * Deletion opts in, so a second delete converges instead of reporting a
     * failure for the exact state the caller asked for. Two people holding a
     * stale transcript can both press delete.
     */
    it('is visible to a caller that opts in', async () => {
      const context = await requireMessageInConversation(
        deleted(),
        scope,
        CONVERSATION,
        MESSAGE,
        asUser(USER),
        { includeDeleted: true },
      )
      expect(context.message.id).toBe(MESSAGE)
      expect(context.message.deletedAt).toBeInstanceOf(Date)
    })

    /** Opting in relaxes liveness and nothing else. */
    it('still refuses another tenant, another conversation and a non-participant', async () => {
      await expect(
        requireMessageInConversation(
          deleted(),
          { tenantId: 'other-tenant', organizationId: scope.organizationId },
          CONVERSATION,
          MESSAGE,
          asUser(USER),
          { includeDeleted: true },
        ),
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        requireMessageInConversation(deleted(), scope, CONVERSATION, 'elsewhere', asUser(USER), {
          includeDeleted: true,
        }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        requireMessageInConversation(deleted(), scope, CONVERSATION, MESSAGE, asUser('stranger'), {
          includeDeleted: true,
        }),
      ).rejects.toMatchObject({ status: 404 })
    })
  })
})

/**
 * An outsider reaches a message only inside an external conversation. The
 * database refuses their participant row anywhere else; the guard refuses too,
 * with the same 404 a stranger gets, so no lookup can ever admit one.
 */
describe('requireMessageInConversation for an outsider', () => {
  function outsiderHarness(kind: 'external' | 'space') {
    const rows = new Map<unknown, Row[]>()
    rows.set(ChatParticipant, [
      { ...scope, conversationId: CONVERSATION, userId: null, externalContactId: CONTACT, role: 'member' },
    ])
    rows.set(ChatConversation, [{ ...scope, id: CONVERSATION, kind, deletedAt: null }])
    rows.set(ChatMessage, [
      { ...scope, id: MESSAGE, conversationId: CONVERSATION, senderUserId: null, senderExternalContactId: CONTACT, kind: 'user', deletedAt: null },
    ])
    return fakeEm(rows)
  }
  const outsider = { kind: 'external' as const, externalContactId: CONTACT }

  it('admits an outsider to a message in an external conversation', async () => {
    const context = await requireMessageInConversation(outsiderHarness('external'), scope, CONVERSATION, MESSAGE, outsider)
    expect(context.participant.externalContactId).toBe(CONTACT)
  })

  it('refuses an outsider anywhere else, as a stranger', async () => {
    await expect(
      requireMessageInConversation(outsiderHarness('space'), scope, CONVERSATION, MESSAGE, outsider),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('never lets a colleague lookup match an outsider row', async () => {
    await expect(
      requireMessageInConversation(outsiderHarness('external'), scope, CONVERSATION, MESSAGE, asUser(USER)),
    ).rejects.toMatchObject({ status: 404 })
  })
})
