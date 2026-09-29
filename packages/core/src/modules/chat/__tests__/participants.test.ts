import type { EntityManager } from '@mikro-orm/postgresql'
import { conversationRoster } from '../commands/shared'
import { loadParticipant, requireIdentityId } from '../lib/participants'

jest.mock('../events', () => ({
  emitChatEvent: jest.fn(),
}))

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

/**
 * The nullable-identity guard.
 *
 * `chat_participants.user_id` became nullable when outsiders arrived, and
 * MikroORM compiles a filter of `{ userId: null }` — and of `{ userId:
 * undefined }`, which `findOne` normalises to null — to `user_id IS NULL`. A
 * membership lookup with a missing id would therefore match every outsider's
 * row and admit its caller. These pin that no lookup reaches the database
 * without an id, and that each kind of person is looked up by its own column.
 */
describe('requireIdentityId', () => {
  it.each([null, undefined, ''])('refuses %p', (value) => {
    expect(() => requireIdentityId(value)).toThrow('[internal]')
  })

  it('returns a real id unchanged', () => {
    expect(requireIdentityId('user-1')).toBe('user-1')
  })
})

describe('loadParticipant', () => {
  function recordingEm() {
    const findOne = jest.fn(async (_entity: unknown, _where: Record<string, unknown>) => null)
    return { em: { findOne } as unknown as EntityManager, findOne }
  }

  it('looks a colleague up by user id and nothing else', async () => {
    const { em, findOne } = recordingEm()
    await loadParticipant(em, SCOPE, 'conv-1', { kind: 'user', userId: 'user-1' })
    expect(findOne.mock.calls[0]![1]).toEqual({
      conversationId: 'conv-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
    })
  })

  it('looks an outsider up by contact id, never by user id', async () => {
    const { em, findOne } = recordingEm()
    await loadParticipant(em, SCOPE, 'conv-1', { kind: 'external', externalContactId: 'contact-1' })
    const where = findOne.mock.calls[0]![1]
    expect(where).toEqual({
      conversationId: 'conv-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      externalContactId: 'contact-1',
    })
    expect(where).not.toHaveProperty('userId')
  })

  it.each([undefined, null, ''])('never queries with a missing user id (%p)', async (userId) => {
    const { em, findOne } = recordingEm()
    await expect(
      loadParticipant(em, SCOPE, 'conv-1', { kind: 'user', userId: userId as unknown as string }),
    ).rejects.toThrow('[internal]')
    expect(findOne).not.toHaveBeenCalled()
  })

  it.each([undefined, null, ''])('never queries with a missing contact id (%p)', async (externalContactId) => {
    const { em, findOne } = recordingEm()
    await expect(
      loadParticipant(em, SCOPE, 'conv-1', {
        kind: 'external',
        externalContactId: externalContactId as unknown as string,
      }),
    ).rejects.toThrow('[internal]')
    expect(findOne).not.toHaveBeenCalled()
  })

  it('never queries without a conversation id', async () => {
    const { em, findOne } = recordingEm()
    await expect(loadParticipant(em, SCOPE, '', { kind: 'user', userId: 'user-1' })).rejects.toThrow('[internal]')
    expect(findOne).not.toHaveBeenCalled()
  })
})

/**
 * The roster is the SSE audience and the room roster, so an outsider — who has
 * no session and no Operis identity — must never appear in either. They are
 * reported apart instead of being dropped silently.
 */
describe('conversationRoster', () => {
  it('keeps outsiders out of the audience and the room roster', async () => {
    const rows = [
      { conversationId: 'conv-1', userId: 'user-1', externalContactId: null, role: 'owner' },
      { conversationId: 'conv-1', userId: null, externalContactId: 'contact-1', role: 'member' },
      { conversationId: 'conv-1', userId: 'user-2', externalContactId: null, role: 'member' },
    ]
    const em = { find: async () => rows } as unknown as EntityManager
    await expect(conversationRoster(em, SCOPE, 'conv-1')).resolves.toEqual({
      userIds: ['user-1', 'user-2'],
      ownerUserIds: ['user-1'],
      externalContactIds: ['contact-1'],
    })
  })

  it('never yields a null recipient', async () => {
    const rows = [{ conversationId: 'conv-1', userId: null, externalContactId: 'contact-1', role: 'member' }]
    const em = { find: async () => rows } as unknown as EntityManager
    const roster = await conversationRoster(em, SCOPE, 'conv-1')
    expect(roster.userIds).toEqual([])
    expect(roster.userIds.includes(null as unknown as string)).toBe(false)
  })
})
