import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'

/**
 * The database's clock, truncated to milliseconds.
 *
 * Chat timestamps are compared *across* rows written by different application
 * instances: a message's `created_at` is compared against a participant's
 * `last_read_at` to decide what is unread, and against another message's
 * `created_at` to paginate. `new Date()` makes each instance's own wall clock
 * the authority, so on a multi-instance deploy a fast instance can write a
 * message ahead of the read cursor a correctly-clocked instance later sets —
 * and that message becomes permanently invisible to the unread count. Reading
 * the time from the one clock every instance shares removes the class.
 *
 * Two details that are load-bearing:
 *
 * - **`now()`, not `clock_timestamp()`.** Inside a transaction `now()` is the
 *   transaction's start time and does not advance, so the message row and the
 *   conversation's denormalized `last_message_at` are written with exactly the
 *   same instant rather than two values a few microseconds apart.
 * - **Truncated to milliseconds.** `timestamptz` stores microseconds but a
 *   JavaScript `Date` cannot hold them, so an untruncated value would lose
 *   precision the moment the ORM converted it — and a keyset cursor built from
 *   the truncated value would silently skip every row in the sub-millisecond
 *   window it rounded past. Writing millisecond precision keeps the stored
 *   value exactly representable, so cursors round-trip losslessly.
 */
export async function dbNow(em: EntityManager): Promise<Date> {
  const row = await sql<{ now: Date }>`select date_trunc('milliseconds', now()) as now`.execute(
    em.getKysely(),
  )
  const value = row.rows[0]?.now
  // The query cannot legitimately return nothing; falling back to the local
  // clock keeps a send working rather than failing on an impossible branch.
  return value instanceof Date ? value : new Date(value ?? Date.now())
}
