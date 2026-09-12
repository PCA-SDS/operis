/**
 * Run the drift and backfill SQL against a real Postgres.
 *
 *   yarn matrix:verify:drift
 *
 * The unit tests drive `checkDrift` through a scripted fake connection, which
 * proves how the numbers become a verdict but proves nothing about the SQL
 * itself — a wrong column name or a mis-parenthesised `filter` clause passes
 * every one of them. This executes the real statements.
 *
 * It builds a throwaway database with only the tables the queries touch, seeds
 * rows covering each case the report distinguishes, and asserts the answers.
 * Nothing here goes near the application's own database.
 */

import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { checkDrift } from '@open-mercato/core/modules/chat_matrix/lib/drift'

const ADMIN_URL =
  process.env.OM_DRIFT_PROBE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const PROBE_DB = `om_drift_probe_${Date.now()}`

let passed = 0
let failed = 0
const pass = (name: string, detail = '') =>
  (passed += 1,
  process.stdout.write(`\x1b[32m  ✓\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}\n`))
const fail = (name: string, detail: string) =>
  (failed += 1,
  process.stdout.write(`\x1b[31m  ✗ ${name}\x1b[0m\n     \x1b[31m${detail}\x1b[0m\n`))

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(name, String(actual))
  else fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

/**
 * The shape `checkDrift` actually uses — and, critically, with the SAME
 * placeholder dialect.
 *
 * `em.getConnection().execute()` binds through Knex, which uses positional `?`.
 * `pg` uses `$n`. An earlier version of this probe handed the SQL to `pg`
 * unchanged, which validated the semantics and silently accepted `$1` — so the
 * real CLI still failed with "there is no parameter $1" the first time it ran.
 * Translating here is what makes the probe faithful rather than merely green.
 */
function emFor(client: Client) {
  const toPg = (sql: string) => {
    let index = 0
    return sql.replace(/\?/g, () => `$${(index += 1)}`)
  }
  return {
    getConnection: () => ({
      async execute(sql: string, params: unknown[] = []) {
        const result = await client.query(toPg(sql), params as never[])
        return result.rows
      },
    }),
  } as never
}

/** Only the columns the drift and backfill queries read. */
const SCHEMA = `
create table chat_conversations (
  id uuid primary key,
  tenant_id uuid not null,
  organization_id uuid not null,
  kind text not null,
  title text null,
  deleted_at timestamptz null
);
create table chat_messages (
  id uuid primary key,
  tenant_id uuid not null,
  organization_id uuid not null,
  conversation_id uuid not null,
  sender_user_id uuid not null,
  body text not null,
  reply_to_message_id uuid null,
  kind text not null default 'user',
  created_at timestamptz not null,
  deleted_at timestamptz null
);
create table chat_participants (
  conversation_id uuid not null,
  user_id uuid not null,
  role text not null default 'member'
);
create table chat_matrix_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  organization_id uuid not null,
  conversation_id uuid not null unique,
  room_id text not null unique,
  state text not null default 'pending',
  last_error text null,
  created_at timestamptz not null,
  updated_at timestamptz null
);
create table chat_matrix_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  organization_id uuid not null,
  message_id uuid null,
  subject_key text null,
  conversation_id uuid not null,
  room_id text not null,
  event_id text not null unique,
  event_type text not null,
  origin_server_ts timestamptz not null,
  projected_at timestamptz null,
  created_at timestamptz not null
);
`

const TENANT = randomUUID()
const ORG = randomUUID()
const OTHER_TENANT = randomUUID()

async function seed(client: Client): Promise<void> {
  const roomCreated = new Date('2026-09-10T10:00:00Z')
  const conv = randomUUID()
  const orphanConv = randomUUID()
  const failedConv = randomUUID()

  const conversation = async (id: string) =>
    client.query(
      `insert into chat_conversations (id, tenant_id, organization_id, kind, title, deleted_at)
       values ($1,$2,$3,'space','probe',null)`,
      [id, TENANT, ORG],
    )

  await conversation(conv)
  await conversation(orphanConv)
  await conversation(failedConv)

  await client.query(
    `insert into chat_matrix_rooms (tenant_id, organization_id, conversation_id, room_id, state, created_at)
     values ($1,$2,$3,'!ready:x','ready',$4), ($1,$2,$5,'!failed:x','failed',$4)`,
    [TENANT, ORG, conv, roomCreated, failedConv],
  )

  const message = async (id: string, createdAt: Date, kind = 'user', deleted: Date | null = null) =>
    client.query(
      `insert into chat_messages
         (id, tenant_id, organization_id, conversation_id, sender_user_id, body, kind, created_at, deleted_at)
       values ($1,$2,$3,$4,$5,'probe',$6,$7,$8)`,
      [id, TENANT, ORG, conv, randomUUID(), kind, createdAt, deleted],
    )

  const mapped = async (messageId: string) =>
    client.query(
      `insert into chat_matrix_events
         (tenant_id, organization_id, message_id, conversation_id, room_id, event_id, event_type, origin_server_ts, projected_at, created_at)
       values ($1,$2,$3,$4,'!ready:x',$5,'m.room.message',now(),now(),now())`,
      [TENANT, ORG, messageId, conv, `$${randomUUID()}`],
    )

  // Two published after the room existed.
  for (let index = 0; index < 2; index += 1) {
    const id = randomUUID()
    await message(id, new Date('2026-09-10T11:00:00Z'))
    await mapped(id)
  }
  // One written after the room and never published — the number that must be zero.
  await message(randomUUID(), new Date('2026-09-10T12:00:00Z'))
  // Three that predate the room — backfill scope, explicitly NOT drift.
  for (let index = 0; index < 3; index += 1) {
    await message(randomUUID(), new Date('2026-09-10T09:00:00Z'))
  }
  // Noise the predicate must exclude: a system message and a soft-deleted one.
  await message(randomUUID(), new Date('2026-09-10T13:00:00Z'), 'system')
  await message(randomUUID(), new Date('2026-09-10T13:00:00Z'), 'user', new Date())

  // A conversation with messages and no room at all.
  await client.query(
    `insert into chat_messages
       (id, tenant_id, organization_id, conversation_id, sender_user_id, body, kind, created_at, deleted_at)
     values ($1,$2,$3,$4,$5,'probe','user',now(),null)`,
    [randomUUID(), TENANT, ORG, orphanConv, randomUUID()],
  )

  // Another tenant's drift, which must never appear in this tenant's report.
  const foreignConv = randomUUID()
  await client.query(
    `insert into chat_conversations (id, tenant_id, organization_id, kind, title, deleted_at)
     values ($1,$2,$3,'space','other',null)`,
    [foreignConv, OTHER_TENANT, ORG],
  )
  await client.query(
    `insert into chat_matrix_rooms (tenant_id, organization_id, conversation_id, room_id, state, created_at)
     values ($1,$2,$3,'!other:x','ready',$4)`,
    [OTHER_TENANT, ORG, foreignConv, roomCreated],
  )
  await client.query(
    `insert into chat_messages
       (id, tenant_id, organization_id, conversation_id, sender_user_id, body, kind, created_at, deleted_at)
     values ($1,$2,$3,$4,$5,'probe','user',$6,null)`,
    [randomUUID(), OTHER_TENANT, ORG, foreignConv, randomUUID(), new Date('2026-09-10T11:00:00Z')],
  )
}

async function main(): Promise<void> {
  process.stdout.write(
    `\x1b[1mDrift SQL against real Postgres\x1b[0m  \x1b[90m${PROBE_DB}\x1b[0m\n\n`,
  )

  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`create database "${PROBE_DB}"`)
  await admin.end()

  const probeUrl = ADMIN_URL.replace(/\/[^/]*$/, `/${PROBE_DB}`)
  const client = new Client({ connectionString: probeUrl })
  await client.connect()

  try {
    await client.query(SCHEMA)
    await seed(client)

    process.stdout.write('\x1b[1mScoped to one tenant\x1b[0m\n')
    const scoped = await checkDrift(emFor(client), { tenantId: TENANT, organizationId: ORG })

    check('rooms ready', scoped.rooms.ready, 1)
    check('rooms failed', scoped.rooms.failed, 1)
    check('messages in scope', scoped.messagesInScope, 3)
    check('messages published', scoped.messagesPublished, 2)
    check('messages drifted', scoped.messagesDrifted, 1)
    check('messages awaiting backfill', scoped.messagesAwaitingBackfill, 3)
    check('conversations without a room', scoped.conversationsWithoutRoom, 1)
    check('unhealthy, because of the drift and the failed room', scoped.healthy, false)
    check('a sample is offered', scoped.samples.length, 1)

    if (scoped.oldestDriftedAt instanceof Date) {
      pass('oldest drifted timestamp is a Date', scoped.oldestDriftedAt.toISOString())
    } else {
      fail('oldest drifted timestamp is a Date', String(scoped.oldestDriftedAt))
    }

    process.stdout.write('\n\x1b[1mAnother tenant is invisible\x1b[0m\n')
    const other = await checkDrift(emFor(client), { tenantId: OTHER_TENANT })
    check("the other tenant's own drift is its own", other.messagesDrifted, 1)
    check('and it sees only its own room', other.rooms.ready, 1)
    check('and none of the first tenant s failed rooms', other.rooms.failed, 0)

    process.stdout.write('\n\x1b[1mUnscoped sees everything\x1b[0m\n')
    const all = await checkDrift(emFor(client))
    check('drift across both tenants', all.messagesDrifted, 2)

    process.stdout.write('\n\x1b[1mThe backfill queue query\x1b[0m\n')
    const pending = await client.query(
      `select c.id as conversation_id, count(m.id)::text as pending
         from chat_conversations c
         join chat_messages m on m.conversation_id = c.id
         left join chat_matrix_events e on e.message_id = m.id
        where c.deleted_at is null
          and m.kind = 'user'
          and m.deleted_at is null
          and e.id is null
          and c.tenant_id = $1
        group by c.id
        order by min(m.created_at) asc`,
      [TENANT],
    )
    check('two conversations have unpublished messages', pending.rows.length, 2)
    check(
      'and the oldest comes first',
      Number(pending.rows[0].pending),
      4,
    )
  } finally {
    await client.end()
    const cleanup = new Client({ connectionString: ADMIN_URL })
    await cleanup.connect()
    await cleanup.query(`drop database if exists "${PROBE_DB}"`)
    await cleanup.end()
  }

  process.stdout.write('\n')
  if (failed === 0) {
    process.stdout.write(`\x1b[32m\x1b[1m✓ ${passed} checks passed\x1b[0m\n`)
    process.exit(0)
  }
  process.stdout.write(`\x1b[31m\x1b[1m✗ ${failed} of ${passed + failed} checks failed\x1b[0m\n`)
  process.exit(1)
}

main().catch((error) => {
  process.stderr.write(`\x1b[31m✗ ${error instanceof Error ? error.stack : String(error)}\x1b[0m\n`)
  process.exit(1)
})
