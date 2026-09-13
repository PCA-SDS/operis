import type { EntityManager } from '@mikro-orm/postgresql'
import { checkDrift, formatDriftReport, type DriftReport } from '../lib/drift'

type Query = { sql: string; params: unknown[] }

/**
 * A connection that records what it was asked and answers from a script. The
 * point is not to re-test Postgres — it is to pin the two things that are this
 * module's own: how the scope is bound, and how the numbers become a verdict.
 */
function fakeEm(rows: unknown[][]): { em: EntityManager; queries: Query[] } {
  const queries: Query[] = []
  let index = 0
  const connection = {
    async execute(sql: string, params: unknown[] = []) {
      queries.push({ sql, params })
      return rows[index++] ?? []
    },
  }
  return { em: { getConnection: () => connection } as unknown as EntityManager, queries }
}

const totals = (over: Partial<Record<string, unknown>> = {}) => [
  {
    in_scope: '10',
    published: '10',
    drifted: '0',
    awaiting: '0',
    oldest: null,
    ...over,
  },
]

describe('checkDrift', () => {
  it('binds the scope as parameters, never as interpolated SQL', async () => {
    // The scope reaches here from a CLI flag. Interpolating it would be an
    // injection point in an operator tool that runs with full database access.
    const { em, queries } = fakeEm([[{ state: 'ready', count: '3' }], [{ count: '0' }], totals()])
    await checkDrift(em, { tenantId: "'; drop table chat_messages; --" })

    for (const query of queries) {
      expect(query.sql).not.toContain('drop table')
    }
    expect(queries.some((q) => q.params.includes("'; drop table chat_messages; --"))).toBe(true)
  })

  it('omits scope predicates entirely when unscoped', async () => {
    const { em, queries } = fakeEm([[], [{ count: '0' }], totals()])
    await checkDrift(em)
    expect(queries.every((query) => query.params.length === 0)).toBe(true)
  })

  it('reports healthy when nothing drifted and no room failed', async () => {
    const { em } = fakeEm([[{ state: 'ready', count: '5' }], [{ count: '0' }], totals()])
    const report = await checkDrift(em)

    expect(report.healthy).toBe(true)
    expect(report.rooms.ready).toBe(5)
    expect(report.messagesPublished).toBe(10)
    expect(report.messagesDrifted).toBe(0)
  })

  it('reports unhealthy when a message never reached the homeserver', async () => {
    const { em } = fakeEm([
      [{ state: 'ready', count: '5' }],
      [{ count: '0' }],
      totals({ published: '8', drifted: '2', oldest: new Date('2026-09-10T09:00:00Z') }),
      [{ conversation_id: 'c1', id: 'm1', created_at: new Date('2026-09-10T09:00:00Z') }],
    ])
    const report = await checkDrift(em)

    expect(report.healthy).toBe(false)
    expect(report.messagesDrifted).toBe(2)
    expect(report.oldestDriftedAt).toEqual(new Date('2026-09-10T09:00:00Z'))
    expect(report.samples).toEqual([
      { conversationId: 'c1', messageId: 'm1', createdAt: new Date('2026-09-10T09:00:00Z') },
    ])
  })

  it('counts a failed room against health even with no drifted messages', async () => {
    // A failed room is a conversation whose messages are silently going nowhere.
    const { em } = fakeEm([
      [
        { state: 'ready', count: '4' },
        { state: 'failed', count: '1' },
      ],
      [{ count: '0' }],
      totals(),
    ])
    const report = await checkDrift(em)

    expect(report.rooms.failed).toBe(1)
    expect(report.healthy).toBe(false)
  })

  it('does not count un-backfilled history as drift', async () => {
    // The distinction that makes the number meaningful: a message written
    // before its room existed is backfill scope, not a failed publish.
    const { em } = fakeEm([
      [{ state: 'ready', count: '2' }],
      [{ count: '0' }],
      totals({ awaiting: '4000' }),
    ])
    const report = await checkDrift(em)

    expect(report.messagesAwaitingBackfill).toBe(4000)
    expect(report.messagesDrifted).toBe(0)
    expect(report.healthy).toBe(true)
  })

  it('skips the sample query when there is nothing drifted', async () => {
    const { em, queries } = fakeEm([[], [{ count: '0' }], totals()])
    await checkDrift(em)
    // rooms + orphans + totals, and no fourth.
    expect(queries).toHaveLength(3)
  })

  it('clamps the sample limit', async () => {
    const { em, queries } = fakeEm([
      [],
      [{ count: '0' }],
      totals({ drifted: '9999' }),
      [],
    ])
    await checkDrift(em, {}, { sampleLimit: 5000 })
    expect(queries[3].params.at(-1)).toBe(100)
  })
})

describe('formatDriftReport', () => {
  const base: DriftReport = {
    rooms: { ready: 3, pending: 0, failed: 0 },
    conversationsWithoutRoom: 0,
    messagesInScope: 10,
    messagesPublished: 10,
    messagesDrifted: 0,
    messagesAwaitingBackfill: 0,
    oldestDriftedAt: null,
    samples: [],
    healthy: true,
  }

  it('leads with the verdict', () => {
    expect(formatDriftReport(base)).toMatch(/^healthy/)
    expect(formatDriftReport({ ...base, healthy: false, messagesDrifted: 2 })).toMatch(/^DRIFT/)
  })

  it('shows published against the total in scope', () => {
    expect(formatDriftReport(base)).toContain('published=10/10')
  })
})
