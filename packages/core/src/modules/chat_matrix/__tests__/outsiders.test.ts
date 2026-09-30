import { z } from 'zod'
import type { MatrixConfig } from '@open-mercato/matrix'
import {
  actorKey,
  externalContactIdFor,
  ghostPhoneNumber,
  receiptActor,
  resolveProjectionActor,
  withActorOrigin,
  type OutsiderDeps,
} from '../lib/outsiders'
import type { ChatMatrixRoom } from '../data/entities'

const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const GHOST = '@whatsapp_4915123456789:operis.local'
const COLLEAGUE_ID = '0123456789abcdef0123456789abcdef'
const COLLEAGUE = `@om_u_${COLLEAGUE_ID}:operis.local`

const config: MatrixConfig = {
  baseUrl: 'http://synapse:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
  senderLocalpart: 'operis',
  userPrefix: 'om_',
  botLocalpart: 'om_bot',
  bridgeGhosts: [{ network: 'whatsapp', prefix: 'whatsapp_' }],
}

/**
 * The contact id is a one-way door: change how it is derived and every outsider
 * already known becomes someone new, their history attributed to contacts no
 * sender resolves to. This pins one real value.
 */
describe('externalContactIdFor', () => {
  it('is the same id it has always been for a known ghost', () => {
    expect(externalContactIdFor(SCOPE, GHOST)).toBe('6e0fd4d0-c39d-8c54-b3bc-6c6c0faa1949')
  })

  it('is a valid UUID for strict validators', () => {
    expect(z.string().uuid().safeParse(externalContactIdFor(SCOPE, GHOST)).success).toBe(true)
  })

  it('differs by organization — the same person is a different contact elsewhere', () => {
    const other = { ...SCOPE, organizationId: '33333333-3333-4333-8333-333333333333' }
    expect(externalContactIdFor(other, GHOST)).not.toBe(externalContactIdFor(SCOPE, GHOST))
  })
})

describe('ghostPhoneNumber', () => {
  it('reads the number a WhatsApp ghost stands for', () => {
    expect(ghostPhoneNumber(config, GHOST)).toBe('+4915123456789')
  })

  it('has none for a contact who hides their number, or for another server', () => {
    expect(ghostPhoneNumber(config, '@whatsapp_lid-123456789012:operis.local')).toBeNull()
    expect(ghostPhoneNumber(config, '@whatsapp_4915123456789:elsewhere.example')).toBeNull()
  })

  it('has none for a network whose ids are not phone numbers', () => {
    const telegram: MatrixConfig = { ...config, bridgeGhosts: [{ network: 'telegram', prefix: 'telegram_' }] }
    expect(ghostPhoneNumber(telegram, '@telegram_123456789:operis.local')).toBeNull()
  })
})

describe('actor helpers', () => {
  it('keeps a colleague reaction key as their user id, and prefixes an outsider', () => {
    expect(actorKey({ kind: 'user', userId: 'user-1' })).toBe('user-1')
    expect(actorKey({ kind: 'external', externalContactId: 'contact-1' })).toBe('ext-contact-1')
  })

  it('names the outsider inside externalOrigin, and nobody for a colleague', () => {
    expect(withActorOrigin({ eventId: '$e' }, { kind: 'external', externalContactId: 'contact-1' })).toEqual({
      eventId: '$e',
      externalContactId: 'contact-1',
    })
    expect(withActorOrigin({ eventId: '$e' }, { kind: 'user', userId: 'user-1' })).toEqual({ eventId: '$e' })
  })

  it('reads a receipt as a colleague, an outsider, or nobody — without seating anyone', () => {
    expect(receiptActor(config, SCOPE, COLLEAGUE)).toEqual({
      kind: 'user',
      userId: '01234567-89ab-cdef-0123-456789abcdef',
    })
    expect(receiptActor(config, SCOPE, GHOST)).toEqual({
      kind: 'external',
      externalContactId: externalContactIdFor(SCOPE, GHOST),
    })
    expect(receiptActor(config, SCOPE, '@whatsappbot:operis.local')).toBeNull()
  })
})

describe('resolveProjectionActor — the decision table', () => {
  let roomCounter = 0
  function room(): ChatMatrixRoom {
    roomCounter += 1
    return {
      roomId: `!room${roomCounter}:operis.local`,
      conversationId: 'conversation-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    } as ChatMatrixRoom
  }

  function deps(options: { kind: string | null; displayName?: string | null; membersFail?: boolean }) {
    const executed: Array<{ commandId: string; input: Record<string, unknown>; sub: unknown }> = []
    const built: OutsiderDeps = {
      em: {
        getConnection: () => ({
          execute: async () => (options.kind === null ? [] : [{ kind: options.kind }]),
        }),
      } as unknown as OutsiderDeps['em'],
      commandBus: {
        execute: async (commandId: string, args: { input: Record<string, unknown>; ctx: { auth?: { sub?: unknown } } }) => {
          executed.push({ commandId, input: args.input, sub: args.ctx.auth?.sub })
          return { result: {} }
        },
      } as unknown as OutsiderDeps['commandBus'],
      config,
      container: {} as OutsiderDeps['container'],
      client: {
        joinedMembers: async () => {
          if (options.membersFail) throw new Error('homeserver down')
          return { joined: { [GHOST]: { display_name: options.displayName ?? 'Linh Tran' } } }
        },
      } as unknown as OutsiderDeps['client'],
    }
    return { built, executed }
  }

  it('reads an Operis identity as a colleague, touching nothing', async () => {
    const { built, executed } = deps({ kind: 'external' })
    await expect(resolveProjectionActor(built, COLLEAGUE, room())).resolves.toEqual({
      ok: true,
      actor: { kind: 'user', userId: '01234567-89ab-cdef-0123-456789abcdef' },
    })
    expect(executed).toEqual([])
  })

  it('seats a configured ghost in an external conversation, through the commands', async () => {
    const { built, executed } = deps({ kind: 'external' })
    const resolved = await resolveProjectionActor(built, GHOST, room())
    const contactId = externalContactIdFor(SCOPE, GHOST)
    expect(resolved).toEqual({ ok: true, actor: { kind: 'external', externalContactId: contactId } })
    expect(executed.map((call) => call.commandId)).toEqual([
      'chat.externalContacts.ensure',
      'chat.conversations.addExternalParticipant',
    ])
    expect(executed[0]!.input).toMatchObject({ id: contactId, network: 'whatsapp', displayName: 'Linh Tran' })
    // No logged-in user behind either call: they run as the transport.
    expect(executed.every((call) => call.sub === undefined)).toBe(true)
  })

  it('names a ghost after its localpart when the bridge gave no name', async () => {
    const { built, executed } = deps({ kind: 'external', membersFail: true })
    await resolveProjectionActor(built, GHOST, room())
    expect(executed[0]!.input.displayName).toBe('4915123456789')
  })

  it('refuses a ghost inside a direct or a space', async () => {
    for (const kind of ['direct', 'space']) {
      const { built, executed } = deps({ kind })
      await expect(resolveProjectionActor(built, GHOST, room())).resolves.toEqual({
        ok: false,
        reason: 'external-in-internal-room',
      })
      expect(executed).toEqual([])
    }
  })

  it('reads a ghost in a closed conversation as an unmapped room', async () => {
    const { built } = deps({ kind: null })
    await expect(resolveProjectionActor(built, GHOST, room())).resolves.toEqual({ ok: false, reason: 'unmapped-room' })
  })

  it.each([
    ["a bridge's own bot", '@whatsappbot:operis.local'],
    ['an unconfigured namespace', '@telegram_1:operis.local'],
    ['the Operis bot', '@om_bot:operis.local'],
  ])('skips %s as external-sender', async (_label, sender) => {
    const { built, executed } = deps({ kind: 'external' })
    await expect(resolveProjectionActor(built, sender, room())).resolves.toEqual({
      ok: false,
      reason: 'external-sender',
    })
    expect(executed).toEqual([])
  })
})
