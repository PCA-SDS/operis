import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { MatrixConfig } from './config'
import { type MatrixEvent, parseMatrixEvent } from './events'

/**
 * The homeserver-facing half of the appservice contract: how Operis proves what
 * it is entitled to, and how it decides a pushed transaction really came from
 * the homeserver.
 */

export type RegistrationOptions = {
  /** Stable identifier for this appservice in the homeserver's config. */
  id?: string
  /**
   * Where the homeserver pushes transactions, or `null` for pull-only.
   *
   * `null` while Operis polls `/sync`: it leaves no inbound endpoint to
   * authenticate, rate-limit or defend. A URL is required only once bridges
   * originate messages Operis did not send.
   */
  url?: string | null
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Render the registration YAML the homeserver loads.
 *
 * Hand-rolled rather than serialised with a YAML library: the namespace regexes
 * must be single-quoted scalars. A double-quoted YAML scalar processes
 * backslash escapes and rejects `\.` outright, which produces a homeserver that
 * refuses to start with a parser stack trace rather than anything about
 * appservices.
 */
export function buildRegistration(config: MatrixConfig, options: RegistrationOptions = {}): string {
  const id = options.id ?? 'operis-chat'
  const url = options.url ?? null
  const domain = escapeRegex(config.serverName)

  return `# Matrix application service registration for Operis.
# Generated — contains live credentials, never commit.
id: ${id}
url: ${url === null ? 'null' : JSON.stringify(url)}
as_token: "${config.asToken}"
hs_token: "${config.hsToken ?? ''}"
sender_localpart: ${config.senderLocalpart}
namespaces:
  users:
    - exclusive: true
      regex: '@${config.userPrefix}.*:${domain}'
  aliases:
    - exclusive: true
      regex: '#${config.userPrefix}.*'
  rooms: []
rate_limited: false
`
}

/**
 * Constant-time comparison of the token the homeserver presented.
 *
 * Timing-safe because a byte-by-byte comparison of a shared secret is
 * measurable over enough requests, and this endpoint is, by construction,
 * reachable by anything that can route to it.
 */
export function verifyHomeserverToken(presented: string | null | undefined, expected: string): boolean {
  if (!presented || !expected) return false
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  // timingSafeEqual throws on a length mismatch, which would itself be a timing
  // signal; comparing the lengths first and returning the same way keeps the
  // failure shape uniform.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** `Authorization: Bearer <hs_token>` is the spec form; the query parameter is legacy. */
export function extractHomeserverToken(headers: {
  get(name: string): string | null
}): string | null {
  const header = headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

const transactionSchema = z.looseObject({
  events: z.array(z.unknown()).default([]),
  ephemeral: z.array(z.unknown()).optional(),
})

export type AppserviceTransaction = {
  events: MatrixEvent[]
  /** Count before parsing, so a drop caused by a malformed event is visible. */
  receivedCount: number
}

/**
 * Parse a pushed transaction body.
 *
 * Events that fail to parse are dropped rather than failing the transaction. A
 * 4xx here makes Synapse retry the identical payload forever, and because
 * appservice transactions are delivered in order, one unparseable event would
 * stall every later event for every tenant.
 */
export function parseTransaction(body: unknown): AppserviceTransaction | null {
  const parsed = transactionSchema.safeParse(body)
  if (!parsed.success) return null
  const events = parsed.data.events
    .map(parseMatrixEvent)
    .filter((event): event is MatrixEvent => event !== null)
  return { events, receivedCount: parsed.data.events.length }
}

/**
 * Server-side `/sync` filter: timeline only, and only the event types the
 * transport projects.
 *
 * Without it an initial sync returns full room state, presence and account data
 * for every joined room. Narrowing at the server is the difference between a
 * first poll that costs a few kilobytes and one that costs megabytes.
 */
export function buildSyncFilter(options: { timelineLimit?: number } = {}): string {
  return JSON.stringify({
    presence: { types: [] },
    account_data: { types: [] },
    room: {
      account_data: { types: [] },
      ephemeral: { types: [] },
      state: { types: [], lazy_load_members: true },
      timeline: {
        limit: options.timelineLimit ?? 50,
        types: ['m.room.message', 'm.reaction', 'm.room.redaction', 'm.room.member'],
      },
    },
  })
}
