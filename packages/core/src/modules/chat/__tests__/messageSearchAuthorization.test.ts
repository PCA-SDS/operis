import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import {
  countMessages,
  decodeSearchCursor,
  encodeSearchCursor,
  searchMessages,
} from '../lib/messageSearch'
import { parseSearchQuery } from '../lib/searchQuery'

/**
 * Authorization and tenancy, asserted against the SQL that actually runs.
 *
 * These read the compiled statement rather than the results because the property
 * under test is structural: a message the caller cannot read must never be a
 * candidate. Asserting on returned rows would pass just as happily if the scope
 * were applied afterwards in TypeScript — which is the bug this guards against,
 * since a filter applied to results still lets a count, a snippet or a
 * pagination cursor reveal that the message exists.
 */

type Captured = { sql: string; parameters: readonly unknown[] }

function recordingEntityManager() {
  const statements: Captured[] = []
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      statements.push({ sql: event.query.sql, parameters: event.query.parameters })
    },
  })
  const em = { getKysely: () => db } as unknown as EntityManager
  return { em, statements }
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const userId = 'user-1'

/** The one statement that reads messages, ignoring any `set local` around it. */
function messageStatement(statements: Captured[]): Captured {
  const found = statements.find((statement) => statement.sql.includes('chat_messages'))
  if (!found) throw new Error('[internal] no statement touched chat_messages')
  return found
}

describe('search authorization', () => {
  it('joins participation rather than filtering results, in every scope', async () => {
    for (const conversationId of [undefined, 'conversation-1']) {
      const { em, statements } = recordingEntityManager()
      await searchMessages({
        em,
        scope,
        userId,
        parsed: parseSearchQuery('quarterly report'),
        conversationId,
        limit: 20,
        trigramAvailable: false,
      })

      const { sql, parameters } = messageStatement(statements)
      expect(sql).toContain('inner join "chat_participants"')
      // Not a left join: a left join would keep messages with no participant row
      // and leave the scoping to whatever ran next.
      expect(sql).not.toContain('left join "chat_participants"')
      expect(parameters).toContain(userId)
      expect(parameters).toContain(scope.tenantId)
      expect(parameters).toContain(scope.organizationId)
    }
  })

  it('scopes the participant row itself, not only the message', async () => {
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      limit: 20,
      trigramAvailable: false,
    })

    // A membership row carries its own tenant and organization. Matching only
    // the message's scope would let a stale participant row from another
    // organization authorize a read.
    const { sql } = messageStatement(statements)
    const joinClause = sql.slice(
      sql.indexOf('inner join "chat_participants"'),
      sql.indexOf('inner join "chat_conversations"'),
    )
    expect(joinClause).toContain('"user_id"')
    expect(joinClause).toContain('"tenant_id"')
    expect(joinClause).toContain('"organization_id"')
  })

  it('counts through the same join, so a count cannot reveal a hidden message', async () => {
    const { em, statements } = recordingEntityManager()
    await countMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      cap: 100,
      trigramAvailable: false,
    })

    const { sql, parameters } = messageStatement(statements)
    expect(sql).toContain('inner join "chat_participants"')
    expect(parameters).toContain(userId)
    expect(parameters).toContain(scope.tenantId)
    expect(parameters).toContain(scope.organizationId)
  })

  it('never widens scope when a conversation id is supplied', async () => {
    // Naming a conversation narrows; it must not stand in for membership. A
    // reader who knows an id they do not belong to gets nothing.
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      conversationId: 'someone-elses-conversation',
      limit: 20,
      trigramAvailable: false,
    })

    const { sql, parameters } = messageStatement(statements)
    expect(sql).toContain('inner join "chat_participants"')
    expect(parameters).toContain('someone-elses-conversation')
    expect(parameters).toContain(userId)
  })

  it('excludes deleted messages and deleted conversations', async () => {
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      limit: 20,
      trigramAvailable: false,
    })

    const { sql } = messageStatement(statements)
    expect(sql).toContain('"deleted_at" is null')
    // Both of them: a live message inside a deleted conversation is still gone.
    expect(sql.match(/"deleted_at" is null/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('searches only real messages, so system rows never surface', async () => {
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('added'),
      limit: 20,
      trigramAvailable: false,
    })

    const { parameters } = messageStatement(statements)
    expect(parameters).toContain('user')
  })

  it('asks the database nothing when the query carries no searchable term', async () => {
    const { em, statements } = recordingEntityManager()
    const hits = await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('   '),
      limit: 20,
      trigramAvailable: false,
    })

    expect(hits).toEqual([])
    expect(statements).toHaveLength(0)
  })
})

describe('fuzzy matching', () => {
  it('is left out entirely when the deployment has no trigram support', async () => {
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('quarterly'),
      limit: 20,
      trigramAvailable: false,
    })

    const { sql } = messageStatement(statements)
    expect(sql).not.toContain('word_similarity')
    expect(sql).not.toContain('<%')
  })

  it('joins the candidate predicate, not just the score, when available', async () => {
    // The bug this pins: as a scoring term alone, fuzzy could only reorder rows
    // that already matched exactly, so a misspelling — the only thing it exists
    // for — still found nothing.
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('quarterly'),
      limit: 20,
      trigramAvailable: true,
    })

    const { sql } = messageStatement(statements)
    const whereClause = sql.slice(sql.indexOf('where'), sql.indexOf('order by'))
    expect(whereClause).toContain('<<%')
    expect(sql).toContain('strict_word_similarity')
  })

  it('matches whole words only, never a run straddling two of them', async () => {
    // The loose operator scored `cois` at 0.400 against a message about a
    // contract on Thursday, by matching the middles of two words — a result no
    // reader could be shown a reason for. The strict operator pins the extent
    // to word boundaries and drops that same pair to 0.167.
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('quarterly'),
      limit: 20,
      trigramAvailable: true,
    })

    const { sql } = messageStatement(statements)
    expect(sql).not.toMatch(/[^<]<%/)
    expect(sql).not.toMatch(/[^_]word_similarity/)
  })

  it('pins the threshold per transaction rather than trusting the server default', async () => {
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('quarterly'),
      limit: 20,
      trigramAvailable: true,
    })

    // `set local`, so it expires with the transaction and cannot leak into the
    // next borrower of a pooled connection.
    const threshold = statements.find((statement) => statement.sql.includes('set local'))
    expect(threshold?.sql).toContain('pg_trgm.strict_word_similarity_threshold')
  })
})

describe('filters and ranking', () => {
  it('applies the pinned filter to the count as well as the results', async () => {
    // These were two hand-written copies and had already drifted: pinned
    // narrowed the rows but not the total, so a pinned search showed a handful
    // of results under a count of everything.
    const search = recordingEntityManager()
    await searchMessages({
      em: search.em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      filters: { pinnedOnly: true },
      limit: 20,
      trigramAvailable: false,
    })

    const count = recordingEntityManager()
    await countMessages({
      em: count.em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      filters: { pinnedOnly: true },
      cap: 100,
      trigramAvailable: false,
    })

    expect(messageStatement(search.statements).sql).toContain('chat_pinned_messages')
    expect(messageStatement(count.statements).sql).toContain('chat_pinned_messages')
  })

  it('applies every other filter to both as well', async () => {
    const after = new Date('2026-01-01T00:00:00.000Z')
    const before = new Date('2026-02-01T00:00:00.000Z')
    const filters = { senderUserIds: ['11111111-1111-1111-1111-111111111111'], after, before }

    const search = recordingEntityManager()
    await searchMessages({
      em: search.em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      filters,
      limit: 20,
      trigramAvailable: false,
    })
    const count = recordingEntityManager()
    await countMessages({
      em: count.em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      filters,
      cap: 100,
      trigramAvailable: false,
    })

    for (const captured of [messageStatement(search.statements), messageStatement(count.statements)]) {
      expect(captured.sql).toContain('m.sender_user_id')
      expect(captured.parameters).toContain(after)
      expect(captured.parameters).toContain(before)
    }
  })

  it('neutralises LIKE wildcards in a quoted phrase', async () => {
    // `%` and `_` mean something to LIKE. Unescaped, a search for "50%" would
    // quietly match far more than it should rather than failing loudly.
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('"50%_done"'),
      limit: 20,
      trigramAvailable: false,
    })

    const { parameters } = messageStatement(statements)
    const likePattern = parameters.find(
      (parameter) => typeof parameter === 'string' && parameter.includes('50'),
    )
    expect(likePattern).toBe('%50\\%\\_done%')
  })

  it('scores a whole-word match above one that merely starts the same way', async () => {
    // The prefixed query matches `deployment` for a search of `deploy`; without
    // a separate signal the two rank identically.
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('deploy'),
      limit: 20,
      trigramAvailable: false,
    })

    const { parameters } = messageStatement(statements)
    expect(parameters).toContain('deploy:*')
    expect(parameters).toContain('deploy')
  })
})

describe('keyset pagination', () => {
  it('scores against a fixed instant rather than the wall clock', async () => {
    // Recency is part of the score. Read from `now()`, every row drifts a little
    // lower between requests, so the row the cursor stopped at scores below its
    // own recorded value and satisfies the keyset again — paging a twelve-result
    // search returned twenty-two rows.
    const { em, statements } = recordingEntityManager()
    const searchedAt = new Date('2026-09-06T12:00:00.000Z')
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      limit: 20,
      trigramAvailable: false,
      searchedAt,
    })

    const { sql, parameters } = messageStatement(statements)
    expect(sql).not.toContain('now()')
    expect(parameters).toContain(searchedAt)
  })

  it('rounds the score so it survives the round trip through the cursor', async () => {
    // The cursor carries the score as JSON and compares it back in SQL. A
    // full-width float does not make that trip identically, and a comparison
    // that misses by one bit repeats or skips a row.
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      limit: 20,
      trigramAvailable: false,
    })

    expect(messageStatement(statements).sql).toContain('round(')
  })

  it('carries the instant through the cursor so later pages inherit it', () => {
    const cursor = { score: 1234.5, messageId: '11111111-1111-1111-1111-111111111111', at: 1_757_000_000_000 }
    const decoded = decodeSearchCursor(encodeSearchCursor(cursor))
    expect(decoded).toEqual(cursor)
  })

  it('treats a malformed cursor as the beginning rather than an error', () => {
    // A stale bookmark the reader cannot regenerate should not become a failure.
    expect(decodeSearchCursor('not-base64!!')).toBeNull()
    expect(decodeSearchCursor(undefined)).toBeNull()
  })

  it('compares both sides of the keyset as the same type', async () => {
    const { em, statements } = recordingEntityManager()
    await searchMessages({
      em,
      scope,
      userId,
      parsed: parseSearchQuery('budget'),
      limit: 20,
      trigramAvailable: false,
      cursor: { score: 1600, messageId: '11111111-1111-1111-1111-111111111111', at: Date.now() },
    })

    const { sql } = messageStatement(statements)
    expect(sql).toContain('::numeric')
    expect(sql).toContain('::uuid')
  })
})
