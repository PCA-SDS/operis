import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely'
import { SEARCH_LIMITS, SEARCH_WEIGHTS, buildTsQuery, type ParsedQuery } from './searchQuery'
import type { ChatScope } from './scope'

/**
 * Finding messages, in one conversation or across every conversation the
 * caller can read.
 *
 * The two scopes are one query with one extra predicate, deliberately. They
 * rank identically because a result is a result -- splitting them would let the
 * two drift until the same message ranked differently depending on where it was
 * searched from, which is the kind of difference nobody can explain.
 *
 * Authorization is part of the query, never a filter applied to its output. The
 * participant join is also what makes it fast: it narrows to the handful of
 * conversations the caller belongs to before any text matching happens, so
 * enforcing access costs less than skipping it would.
 */

type SearchDatabase = {
  chat_messages: {
    id: string
    conversation_id: string
    sender_user_id: string
    tenant_id: string
    organization_id: string
    body: string
    search_body: string | null
    kind: string
    created_at: Date
    deleted_at: Date | null
  }
  chat_participants: {
    conversation_id: string
    user_id: string
    tenant_id: string
    organization_id: string
  }
  chat_conversations: {
    id: string
    title: string | null
    kind: string
    deleted_at: Date | null
  }
}

export type MessageSearchHit = {
  messageId: string
  conversationId: string
  conversationTitle: string | null
  conversationKind: string
  senderUserId: string
  body: string
  createdAt: Date
  score: number
}

export type MessageSearchFilters = {
  /** Canonical user ids, never display names — two people may share a name. */
  senderUserIds?: string[]
  /** Inclusive lower bound on `created_at`. */
  after?: Date
  /** Exclusive upper bound on `created_at`. */
  before?: Date
  /** Restrict to messages that were pinned. */
  pinnedOnly?: boolean
}

export type MessageSearchInput = {
  em: EntityManager
  scope: ChatScope
  userId: string
  parsed: ParsedQuery
  /** Absent means every conversation the caller participates in. */
  conversationId?: string
  filters?: MessageSearchFilters
  limit: number
  /** Opaque; produced by `encodeSearchCursor`. */
  cursor?: SearchCursor | null
  /** Whether the deployment has `pg_trgm`, so fuzzy can be skipped when absent. */
  trigramAvailable: boolean
  /**
   * The instant to score recency against.
   *
   * Supplied by the caller rather than read from the clock here, because the
   * caller is also the one that mints the next cursor and the two have to agree
   * exactly. Defaults to now for a first page.
   */
  searchedAt?: Date
}

/**
 * Where the previous page stopped.
 *
 * Score first, then the message id. Ordering by score alone is not stable when
 * several messages score identically -- and they will, because the weights are
 * coarse by design -- so the id breaks the tie and guarantees a message appears
 * on exactly one page.
 */
export type SearchCursor = {
  score: number
  messageId: string
  /**
   * When the first page of this search was scored, as epoch milliseconds.
   *
   * Carried so every later page scores against the same instant. The score
   * includes a recency term, so reading it from the wall clock made every row
   * drift a little lower between requests -- and a row that had dropped below
   * the cursor's own recorded score satisfied the keyset again and came back a
   * second time. Paging a twelve-result search returned twenty-two rows.
   */
  at: number
}

export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(`${cursor.score}|${cursor.messageId}|${cursor.at}`, 'utf8').toString(
    'base64url',
  )
}

export function decodeSearchCursor(raw: string | undefined): SearchCursor | null {
  if (!raw) return null
  try {
    const [score, messageId, at] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
    if (!score || !messageId) return null
    const parsedScore = Number(score)
    const parsedAt = Number(at)
    if (!Number.isFinite(parsedScore)) return null
    // A cursor issued before the clock was pinned carries no instant; scoring it
    // against now is what the old behaviour did, and is still better than
    // refusing a bookmark the reader cannot regenerate.
    return { score: parsedScore, messageId, at: Number.isFinite(parsedAt) ? parsedAt : Date.now() }
  } catch {
    // A malformed cursor means "start from the beginning", matching how the
    // transcript's own cursor behaves. Refusing would turn a stale bookmark
    // into an error the reader cannot act on.
    return null
  }
}

/** Whether this database can serve the fuzzy branch. Asked once, then cached. */
let trigramSupport: boolean | null = null

export async function detectTrigramSupport(em: EntityManager): Promise<boolean> {
  if (trigramSupport !== null) return trigramSupport
  const rows = await sql<{ present: boolean }>`
    select exists (select 1 from pg_extension where extname = 'pg_trgm') as present
  `.execute(em.getKysely<SearchDatabase>())
  trigramSupport = rows.rows[0]?.present === true
  return trigramSupport
}

/** Exposed for tests; the real value is cached for the life of the process. */
export function resetTrigramSupport(): void {
  trigramSupport = null
}

type SearchExecutor = Kysely<SearchDatabase> | Transaction<SearchDatabase>

/**
 * The matching predicate, built once and used by both the search and the count.
 *
 * Exact and fuzzy are OR'd here rather than fuzzy living only in the score. A
 * misspelling produces no exact match at all, so a fuzzy signal that can only
 * re-rank exact matches never fires for the queries it exists to serve -- it
 * reorders results that were already found and rescues nothing.
 *
 * `<<%` compares the query against the best-matching run of *whole words* in a
 * message. Two weaker measures were tried first and both were wrong. Comparing
 * against the whole message scored 0.07-0.25 on ordinary text — under any
 * threshold that also rejects noise, so it could only ever score zero. Comparing
 * against any continuous run (`<%`) let a short query straddle the middles of
 * two words: `cois` scored 0.400 against a message about a contract on Thursday,
 * which is a match no reader could be shown a reason for. The strict operator
 * pins the extent to word boundaries and drops that same pair to 0.167.
 *
 * Both halves are indexable, and Postgres bitmap-ORs the two GIN indexes rather
 * than falling back to a scan.
 */
function matchesQuery(tsQuery: string, phrase: string, useFuzzy: boolean) {
  const exact = sql<boolean>`to_tsvector('simple', m.search_body) @@ to_tsquery('simple', ${tsQuery})`
  return useFuzzy ? sql<boolean>`(${exact} or ${phrase} <<% m.search_body)` : exact
}

/**
 * Run `work` with the fuzzy threshold pinned to ours.
 *
 * `SET LOCAL` expires with the transaction, so the value cannot leak into the
 * next borrower of a pooled connection. Setting it rather than inheriting the
 * server default is what stops two otherwise identical deployments from
 * answering the same query differently.
 *
 * The threshold itself is calibrated in `SEARCH_LIMITS`.
 */
async function withFuzzyThreshold<T>(
  db: Kysely<SearchDatabase>,
  useFuzzy: boolean,
  work: (executor: SearchExecutor) => Promise<T>,
): Promise<T> {
  if (!useFuzzy) return work(db)
  return db.transaction().execute(async (trx) => {
    await sql`set local pg_trgm.strict_word_similarity_threshold = ${sql.lit(
      SEARCH_LIMITS.fuzzyThreshold,
    )}`.execute(trx)
    return work(trx)
  })
}

/**
 * The phrase as a LIKE pattern, with LIKE's own wildcards neutralised.
 *
 * `%` and `_` mean something to LIKE, and a quoted search for `"50%"` or
 * `"read_me"` would otherwise match far more than it should — quietly, since a
 * wildcard produces extra results rather than an error.
 */
function containsPhrase(phrase: string) {
  const escaped = phrase.replace(/[\\%_]/g, (character) => `\\${character}`)
  return sql<boolean>`m.search_body like ${`%${escaped}%`}`
}

/**
 * The optional narrowing filters, as clauses both callers apply.
 *
 * Returned as expressions rather than applied to a builder, so one function can
 * serve two differently-shaped queries without casting either into the other's
 * type. As two hand-written copies they had already drifted: the pinned filter
 * reached the results but not the count, so asking for pinned matches returned
 * a handful of rows under a total that had counted everything.
 */
function filterClauses(filters?: MessageSearchFilters): RawBuilder<boolean>[] {
  const clauses: RawBuilder<boolean>[] = []
  if (filters?.senderUserIds?.length) {
    clauses.push(sql<boolean>`m.sender_user_id = any(${sql.val(filters.senderUserIds)}::uuid[])`)
  }
  if (filters?.after) clauses.push(sql<boolean>`m.created_at >= ${filters.after}`)
  if (filters?.before) clauses.push(sql<boolean>`m.created_at < ${filters.before}`)
  if (filters?.pinnedOnly) {
    clauses.push(sql<boolean>`exists (
      select 1 from chat_pinned_messages pin
      where pin.message_id = m.id and pin.conversation_id = m.conversation_id
    )`)
  }
  return clauses
}

/**
 * Run a search.
 *
 * The score is assembled from independent signals rather than from one measure,
 * because no single measure ranks all of exact, phrase, prefix and typo
 * sensibly. Each signal is separated from the next by an order of magnitude, so
 * a pile of weak matches can never overtake one strong one.
 */
export async function searchMessages(input: MessageSearchInput): Promise<MessageSearchHit[]> {
  const { em, scope, userId, parsed, conversationId, filters, cursor } = input
  const limit = Math.min(Math.max(input.limit, 1), SEARCH_LIMITS.maxPageSize)

  const tsQuery = buildTsQuery(parsed, true)
  if (!tsQuery) return []
  // The same query without the trailing `:*`, used only to tell a whole-word
  // match apart from one that merely starts the same way.
  const exactTsQuery = buildTsQuery(parsed, false)

  // The phrase used for the contiguous-match signal. Falls back to the raw
  // query so an unquoted multi-word search still rewards adjacency.
  const phrase = parsed.phrases[0] ?? parsed.terms.join(' ')
  const useFuzzy = input.trigramAvailable && parsed.allowFuzzy
  // The first page fixes the instant; later pages inherit it from the cursor.
  const searchedAt = input.searchedAt ?? new Date(cursor?.at ?? Date.now())

  return withFuzzyThreshold(em.getKysely<SearchDatabase>(), useFuzzy, async (db) => {
    let query = db
      .selectFrom('chat_messages as m')
      // Authorization, expressed as a join rather than as a filter on the
      // results. A message the caller cannot read is never a candidate, so it
      // cannot leak through a count, a snippet or an off-by-one in pagination.
      .innerJoin('chat_participants as p', (join) =>
        join
          .onRef('p.conversation_id', '=', 'm.conversation_id')
          .on('p.user_id', '=', userId)
          .on('p.tenant_id', '=', scope.tenantId)
          .on('p.organization_id', '=', scope.organizationId),
      )
      .innerJoin('chat_conversations as c', (join) =>
        join.onRef('c.id', '=', 'm.conversation_id').on('c.deleted_at', 'is', null),
      )
      .where('m.tenant_id', '=', scope.tenantId)
      .where('m.organization_id', '=', scope.organizationId)
      // Matches the partial indexes, so the planner can use them.
      .where('m.kind', '=', 'user')
      .where('m.deleted_at', 'is', null)
      .where('m.search_body', 'is not', null)
      .where(matchesQuery(tsQuery, phrase, useFuzzy))

    if (conversationId) query = query.where('m.conversation_id', '=', conversationId)
    for (const clause of filterClauses(filters)) query = query.where(clause)

    // Assembled once so the ORDER BY and the cursor compare the same expression;
    // computing it twice invites them to disagree by a rounding step.
    const score = sql<number>`round(((
      (case when ${containsPhrase(phrase)} then ${SEARCH_WEIGHTS.exactPhrase} else 0 end)
    + (case when to_tsvector('simple', m.search_body) @@ to_tsquery('simple', ${tsQuery})
            then ${SEARCH_WEIGHTS.allTermsPresent} else 0 end)
    ${
      // Whole words outrank words merely begun. Without this a search for
      // `deploy` ranks `deployment` exactly level with `deploy`, because the
      // prefixed query matches both and nothing downstream tells them apart.
      exactTsQuery
        ? sql`+ (case when to_tsvector('simple', m.search_body) @@ to_tsquery('simple', ${exactTsQuery})
                      then ${SEARCH_WEIGHTS.prefix} else 0 end)`
        : sql``
    }
    + ts_rank_cd(to_tsvector('simple', m.search_body), to_tsquery('simple', ${tsQuery}))
      * ${SEARCH_WEIGHTS.textRank}
    ${
      useFuzzy
        ? sql`+ (case when ${phrase} <<% m.search_body
                      then strict_word_similarity(${phrase}, m.search_body)
                           * ${SEARCH_WEIGHTS.fuzzy}
                      else 0 end)`
        : sql``
    }
    + ${SEARCH_WEIGHTS.recency}
      / (1 + extract(epoch from (${searchedAt}::timestamptz - m.created_at)) / 2592000)
  ))::numeric, 6)`

    let scored = query.select([
      'm.id as messageId',
      'm.conversation_id as conversationId',
      'm.sender_user_id as senderUserId',
      'm.body as body',
      'm.created_at as createdAt',
      'c.title as conversationTitle',
      'c.kind as conversationKind',
      score.as('score'),
    ])

    // Keyset, not offset. An offset re-reads and discards every earlier row, so
    // deep pages get linearly slower; this reads only what it returns.
    if (cursor) {
      scored = scored.where(
        sql<boolean>`(${score}, m.id) < (${cursor.score}::numeric, ${cursor.messageId}::uuid)`,
      )
    }

    const rows = await scored
      .orderBy('score', 'desc')
      .orderBy('m.id', 'desc')
      .limit(limit)
      .execute()

    return rows.map((row) => ({
      messageId: row.messageId,
      conversationId: row.conversationId,
      conversationTitle: row.conversationTitle,
      conversationKind: row.conversationKind,
      senderUserId: row.senderUserId,
      body: row.body,
      // Coerced, not trusted. The raw driver hands timestamps back as strings
      // even where the column type says otherwise, so constructing the Date here
      // is what keeps every caller from having to know that.
      createdAt: new Date(row.createdAt),
      score: Number(row.score),
    }))
  })
}

/**
 * How many messages match, capped.
 *
 * Capped because the exact total of a broad query costs a full scan of the
 * match set to produce a number nobody acts on. The cap is reported honestly as
 * "at least N", which is more useful than a precise count the reader waited
 * for.
 *
 * The same authorization join as the search itself: a count that included
 * messages the caller cannot read would leak their existence, which is the
 * subtler half of §93.
 */
export async function countMessages(
  input: Omit<MessageSearchInput, 'limit' | 'cursor'> & { cap: number },
): Promise<{ total: number; capped: boolean }> {
  const { em, scope, userId, parsed, conversationId, filters, cap } = input
  const tsQuery = buildTsQuery(parsed, true)
  if (!tsQuery) return { total: 0, capped: false }

  // The same phrase and the same fuzzy decision as the search itself. A count
  // built from a narrower predicate would report fewer matches than the list
  // below it shows, which reads as a bug in the count rather than in the query.
  const phrase = parsed.phrases[0] ?? parsed.terms.join(' ')
  const useFuzzy = input.trigramAvailable && parsed.allowFuzzy

  return withFuzzyThreshold(em.getKysely<SearchDatabase>(), useFuzzy, async (db) => {
    let inner = db
      .selectFrom('chat_messages as m')
      .innerJoin('chat_participants as p', (join) =>
        join
          .onRef('p.conversation_id', '=', 'm.conversation_id')
          .on('p.user_id', '=', userId)
          .on('p.tenant_id', '=', scope.tenantId)
          .on('p.organization_id', '=', scope.organizationId),
      )
      .innerJoin('chat_conversations as c', (join) =>
        join.onRef('c.id', '=', 'm.conversation_id').on('c.deleted_at', 'is', null),
      )
      .select('m.id')
      .where('m.tenant_id', '=', scope.tenantId)
      .where('m.organization_id', '=', scope.organizationId)
      .where('m.kind', '=', 'user')
      .where('m.deleted_at', 'is', null)
      .where('m.search_body', 'is not', null)
      .where(matchesQuery(tsQuery, phrase, useFuzzy))
      .limit(cap + 1)

    if (conversationId) inner = inner.where('m.conversation_id', '=', conversationId)
    for (const clause of filterClauses(filters)) inner = inner.where(clause)

    const rows = await inner.execute()
    return { total: Math.min(rows.length, cap), capped: rows.length > cap }
  })
}
