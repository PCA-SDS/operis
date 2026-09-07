import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildSearchDocument } from './lib/searchText'

const logger = createLogger('chat').child({ component: 'cli' })

/** How many rows one pass reads. Small enough that a batch never holds a lock long. */
const DEFAULT_BATCH_SIZE = 500

type BackfillDatabase = {
  chat_messages: {
    id: string
    body: string
    search_body: string | null
    kind: string
    deleted_at: Date | null
  }
}

function parseArgs(rest: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (!rawKey) continue
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[rawKey] = next
      index += 1
      continue
    }
    args[rawKey] = true
  }
  return args
}

/**
 * Fill `search_body` for messages that predate it, or that were written by an
 * older version of the fold.
 *
 * Resumable by construction rather than by bookkeeping: the work queue *is*
 * the set of rows where `search_body is null`, so a run that dies halfway
 * simply has less to do next time and no state to reconcile. Re-running it is
 * therefore idempotent, and running it twice concurrently is safe -- the second
 * process finds fewer rows, never the same ones twice.
 *
 * Batched with an explicit id keyset rather than `OFFSET`, so cost per batch is
 * constant however far in it gets, and no batch holds a lock on the table long
 * enough to interrupt a conversation.
 *
 * `--rebuild` recomputes every row instead of only the empty ones, which is
 * what a change to the fold requires: the normalisation rules are the index
 * format, so changing them means the existing values are the previous format.
 */
async function backfillSearch(rest: string[]): Promise<void> {
  const args = parseArgs(rest)
  const batchSize = Math.max(1, Number(args.batch ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE)
  const rebuild = args.rebuild === true || args.rebuild === 'true'
  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true'

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const db = em.getKysely<BackfillDatabase>()

  const pending = await db
    .selectFrom('chat_messages')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('kind', '=', 'user')
    .where('deleted_at', 'is', null)
    .$if(!rebuild, (query) => query.where('search_body', 'is', null))
    .executeTakeFirst()

  const total = Number(pending?.count ?? 0)
  process.stdout.write(
    `${rebuild ? 'Rebuilding' : 'Backfilling'} search text for ${total} message(s)` +
      `${dryRun ? ' (dry run)' : ''}\n`,
  )
  if (total === 0 || dryRun) return

  let lastId: string | null = null
  let done = 0
  let failed = 0

  for (;;) {
    let batch = db
      .selectFrom('chat_messages')
      .select(['id', 'body'])
      .where('kind', '=', 'user')
      .where('deleted_at', 'is', null)
      .orderBy('id', 'asc')
      .limit(batchSize)

    if (!rebuild) batch = batch.where('search_body', 'is', null)
    // The keyset is only needed for a rebuild: without it, a rebuild would
    // re-read the rows it just wrote forever, because they still match.
    if (rebuild && lastId) batch = batch.where('id', '>', lastId)

    const rows = await batch.execute()
    if (rows.length === 0) break

    for (const row of rows) {
      try {
        await db
          .updateTable('chat_messages')
          .set({ search_body: buildSearchDocument(row.body) })
          .where('id', '=', row.id)
          .execute()
        done += 1
      } catch (error) {
        // One unwritable row must not end the run. It stays null, so the next
        // pass picks it up rather than it being silently skipped forever.
        failed += 1
        logger.warn('Could not write search text for a message', {
          messageId: row.id,
          errorName: error instanceof Error ? error.name : 'unknown',
        })
      }
    }

    lastId = rows[rows.length - 1]!.id
    process.stdout.write(`  ${done}/${total}\n`)
  }

  process.stdout.write(`Done. ${done} written${failed > 0 ? `, ${failed} failed` : ''}.\n`)
  if (failed > 0) process.exitCode = 1
}

/** Report how much of the corpus is searchable, without changing anything. */
async function searchStatus(): Promise<void> {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const db = em.getKysely<BackfillDatabase>()

  const counts = await db
    .selectFrom('chat_messages')
    .select(({ fn, eb }) => [
      fn.countAll<string>().as('total'),
      fn
        .count<string>(eb.case().when('search_body', 'is not', null).then(1).end())
        .as('indexed'),
    ])
    .where('kind', '=', 'user')
    .where('deleted_at', 'is', null)
    .executeTakeFirst()

  const extension = await sql<{ present: boolean }>`
    select exists (select 1 from pg_extension where extname = 'pg_trgm') as present
  `.execute(db)

  const total = Number(counts?.total ?? 0)
  const indexed = Number(counts?.indexed ?? 0)
  process.stdout.write(`Messages:        ${total}\n`)
  process.stdout.write(`Searchable:      ${indexed}\n`)
  process.stdout.write(`Awaiting backfill: ${total - indexed}\n`)
  process.stdout.write(
    `Fuzzy matching:  ${extension.rows[0]?.present ? 'available' : 'unavailable (pg_trgm not installed)'}\n`,
  )
}

const cli: ModuleCli[] = [
  {
    command: 'backfill-search',
    async run(rest) {
      await backfillSearch(rest)
    },
  },
  {
    command: 'search-status',
    async run() {
      await searchStatus()
    },
  },
]

export default cli
