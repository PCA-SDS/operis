import { createLogger } from '@open-mercato/shared/lib/logger'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { botMxid, bridgeGhostNetwork } from '@open-mercato/matrix'
import { loadOrganizationMembers, type ChatScope } from '@open-mercato/core/modules/chat/lib/scope'
import { ChatMatrixRoom } from '../data/entities'
import { addRoomMember } from './rooms'
import { ensureBotRegistered } from './identities'
import { externalContactIdFor, fallbackGhostName, systemContext, type OutsiderDeps } from './outsiders'

const logger = createLogger('chat_matrix').child({ component: 'link-room' })

/**
 * Link one bridged Matrix room to a new external conversation — by hand.
 *
 * The operator picks the organization and the colleagues; choosing them
 * automatically when a bridge creates a room is the bridge spec's work. Every
 * check below runs before anything is written, so a refusal changes nothing.
 */

export type LinkRoomRefusalReason =
  | 'no-bridges'
  | 'invalid-room'
  | 'already-mapped'
  | 'no-member'
  | 'not-a-member'
  | 'encryption-map-missing'
  | 'bot-not-joined'
  | 'bot-cannot-invite'
  | 'no-ghost'
  | 'not-linked'

export class LinkRoomRefusal extends Error {
  readonly refusal: LinkRoomRefusalReason
  constructor(refusal: LinkRoomRefusalReason, message: string) {
    super(message)
    this.name = 'LinkRoomRefusal'
    this.refusal = refusal
  }
}

/** Structural, not `instanceof`: a class loses its identity across bundle chunks. */
export function isLinkRoomRefusal(error: unknown): error is LinkRoomRefusal {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'LinkRoomRefusal' &&
    typeof (error as { refusal?: unknown }).refusal === 'string'
  )
}

export type LinkRoomInput = {
  roomId: string
  tenantId: string
  organizationId: string
  memberUserIds: string[]
  title?: string | null
}

const CONTACT_ENTITY_ID = 'chat:chat_external_contact'

type EncryptionServiceLike = {
  getEncryptedFieldNames(
    entityId: string,
    tenantId: string | null | undefined,
    organizationId?: string | null,
    options?: { ignoreRuntimeHealth?: boolean },
  ): Promise<string[]>
}

/**
 * With tenant data encryption on, a contact's name must be encrypted — and maps
 * are stored per tenant, seeded only when a tenant is created. An existing
 * tenant has none for contacts until an operator seeds it, and a contact
 * written before that would sit in plain text.
 */
async function assertContactNamesEncrypt(deps: OutsiderDeps, scope: ChatScope): Promise<void> {
  if (!isTenantDataEncryptionEnabled()) return
  let service: EncryptionServiceLike | null = null
  try {
    service = (deps.container as { resolve<T>(name: string): T }).resolve<EncryptionServiceLike>('tenantEncryptionService')
  } catch {
    service = null
  }
  const encrypted = async (organizationId: string | null) =>
    service
      ? (await service.getEncryptedFieldNames(CONTACT_ENTITY_ID, scope.tenantId, organizationId, {
          ignoreRuntimeHealth: true,
        })).includes('display_name')
      : false
  if ((await encrypted(scope.organizationId)) || (await encrypted(null))) return
  throw new LinkRoomRefusal(
    'encryption-map-missing',
    `Contact names would be stored unencrypted: this tenant has no encryption map for them yet. Run: yarn mercato entities seed-encryption --tenant ${scope.tenantId}`,
  )
}

function readPowerLevel(levels: Record<string, unknown>, userId: string): { user: number; invite: number } {
  const users = (levels.users ?? {}) as Record<string, unknown>
  const own = users[userId]
  const usersDefault = typeof levels.users_default === 'number' ? levels.users_default : 0
  const invite = typeof levels.invite === 'number' ? levels.invite : 0
  return { user: typeof own === 'number' ? own : usersDefault, invite }
}

export async function linkExternalRoom(
  deps: OutsiderDeps,
  input: LinkRoomInput,
): Promise<{ conversationId: string; contacts: number }> {
  const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
  if ((deps.config.bridgeGhosts ?? []).length === 0) {
    throw new LinkRoomRefusal(
      'no-bridges',
      'OM_MATRIX_BRIDGE_GHOSTS is empty, so no sender could ever be an outsider — there is nothing to link.',
    )
  }
  const roomId = input.roomId.trim()
  if (!roomId.startsWith('!') || !roomId.includes(':')) {
    throw new LinkRoomRefusal('invalid-room', 'A room id looks like !abc:server.')
  }
  if (await deps.em.findOne(ChatMatrixRoom, { roomId })) {
    throw new LinkRoomRefusal('already-mapped', 'That room already backs a conversation.')
  }

  const memberUserIds = [...new Set(input.memberUserIds.map((id) => id.trim()).filter((id) => id.length > 0))]
  if (memberUserIds.length === 0) {
    throw new LinkRoomRefusal('no-member', 'Name at least one colleague with --members; nobody inside could read it otherwise.')
  }
  const members = await loadOrganizationMembers(deps.em, scope, memberUserIds)
  if (members.size !== memberUserIds.length) {
    throw new LinkRoomRefusal('not-a-member', 'Every --members id must be an active member of the organization.')
  }

  await assertContactNamesEncrypt(deps, scope)

  const bot = botMxid(deps.config)
  await ensureBotRegistered(deps)
  let joined: Record<string, unknown> = {}
  try {
    joined = (await deps.client.joinedMembers(roomId, bot)).joined ?? {}
  } catch {
    joined = {}
  }
  if (!(bot in joined)) {
    throw new LinkRoomRefusal('bot-not-joined', 'The Operis bot is not in that room. Have the bridge invite it first.')
  }
  const levels = await deps.client
    .getStateEvent<Record<string, unknown>>(roomId, 'm.room.power_levels', '', bot)
    .catch(() => null)
  const power = levels ? readPowerLevel(levels, bot) : null
  if (!power || power.user < power.invite) {
    throw new LinkRoomRefusal(
      'bot-cannot-invite',
      'The Operis bot cannot invite in that room (or its power levels could not be read), so colleagues could never be seated to answer.',
    )
  }

  const ghosts = Object.keys(joined).filter((userId) => bridgeGhostNetwork(deps.config, userId) !== null)
  if (ghosts.length === 0) {
    throw new LinkRoomRefusal('no-ghost', 'Nobody in that room belongs to a configured bridge.')
  }

  const ctx = systemContext(deps, scope)
  const externalContactIds: string[] = []
  for (const ghost of ghosts) {
    const id = externalContactIdFor(scope, ghost)
    const info = joined[ghost]
    const raw = info && typeof info === 'object' ? (info as { display_name?: unknown }).display_name : undefined
    const displayName = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallbackGhostName(deps.config, ghost)
    await deps.commandBus.execute('chat.externalContacts.ensure', {
      input: { ...scope, id, network: bridgeGhostNetwork(deps.config, ghost) ?? 'other', displayName },
      ctx,
    })
    externalContactIds.push(id)
  }

  const created = await deps.commandBus.execute<Record<string, unknown>, { conversationId: string }>(
    'chat.conversations.createExternal',
    { input: { ...scope, title: input.title ?? null, externalContactIds, memberUserIds }, ctx },
  )
  const conversationId = created.result?.conversationId
  if (!conversationId) throw new Error('[internal] chat.conversations.createExternal returned no conversation')

  try {
    const now = new Date()
    deps.em.persist(
      deps.em.create(ChatMatrixRoom, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        conversationId,
        roomId,
        state: 'ready',
        lastError: null,
        createdAt: now,
        updatedAt: now,
      }),
    )
    await deps.em.flush()
  } catch (error) {
    // No room behind it means nothing could ever reach it: close what was just
    // opened rather than leaving an unreachable conversation in the list.
    await deps.commandBus.execute('chat.conversations.closeExternal', {
      input: { ...scope, conversationId },
      ctx,
    })
    throw error
  }

  // Seated now for a clean first reply. Not required: a colleague's first send
  // seats them anyway, through the invite-and-retry every publish already has.
  for (const userId of memberUserIds) {
    try {
      await addRoomMember(deps, scope.tenantId, roomId, userId)
    } catch (error) {
      logger.warn('could not seat a colleague in a linked room; their first send will retry', {
        roomId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { conversationId, contacts: externalContactIds.length }
}

/**
 * Undo a link: close the conversation and drop the mapping, so the projector
 * reads the room as unmapped again. The room itself is untouched — it belongs to
 * the bridge. Refuses anything but an external conversation, via the command.
 */
export async function unlinkExternalConversation(
  deps: OutsiderDeps,
  conversationId: string,
): Promise<{ roomId: string }> {
  const mapping = await deps.em.findOne(ChatMatrixRoom, { conversationId })
  if (!mapping) throw new LinkRoomRefusal('not-linked', 'That conversation is not linked to a room.')
  const scope: ChatScope = { tenantId: mapping.tenantId, organizationId: mapping.organizationId }

  await deps.commandBus.execute('chat.conversations.closeExternal', {
    input: { ...scope, conversationId },
    ctx: systemContext(deps, scope),
  })
  deps.em.remove(mapping)
  await deps.em.flush()
  return { roomId: mapping.roomId }
}
