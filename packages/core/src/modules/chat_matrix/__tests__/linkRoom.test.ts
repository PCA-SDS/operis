import type { MatrixConfig } from '@open-mercato/matrix'
import { ChatMatrixRoom } from '../data/entities'
import {
  isLinkRoomRefusal,
  linkExternalRoom,
  unlinkExternalConversation,
  type LinkRoomInput,
  type LinkRoomRefusalReason,
} from '../lib/linkRoom'
import { externalContactIdFor, type OutsiderDeps } from '../lib/outsiders'
import { BOT, FakeEntityManager, FakeMatrixClient, testConfig } from './fakes'

const mockLoadOrganizationMembers = jest.fn()
const mockAddRoomMember = jest.fn()
const mockEncryptionEnabled = jest.fn()

jest.mock('@open-mercato/core/modules/chat/lib/scope', () => ({
  ...jest.requireActual('@open-mercato/core/modules/chat/lib/scope'),
  loadOrganizationMembers: (...args: unknown[]) => mockLoadOrganizationMembers(...args),
}))
jest.mock('../lib/rooms', () => ({
  ...jest.requireActual('../lib/rooms'),
  addRoomMember: (...args: unknown[]) => mockAddRoomMember(...args),
}))
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/toggles'),
  isTenantDataEncryptionEnabled: () => mockEncryptionEnabled(),
}))

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const ROOM = '!bridged:operis.local'
const CONVERSATION = '44444444-4444-4444-8444-444444444444'
const MEMBER = '78dce603-8282-444a-98ad-1c902a01332e'
const MEMBER_MXID = '@om_u_78dce6038282444a98ad1c902a01332e:operis.local'
const GHOST = '@whatsapp_4915123456789:operis.local'
const UNNAMED_GHOST = '@whatsapp_4930111222333:operis.local'
const BRIDGE_BOT = '@whatsappbot:operis.local'

const bridgedConfig: MatrixConfig = { ...testConfig, bridgeGhosts: [{ network: 'whatsapp', prefix: 'whatsapp_' }] }

function harness(options: { config?: MatrixConfig; encryptedFor?: Array<string | null> } = {}) {
  const em = new FakeEntityManager()
  const client = new FakeMatrixClient()
  client.joinedByRoom[ROOM] = {
    [BOT]: { display_name: 'Operis' },
    [GHOST]: { display_name: ' Linh Tran ' },
    [UNNAMED_GHOST]: {},
    [BRIDGE_BOT]: { display_name: 'WhatsApp bridge bot' },
  }
  client.powerLevelsByRoom[ROOM] = { users: { [BOT]: 100 }, users_default: 0, invite: 50 }

  const executed: Array<{ commandId: string; input: Record<string, unknown> }> = []
  const commandBus = {
    execute: async (commandId: string, args: { input: Record<string, unknown> }) => {
      executed.push({ commandId, input: args.input })
      return commandId === 'chat.conversations.createExternal' ? { result: { conversationId: CONVERSATION } } : { result: {} }
    },
  }
  const encryptedFor = options.encryptedFor ?? []
  const encryptionService = {
    getEncryptedFieldNames: async (_entityId: string, _tenantId: string, organizationId: string | null) =>
      encryptedFor.includes(organizationId) ? ['display_name'] : [],
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'tenantEncryptionService') return encryptionService
      throw new Error(`unregistered ${name}`)
    },
  }
  const deps: OutsiderDeps = {
    em: em.asEntityManager(),
    client: client.asClient(),
    config: options.config ?? bridgedConfig,
    commandBus: commandBus as unknown as OutsiderDeps['commandBus'],
    container: container as unknown as OutsiderDeps['container'],
  }
  return { em, client, executed, deps }
}

const input = (overrides: Partial<LinkRoomInput> = {}): LinkRoomInput => ({
  roomId: ROOM,
  ...scope,
  memberUserIds: [MEMBER],
  ...overrides,
})

async function refusalOf(promise: Promise<unknown>): Promise<LinkRoomRefusalReason | 'linked'> {
  try {
    await promise
    return 'linked'
  } catch (error) {
    if (isLinkRoomRefusal(error)) return error.refusal
    throw error
  }
}

beforeEach(() => {
  mockLoadOrganizationMembers.mockReset()
  mockLoadOrganizationMembers.mockImplementation(async (_em: unknown, _scope: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, { id, name: 'Colleague', email: 'colleague@example.com' }])),
  )
  mockAddRoomMember.mockReset()
  mockAddRoomMember.mockResolvedValue(undefined)
  mockEncryptionEnabled.mockReset()
  mockEncryptionEnabled.mockReturnValue(false)
})

describe('linkExternalRoom — every refusal comes before any write', () => {
  function expectNothingWritten(world: ReturnType<typeof harness>) {
    expect(world.executed).toEqual([])
    expect(world.em.rowsOf(ChatMatrixRoom).filter((row) => row.conversationId === CONVERSATION)).toEqual([])
    expect(world.em.flushes).toBe(0)
    expect(mockAddRoomMember).not.toHaveBeenCalled()
  }

  it('refuses when no bridge is configured, since nobody could be an outsider', async () => {
    const world = harness({ config: testConfig })
    expect(await refusalOf(linkExternalRoom(world.deps, input()))).toBe('no-bridges')
    expectNothingWritten(world)
  })

  it('refuses something that is not a room id', async () => {
    const world = harness()
    expect(await refusalOf(linkExternalRoom(world.deps, input({ roomId: 'bridged' })))).toBe('invalid-room')
    expectNothingWritten(world)
  })

  it('refuses a room that already backs a conversation', async () => {
    const world = harness()
    world.em.seed(ChatMatrixRoom, { ...scope, roomId: ROOM, conversationId: 'another', state: 'ready' })
    expect(await refusalOf(linkExternalRoom(world.deps, input()))).toBe('already-mapped')
    expectNothingWritten(world)
  })

  it('refuses a link with no colleague to read it', async () => {
    const world = harness()
    expect(await refusalOf(linkExternalRoom(world.deps, input({ memberUserIds: [' ', ''] })))).toBe('no-member')
    expectNothingWritten(world)
  })

  it('refuses a colleague who is not an active member of the organization', async () => {
    const world = harness()
    mockLoadOrganizationMembers.mockResolvedValue(new Map())
    expect(await refusalOf(linkExternalRoom(world.deps, input()))).toBe('not-a-member')
    expectNothingWritten(world)
  })

  it('refuses while contact names would be stored unencrypted', async () => {
    const world = harness({ encryptedFor: [] })
    mockEncryptionEnabled.mockReturnValue(true)
    expect(await refusalOf(linkExternalRoom(world.deps, input()))).toBe('encryption-map-missing')
    expectNothingWritten(world)
  })

  it('refuses a room the Operis bot is not in', async () => {
    const world = harness()
    delete world.client.joinedByRoom[ROOM]![BOT]
    expect(await refusalOf(linkExternalRoom(world.deps, input()))).toBe('bot-not-joined')
    expectNothingWritten(world)
  })

  it('refuses a room where the bot could never seat a colleague', async () => {
    const world = harness()
    world.client.powerLevelsByRoom[ROOM] = { users: { [BOT]: 0 }, users_default: 0, invite: 50 }
    expect(await refusalOf(linkExternalRoom(world.deps, input()))).toBe('bot-cannot-invite')
    expectNothingWritten(world)
  })

  it('refuses when the power levels cannot be read, rather than assuming', async () => {
    const world = harness()
    delete world.client.powerLevelsByRoom[ROOM]
    expect(await refusalOf(linkExternalRoom(world.deps, input()))).toBe('bot-cannot-invite')
    expectNothingWritten(world)
  })

  it("refuses a room with nobody from a configured bridge — a bridge's own bot is not an outsider", async () => {
    const world = harness()
    world.client.joinedByRoom[ROOM] = { [BOT]: {}, [MEMBER_MXID]: {}, [BRIDGE_BOT]: {} }
    expect(await refusalOf(linkExternalRoom(world.deps, input()))).toBe('no-ghost')
    expectNothingWritten(world)
  })
})

describe('linkExternalRoom — linking', () => {
  it('ensures a contact per ghost, opens one external conversation, maps the room, seats colleagues', async () => {
    const world = harness()
    const result = await linkExternalRoom(world.deps, input({ memberUserIds: [MEMBER, ` ${MEMBER} `], title: 'Supplier' }))

    expect(result).toEqual({ conversationId: CONVERSATION, contacts: 2 })
    const named = externalContactIdFor(scope, GHOST)
    const unnamed = externalContactIdFor(scope, UNNAMED_GHOST)
    expect(world.executed).toEqual([
      {
        commandId: 'chat.externalContacts.ensure',
        input: { ...scope, id: named, network: 'whatsapp', displayName: 'Linh Tran' },
      },
      {
        commandId: 'chat.externalContacts.ensure',
        input: { ...scope, id: unnamed, network: 'whatsapp', displayName: '4930111222333' },
      },
      {
        commandId: 'chat.conversations.createExternal',
        input: { ...scope, title: 'Supplier', externalContactIds: [named, unnamed], memberUserIds: [MEMBER] },
      },
    ])
    expect(world.em.rowsOf(ChatMatrixRoom)).toEqual([
      expect.objectContaining({ ...scope, roomId: ROOM, conversationId: CONVERSATION, state: 'ready', lastError: null }),
    ])
    expect(mockAddRoomMember).toHaveBeenCalledTimes(1)
    expect(mockAddRoomMember).toHaveBeenCalledWith(world.deps, scope.tenantId, ROOM, MEMBER)
  })

  it('links once a tenant-wide encryption map covers contact names', async () => {
    const world = harness({ encryptedFor: [null] })
    mockEncryptionEnabled.mockReturnValue(true)
    expect(await refusalOf(linkExternalRoom(world.deps, input()))).toBe('linked')
  })

  it('still links when a colleague cannot be seated yet — their first send retries', async () => {
    const world = harness()
    mockAddRoomMember.mockRejectedValue(new Error('M_FORBIDDEN'))
    await expect(linkExternalRoom(world.deps, input())).resolves.toEqual({ conversationId: CONVERSATION, contacts: 2 })
    expect(world.em.rowsOf(ChatMatrixRoom)).toHaveLength(1)
  })

  it('closes the new conversation again when the room mapping cannot be written', async () => {
    const world = harness()
    world.em.failNextFlushWithUniqueViolation = true

    await expect(linkExternalRoom(world.deps, input())).rejects.toThrow('duplicate key')
    expect(world.executed.at(-1)).toEqual({
      commandId: 'chat.conversations.closeExternal',
      input: { ...scope, conversationId: CONVERSATION },
    })
    expect(world.em.rowsOf(ChatMatrixRoom)).toEqual([])
    expect(mockAddRoomMember).not.toHaveBeenCalled()
  })
})

describe('unlinkExternalConversation', () => {
  it('refuses a conversation no room backs', async () => {
    const world = harness()
    expect(await refusalOf(unlinkExternalConversation(world.deps, CONVERSATION))).toBe('not-linked')
    expect(world.executed).toEqual([])
  })

  it('closes the conversation and forgets the room, leaving the room to its bridge', async () => {
    const world = harness()
    world.em.seed(ChatMatrixRoom, { ...scope, roomId: ROOM, conversationId: CONVERSATION, state: 'ready' })

    await expect(unlinkExternalConversation(world.deps, CONVERSATION)).resolves.toEqual({ roomId: ROOM })
    expect(world.executed).toEqual([
      { commandId: 'chat.conversations.closeExternal', input: { ...scope, conversationId: CONVERSATION } },
    ])
    expect(world.em.rowsOf(ChatMatrixRoom)).toEqual([])
    expect(world.client.calls).toEqual([])
  })
})
