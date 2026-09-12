import { createHash } from 'node:crypto'

/**
 * Matrix transaction ids, derived rather than random.
 *
 * A transaction id is the protocol's idempotency key: sending twice with the
 * same one makes the homeserver return the ORIGINAL event id instead of posting
 * a duplicate. That turns an at-least-once delivery into exactly-once at the
 * room, but only if the id is a deterministic function of the thing being sent.
 * A random id gives all of the ceremony and none of the guarantee.
 */

const PREFIX = 'om-'

/**
 * Hashed rather than used raw for two reasons: a transaction id travels in the
 * URL path, so an identifier with a slash or a colon in it would need escaping
 * everywhere; and a raw id leaks an internal primary key into the homeserver's
 * logs. 128 bits of SHA-256 is far past collision concerns for a per-room,
 * per-sender key space.
 */
export function deriveTransactionId(operisId: string): string {
  return `${PREFIX}${createHash('sha256').update(operisId).digest('hex').slice(0, 32)}`
}

/**
 * A transaction id for a related-but-distinct event on the same subject.
 *
 * A reaction, an edit and a redaction can all target one message, and they must
 * not collide with each other or with the message's own send. The discriminator
 * keeps them apart while staying deterministic, so each remains individually
 * retry-safe.
 */
export function deriveRelatedTransactionId(operisId: string, discriminator: string): string {
  return deriveTransactionId(`${discriminator}:${operisId}`)
}

export function isDerivedTransactionId(value: string): boolean {
  return new RegExp(`^${PREFIX}[0-9a-f]{32}$`).test(value)
}
