import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Does Matrix have everything Postgres has?
 *
 * This is the question the shadow phase exists to answer, and it is answered
 * entirely from the database — no homeserver round trip. That is deliberate:
 * the failure being hunted is a publish that failed and was swallowed, and a
 * swallowed publish leaves no `chat_matrix_events` row. Asking Postgres finds
 * every instance, cheaply, without depending on the homeserver being reachable.
 *
 * The distinction that makes the number meaningful is **before** versus
 * **after** the room existed. A message written before its room was provisioned
 * is not drift — it is backfill that has not run. Counting the two together
 * would make an untouched deployment look permanently broken and hide the one
 * number worth watching.
 */

export type DriftScope = {
  tenantId?: string
  organizationId?: string
}

export type RoomStates = {
  ready: number
  pending: number
  failed: number
}

export type DriftSample = {
  conversationId: string
  messageId: string
  createdAt: Date
}

export type DriftReport = {
  rooms: RoomStates
  /** Conversations with messages but no room row at all. */
  conversationsWithoutRoom: number
  /** User messages in conversations that have a room, written after it existed. */
  messagesInScope: number
  /** Of those, how many reached the homeserver. */
  messagesPublished: number
  /**
   * Of those, how many did not. **This is the number that must be zero.**
   * Anything here is a publish that failed and was swallowed.
   */
  messagesDrifted: number
  /** Written before their room existed — backfill scope, not drift. */
  messagesAwaitingBackfill: number
  oldestDriftedAt: Date | null
  samples: DriftSample[]
  healthy: boolean
}

/**
 * Placeholders are `?`, not `$n`.
 *
 * `em.getConnection().execute()` binds through Knex, which uses positional `?`.
 * A `$1` reaches Postgres as a literal it has no parameter for — "there is no
 * parameter $1" — and only on the paths that actually bind something, so an
 * unscoped call looks fine while `--tenant` fails. Found by running the CLI
 * against a real database.
 */
function scopeClause(scope: DriftScope, alias: string, params: unknown[]): string {
  const parts: string[] = []
  if (scope.tenantId) {
    params.push(scope.tenantId)
    parts.push(`${alias}.tenant_id = ?`)
  }
  if (scope.organizationId) {
    params.push(scope.organizationId)
    parts.push(`${alias}.organization_id = ?`)
  }
  return parts.length ? ` and ${parts.join(' and ')}` : ''
}

export async function checkDrift(
  em: EntityManager,
  scope: DriftScope = {},
  options: { sampleLimit?: number } = {},
): Promise<DriftReport> {
  const connection = em.getConnection()
  const sampleLimit = Math.min(Math.max(options.sampleLimit ?? 10, 0), 100)

  const roomParams: unknown[] = []
  const roomRows = await connection.execute<Array<{ state: string; count: string }>>(
    `select state, count(*)::text as count
       from chat_matrix_rooms r
      where true${scopeClause(scope, 'r', roomParams)}
      group by state`,
    roomParams,
  )
  const rooms: RoomStates = { ready: 0, pending: 0, failed: 0 }
  for (const row of roomRows) {
    if (row.state === 'ready' || row.state === 'pending' || row.state === 'failed') {
      rooms[row.state] = Number(row.count)
    }
  }

  const orphanParams: unknown[] = []
  const [orphans] = await connection.execute<Array<{ count: string }>>(
    `select count(distinct c.id)::text as count
       from chat_conversations c
      where c.deleted_at is null
        and not exists (select 1 from chat_matrix_rooms r where r.conversation_id = c.id)
        and exists (select 1 from chat_messages m where m.conversation_id = c.id and m.kind = 'user')
        ${scopeClause(scope, 'c', orphanParams)}`,
    orphanParams,
  )

  // One pass over the messages that have a room, split on whether the message
  // predates the room. `m.created_at >= r.created_at` is the whole distinction
  // between "we failed to publish" and "we have not backfilled".
  const driftParams: unknown[] = []
  const [totals] = await connection.execute<
    Array<{ in_scope: string; published: string; drifted: string; awaiting: string; oldest: Date | null }>
  >(
    `select
        count(*) filter (where m.created_at >= r.created_at)::text as in_scope,
        count(*) filter (where m.created_at >= r.created_at and e.id is not null)::text as published,
        count(*) filter (where m.created_at >= r.created_at and e.id is null)::text as drifted,
        count(*) filter (where m.created_at < r.created_at and e.id is null)::text as awaiting,
        min(m.created_at) filter (where m.created_at >= r.created_at and e.id is null) as oldest
       from chat_messages m
       join chat_matrix_rooms r on r.conversation_id = m.conversation_id
       left join chat_matrix_events e on e.message_id = m.id
      where m.kind = 'user'
        and m.deleted_at is null
        ${scopeClause(scope, 'm', driftParams)}`,
    driftParams,
  )

  const messagesDrifted = Number(totals?.drifted ?? 0)

  let samples: DriftSample[] = []
  if (messagesDrifted > 0 && sampleLimit > 0) {
    const sampleParams: unknown[] = []
    const scoped = scopeClause(scope, 'm', sampleParams)
    sampleParams.push(sampleLimit)
    const rows = await connection.execute<
      Array<{ conversation_id: string; id: string; created_at: Date }>
    >(
      `select m.conversation_id, m.id, m.created_at
         from chat_messages m
         join chat_matrix_rooms r on r.conversation_id = m.conversation_id
         left join chat_matrix_events e on e.message_id = m.id
        where m.kind = 'user'
          and m.deleted_at is null
          and m.created_at >= r.created_at
          and e.id is null
          ${scoped}
        order by m.created_at asc
        limit ?`,
      sampleParams,
    )
    samples = rows.map((row) => ({
      conversationId: row.conversation_id,
      messageId: row.id,
      createdAt: row.created_at,
    }))
  }

  return {
    rooms,
    conversationsWithoutRoom: Number(orphans?.count ?? 0),
    messagesInScope: Number(totals?.in_scope ?? 0),
    messagesPublished: Number(totals?.published ?? 0),
    messagesDrifted,
    messagesAwaitingBackfill: Number(totals?.awaiting ?? 0),
    oldestDriftedAt: totals?.oldest ?? null,
    samples,
    // A failed room is a conversation whose messages are silently going nowhere,
    // so it counts against health just as a drifted message does.
    healthy: messagesDrifted === 0 && rooms.failed === 0,
  }
}

/** One line, for a log or a cron mail. */
export function formatDriftReport(report: DriftReport): string {
  return [
    report.healthy ? 'healthy' : 'DRIFT',
    `rooms ready=${report.rooms.ready} pending=${report.rooms.pending} failed=${report.rooms.failed}`,
    `messages published=${report.messagesPublished}/${report.messagesInScope}`,
    `drifted=${report.messagesDrifted}`,
    `awaitingBackfill=${report.messagesAwaitingBackfill}`,
    `conversationsWithoutRoom=${report.conversationsWithoutRoom}`,
  ].join(' · ')
}
