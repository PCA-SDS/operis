import { MatrixNamespaceError } from './errors'

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseMxid(userId: string): ParsedMxid | null {
  const match = MXID_PATTERN.exec(userId)
  if (!match) return null
  return { userId, localpart: match[1], serverName: match[2] }
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
  if (!UUID_PATTERN.test(trimmed)) {
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
