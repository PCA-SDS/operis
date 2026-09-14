import {
  createLocalChatTransport,
  publishDeletionSafely,
  publishEditSafely,
  publishMessageSafely,
  resolveChatTransportId,
  resolveChatTransportMode,
  type ChatTransport,
  type PublishDeletionInput,
  type PublishEditInput,
  type PublishMessageInput,
} from '../lib/transport'
import type { ChatScope } from '../lib/scope'
import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * The local transport never touches the database, so a bare object satisfies the
 * context. A real EntityManager here would be scaffolding around nothing.
 */
const ctx = { em: {} as EntityManager }

const scope: ChatScope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const message: PublishMessageInput = {
  conversationId: '33333333-3333-4333-8333-333333333333',
  conversationKind: 'direct',
  messageId: '44444444-4444-4444-8444-444444444444',
  senderUserId: '55555555-5555-4555-8555-555555555555',
  senderName: 'Test Sender',
  body: 'hello',
  createdAt: new Date('2026-09-10T00:00:00.000Z'),
  replyToMessageId: null,
  clientMessageId: null,
  attachmentIds: [],
  recipientUserIds: ['55555555-5555-4555-8555-555555555555'],
}

describe('local transport', () => {
  const transport = createLocalChatTransport()

  it('identifies itself', () => {
    expect(transport.id).toBe('local')
  })

  it('reports no external id, because there is no external system', () => {
    // Not a stub: with nothing to publish to, the database write that already
    // happened IS the delivery.
    return expect(transport.publishMessage(ctx, scope, message)).resolves.toEqual({ externalId: null })
  })

  it('provisions nothing', () => {
    return expect(
      transport.ensureConversation(ctx, scope, {
        conversationId: message.conversationId,
        kind: 'direct',
        title: null,
        memberUserIds: [],
        ownerUserIds: [],
      }),
    ).resolves.toBeUndefined()
  })
})

describe('resolveChatTransportId', () => {
  it('defaults to local when unset', () => {
    expect(resolveChatTransportId({} as NodeJS.ProcessEnv)).toBe('local')
  })

  it.each([
    ['local', 'local'],
    ['matrix', 'matrix'],
    ['  MATRIX  ', 'matrix'],
  ])('accepts %s', (raw, expected) => {
    expect(resolveChatTransportId({ OM_CHAT_TRANSPORT: raw } as NodeJS.ProcessEnv)).toBe(expected)
  })

  it('refuses an unrecognised value rather than falling back', () => {
    // Falling back would run a different messaging topology than the operator
    // asked for, silently. Same reasoning as the translation fake-provider guard.
    expect(() =>
      resolveChatTransportId({ OM_CHAT_TRANSPORT: 'kafka' } as NodeJS.ProcessEnv),
    ).toThrow(/not a known chat transport/)
  })
})

describe('publishMessageSafely', () => {
  it('returns what the transport returned', async () => {
    const transport: ChatTransport = {
      id: 'matrix',
      mode: 'shadow',
      async ensureConversation() {},
      async recordPublication() {},
      async publishReaction() {},
      async publishEdit() {},
      async publishDeletion() {},
      async publishMessage() {
        return { externalId: '$abc' }
      },
    }
    await expect(publishMessageSafely(transport, ctx, scope, message)).resolves.toEqual({
      externalId: '$abc',
    })
  })

  it('swallows a transport failure instead of failing a committed send', async () => {
    // By the time this runs the message is committed and the recipients have
    // been notified. Throwing would fail a send that already succeeded, and the
    // client would retry a message the reader can already see.
    const transport: ChatTransport = {
      id: 'matrix',
      mode: 'shadow',
      async ensureConversation() {},
      async recordPublication() {},
      async publishReaction() {},
      async publishEdit() {},
      async publishDeletion() {},
      async publishMessage() {
        throw new Error('homeserver unreachable')
      },
    }
    await expect(publishMessageSafely(transport, ctx, scope, message)).resolves.toEqual({
      externalId: null,
    })
  })

  it('swallows a non-Error rejection too', async () => {
    const transport: ChatTransport = {
      id: 'matrix',
      mode: 'shadow',
      async ensureConversation() {},
      async recordPublication() {},
      async publishReaction() {},
      async publishEdit() {},
      async publishDeletion() {},
      async publishMessage() {
        throw 'string rejection'
      },
    }
    await expect(publishMessageSafely(transport, ctx, scope, message)).resolves.toEqual({
      externalId: null,
    })
  })
})

describe('the transport contract', () => {
  it('carries no entity, so a transport cannot mutate chat state', () => {
    // The payload is flat and primitive on purpose: passing the ORM object would
    // hand a transport a live entity it could change.
    const keys = Object.keys(message)
    expect(keys).toEqual(
      expect.arrayContaining(['conversationId', 'messageId', 'senderUserId', 'body', 'recipientUserIds']),
    )
    for (const value of Object.values(message)) {
      const primitive =
        value === null ||
        typeof value === 'string' ||
        value instanceof Date ||
        Array.isArray(value)
      expect(primitive).toBe(true)
    }
  })
})

describe('resolveChatTransportMode', () => {
  it('defaults to shadow', () => {
    // The safe default is the one where a homeserver outage cannot stop people
    // talking. Making Matrix authoritative is an explicit, reversible act.
    expect(resolveChatTransportMode({} as NodeJS.ProcessEnv)).toBe('shadow')
  })

  it.each([
    ['shadow', 'shadow'],
    ['authoritative', 'authoritative'],
    ['  AUTHORITATIVE ', 'authoritative'],
  ])('accepts %s', (raw, expected) => {
    expect(resolveChatTransportMode({ OM_CHAT_MATRIX_MODE: raw } as NodeJS.ProcessEnv)).toBe(expected)
  })

  it('refuses an unrecognised value rather than choosing for the operator', () => {
    // This flag decides whether a failed publish loses a message. Guessing is
    // not an acceptable outcome.
    expect(() =>
      resolveChatTransportMode({ OM_CHAT_MATRIX_MODE: 'maybe' } as NodeJS.ProcessEnv),
    ).toThrow(/not a known chat transport mode/)
  })
})

describe('the local transport never claims authority', () => {
  it('is always shadow', () => {
    // There is no external system for it to be authoritative over.
    expect(createLocalChatTransport().mode).toBe('shadow')
  })
})

const edit: PublishEditInput = {
  conversationId: message.conversationId,
  messageId: message.messageId,
  senderUserId: message.senderUserId,
  senderName: message.senderName,
  body: 'hello, corrected',
  editedAt: new Date('2026-09-10T00:05:00.000Z'),
}

const deletion: PublishDeletionInput = {
  conversationId: message.conversationId,
  messageId: message.messageId,
  actorUserId: message.senderUserId,
  actorName: message.senderName,
}

/** A transport whose every method throws, to prove the wrappers absorb it. */
function failingTransport(error: unknown): ChatTransport {
  return {
    id: 'matrix',
    mode: 'authoritative',
    async ensureConversation() {},
    async recordPublication() {},
    async publishMessage() {
      return { externalId: null }
    },
    async publishReaction() {},
    async publishEdit() {
      throw error
    },
    async publishDeletion() {
      throw error
    },
  }
}

describe('the local transport handles an edit and a deletion', () => {
  const transport = createLocalChatTransport()

  it('has nowhere to send a rewritten body', () => {
    return expect(transport.publishEdit(ctx, scope, edit)).resolves.toBeUndefined()
  })

  it('has nothing holding a second copy to remove', () => {
    return expect(transport.publishDeletion(ctx, scope, deletion)).resolves.toBeUndefined()
  })
})

describe('publishEditSafely', () => {
  it('swallows a failure rather than failing an edit that already committed', async () => {
    // The new body is already stored and the readers already notified. Throwing
    // would report a failure for a change the author can see worked, and would
    // not make the two systems agree.
    await expect(
      publishEditSafely(failingTransport(new Error('homeserver unreachable')), ctx, scope, edit),
    ).resolves.toBeUndefined()
  })

  it('swallows a non-Error rejection too', async () => {
    await expect(
      publishEditSafely(failingTransport('string rejection'), ctx, scope, edit),
    ).resolves.toBeUndefined()
  })

  /**
   * Best-effort in BOTH modes, unlike a message. The fixture above is
   * `authoritative` on purpose: an edit has no hole a send has, because a row
   * can never exist for a body the stream has never carried.
   */
  it('is best-effort even when the messaging system is authoritative', async () => {
    const transport = failingTransport(new Error('down'))
    expect(transport.mode).toBe('authoritative')
    await expect(publishEditSafely(transport, ctx, scope, edit)).resolves.toBeUndefined()
  })
})

describe('publishDeletionSafely', () => {
  it('swallows a failure rather than leaving a message the caller asked to remove', async () => {
    // Refusing would be worse in both directions: the message stays visible in
    // Operis, and it is still in the external system either way.
    await expect(
      publishDeletionSafely(failingTransport(new Error('redaction refused')), ctx, scope, deletion),
    ).resolves.toBeUndefined()
  })

  it('swallows a non-Error rejection too', async () => {
    await expect(
      publishDeletionSafely(failingTransport('string rejection'), ctx, scope, deletion),
    ).resolves.toBeUndefined()
  })
})
