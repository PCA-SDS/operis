import { MatrixNamespaceError } from './errors'
import { UUID_SHAPE_PATTERN } from '@open-mercato/shared/lib/validation'

/**
 * Everything needed to map between Operis user ids and Matrix user ids.
 *
 * `userPrefix` must match the exclusive user namespace regex in the appservice
 * registration. Changing it strands every identity already minted under the old
 * one, so it is configuration that is set once and then left alone.
 */
export type MatrixIdentityConfig = {
  /** The `:domain` half of every id on this homeserver, e.g. `operis.local`. */
  serverName: string
  /** Exclusive localpart prefix owned by the appservice, e.g. `om_`. */
  userPrefix: string
  /** The appservice's own user (`sender_localpart` in the registration). */
  senderLocalpart: string
  /** The namespaced user that joins rooms, runs `/sync` and owns rooms. */
  botLocalpart: string
}

export type ParsedMxid = {
  userId: string
  localpart: string
  serverName: string
}

/** Matrix user id grammar: `@localpart:server_name[:port]`. */
const MXID_PATTERN = /^@([a-z0-9._=/+-]+):([a-zA-Z0-9.-]+(?::\d{1,5})?)$/

/**
 * The user-localpart shape this package mints: `<prefix>u_<32 hex>`.
 *
 * The `u_` infix leaves room for other namespaced identity classes later — a
 * bridged external contact is not an Operis user and must not be derivable from
 * the same function.
 */
const USER_LOCALPART_PATTERN = /^(.+?)u_([0-9a-f]{32})$/

export function parseMxid(userId: string): ParsedMxid | null {
  const match = MXID_PATTERN.exec(userId)
  if (!match) return null
  return { userId, localpart: match[1], serverName: match[2] }
}

/**
 * The network a bridge ghost speaks for, or null when the sender is not one.
 *
 * A ghost lives on this homeserver, in a namespace its bridge registered, and
 * its localpart carries the bridge's prefix plus something of its own — never
 * the bare prefix. Anything else — a colleague's identity, the Operis bot, a
 * bridge's own bot, an unconfigured namespace — is not an outsider here.
 */
export function bridgeGhostNetwork(
  config: { serverName: string; bridgeGhosts?: readonly { network: string; prefix: string }[] },
  userId: string,
): string | null {
  const parsed = parseMxid(userId)
  if (!parsed || parsed.serverName !== config.serverName) return null
  for (const ghost of config.bridgeGhosts ?? []) {
    if (parsed.localpart.startsWith(ghost.prefix) && parsed.localpart.length > ghost.prefix.length) {
      return ghost.network
    }
  }
  return null
}

/**
 * Derive the Matrix localpart for an Operis user.
 *
 * Deterministic, so the mapping can be recomputed rather than only looked up —
 * which matters when reconciling a room whose membership drifted from the
 * database. The UUID is lower-cased and stripped of dashes because a Matrix
 * localpart may not contain uppercase characters.
 */
export function localpartForUser(config: MatrixIdentityConfig, operisUserId: string): string {
  const trimmed = operisUserId.trim()
  if (!UUID_SHAPE_PATTERN.test(trimmed)) {
    throw new MatrixNamespaceError(
      '[internal] expected a UUID when deriving a Matrix localpart',
      operisUserId,
    )
  }
  return `${config.userPrefix}u_${trimmed.toLowerCase().replace(/-/g, '')}`
}

export function mxidForUser(config: MatrixIdentityConfig, operisUserId: string): string {
  return `@${localpartForUser(config, operisUserId)}:${config.serverName}`
}

/**
 * The inverse of {@link mxidForUser}, or `null` when the id is not one of ours.
 *
 * Needed on the read path: an event's sender arrives as an mxid and has to
 * become an Operis user id before it can be projected. Returning `null` rather
 * than throwing is deliberate — a room will legitimately contain the bot, and
 * later bridged users, neither of which map back to an Operis account.
 */
export function operisUserIdFromMxid(
  config: MatrixIdentityConfig,
  userId: string,
): string | null {
  const parsed = parseMxid(userId)
  if (!parsed || parsed.serverName !== config.serverName) return null

  const match = USER_LOCALPART_PATTERN.exec(parsed.localpart)
  if (!match || match[1] !== config.userPrefix) return null

  const hex = match[2]
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

export function senderMxid(config: MatrixIdentityConfig): string {
  return `@${config.senderLocalpart}:${config.serverName}`
}

/**
 * The identity that reads timelines and owns rooms.
 *
 * It cannot be the appservice's own sender: Synapse refuses `/sync` for
 * `sender_localpart` outright — "We no longer support AS users using /sync
 * directly" (matrix-doc#1144) — so anything that reads has to be a separate
 * namespaced account. The mautrix bridges do the same for the same reason.
 */
export function botMxid(config: MatrixIdentityConfig): string {
  return `@${config.botLocalpart}:${config.serverName}`
}

/**
 * Messaging-account identities — the Matrix users that own a bridge login.
 *
 * A connected WhatsApp account is one Matrix user; messages it sends in a portal
 * leave as that WhatsApp account. Two classes, deliberately in different
 * namespaces:
 *
 * - a COMPANY account is `<prefix>a_<hex32>`, inside the Operis namespace, so the
 *   homeserver pushes its rooms to Operis;
 * - a PERSONAL account is `opp_<hex32>`, OUTSIDE it, so the homeserver pushes its
 *   rooms to nobody and an employee's private chats never reach Operis.
 *
 * Both hex strings are the account's uuid, lower-cased without dashes — derived,
 * like a colleague's, so one organization's account can never be addressed as
 * another's. Both prefixes are one-way doors: every identity already minted
 * lives under them.
 */
export const PERSONAL_ACCOUNT_PREFIX = 'opp_'

export type MessagingAccountOwner = 'company' | 'user'

const HEX32 = /^[0-9a-f]{32}$/

function hexOfUuid(uuid: string): string {
  const trimmed = uuid.trim()
  if (!UUID_SHAPE_PATTERN.test(trimmed)) {
    throw new MatrixNamespaceError('[internal] expected a UUID when deriving an account identity', trimmed)
  }
  return trimmed.replace(/-/g, '').toLowerCase()
}

export function localpartForAccount(
  config: Pick<MatrixIdentityConfig, 'userPrefix'>,
  accountId: string,
  owner: MessagingAccountOwner,
): string {
  const hex = hexOfUuid(accountId)
  return owner === 'company' ? `${config.userPrefix}a_${hex}` : `${PERSONAL_ACCOUNT_PREFIX}${hex}`
}

export function accountMxid(
  config: Pick<MatrixIdentityConfig, 'userPrefix' | 'serverName'>,
  accountId: string,
  owner: MessagingAccountOwner,
): string {
  return `@${localpartForAccount(config, accountId, owner)}:${config.serverName}`
}

/** The account behind an identity, or null when it is not an account identity on this server. */
export function accountFromMxid(
  config: Pick<MatrixIdentityConfig, 'userPrefix' | 'serverName'>,
  userId: string,
): { accountId: string; owner: MessagingAccountOwner } | null {
  const parsed = parseMxid(userId)
  if (!parsed || parsed.serverName !== config.serverName) return null
  const companyPrefix = `${config.userPrefix}a_`
  let owner: MessagingAccountOwner
  let hex: string
  if (parsed.localpart.startsWith(companyPrefix)) {
    owner = 'company'
    hex = parsed.localpart.slice(companyPrefix.length)
  } else if (parsed.localpart.startsWith(PERSONAL_ACCOUNT_PREFIX)) {
    owner = 'user'
    hex = parsed.localpart.slice(PERSONAL_ACCOUNT_PREFIX.length)
  } else {
    return null
  }
  if (!HEX32.test(hex)) return null
  const accountId = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
  return { accountId, owner }
}

/**
 * The gate for the double-puppet client: it may act as account identities and
 * nothing else — never as a colleague, the sender or the bot.
 */
export function assertAccountIdentity(
  config: Pick<MatrixIdentityConfig, 'userPrefix' | 'serverName'>,
  userId: string,
): string {
  if (!accountFromMxid(config, userId)) {
    throw new MatrixNamespaceError('[internal] refusing to act as a Matrix user that is not an account identity', userId)
  }
  return userId
}

/** True when this appservice is entitled to act as `userId`. */
export function isOwnedIdentity(config: MatrixIdentityConfig, userId: string): boolean {
  const parsed = parseMxid(userId)
  if (!parsed || parsed.serverName !== config.serverName) return false
  if (parsed.localpart === config.senderLocalpart) return true
  return parsed.localpart.startsWith(config.userPrefix)
}

/**
 * Gate every masquerade through this.
 *
 * The appservice token can act as any user inside its registered namespace, so
 * the blast radius of a bug in identity derivation is bounded by exactly one
 * check. Failing closed here turns "acted as the wrong person" into "refused to
 * act at all", which is the failure mode worth having.
 */
export function assertMasqueradable(config: MatrixIdentityConfig, userId: string): string {
  if (!isOwnedIdentity(config, userId)) {
    throw new MatrixNamespaceError(
      '[internal] refusing to act as a Matrix user outside the appservice namespace',
      userId,
    )
  }
  return userId
}
