import { emitConversationEvent } from '../commands/shared'

const emit = jest.fn()

jest.mock('../events', () => ({
  emitChatEvent: (...args: unknown[]) => emit(...args),
}))

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

/**
 * The realtime privacy invariant.
 *
 * The SSE bridge decides who receives a frame from two inputs: trusted
 * `{ tenantId, organizationId }` in the emit options, and `recipientUserIds` in
 * the payload. Absent recipients mean "everyone in the organization" — so an
 * emit that lost that field would turn a private message into an org-wide
 * broadcast, with nothing else in the stack to catch it.
 *
 * These tests pin the shape of every chat emit against that contract.
 */
describe('emitConversationEvent', () => {
  beforeEach(() => emit.mockReset())

  it('names the recipients, so the bridge can drop the frame for everyone else', async () => {
    await emitConversationEvent('chat.message.sent', SCOPE, ['user-a', 'user-b'], {
      conversationId: 'conv-1',
    })

    const [, payload] = emit.mock.calls[0]!
    expect(payload.recipientUserIds).toEqual(['user-a', 'user-b'])
  })

  it('passes trusted tenant and organization scope in the options, not only the payload', async () => {
    await emitConversationEvent('chat.message.sent', SCOPE, ['user-a'], { conversationId: 'conv-1' })

    const [, , options] = emit.mock.calls[0]!
    // The bridge switches to trusted-scope mode on the presence of this key and
    // then ignores payload tenant/org entirely.
    expect(options).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('carries tenantId in the payload too, which the cross-process bridge requires', async () => {
    await emitConversationEvent('chat.message.sent', SCOPE, ['user-a'], { conversationId: 'conv-1' })

    const [, payload] = emit.mock.calls[0]!
    // `EventBus.emit` only republishes an event to other processes when the
    // payload carries a tenant, so dropping this would break realtime for any
    // deployment running more than one app process.
    expect(payload.tenantId).toBe('tenant-1')
    expect(payload.organizationId).toBe('org-1')
  })

  it('never carries message content — the bridge truncates large frames into a stub', async () => {
    await emitConversationEvent('chat.message.sent', SCOPE, ['user-a'], {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      senderUserId: 'user-a',
      createdAt: '2026-09-03T10:00:00.000Z',
    })

    const [, payload] = emit.mock.calls[0]!
    expect(payload).not.toHaveProperty('body')
    expect(Object.keys(payload).sort()).toEqual([
      'conversationId',
      'createdAt',
      'messageId',
      'organizationId',
      'recipientUserIds',
      'senderUserId',
      'tenantId',
    ])
  })

  /**
   * Fail closed. An empty recipient list would reach the bridge as "no
   * restriction", which is the opposite of what the caller meant.
   */
  it('emits nothing at all rather than an unaddressed event', async () => {
    await emitConversationEvent('chat.message.sent', SCOPE, [], { conversationId: 'conv-1' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('cannot have its recipient list mutated by the caller after the fact', async () => {
    const recipients = ['user-a']
    await emitConversationEvent('chat.message.sent', SCOPE, recipients, { conversationId: 'conv-1' })
    recipients.push('user-intruder')

    const [, payload] = emit.mock.calls[0]!
    expect(payload.recipientUserIds).toEqual(['user-a'])
  })

  it('does not let a caller-supplied payload override the trusted scope it writes', async () => {
    await emitConversationEvent('chat.message.sent', SCOPE, ['user-a'], {
      conversationId: 'conv-1',
      tenantId: 'forged-tenant',
      organizationId: 'forged-org',
      recipientUserIds: ['everyone'],
    })

    const [, payload] = emit.mock.calls[0]!
    expect(payload.tenantId).toBe('tenant-1')
    expect(payload.organizationId).toBe('org-1')
    expect(payload.recipientUserIds).toEqual(['user-a'])
  })
})
