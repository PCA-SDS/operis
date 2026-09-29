import fs from 'node:fs'
import path from 'node:path'

/**
 * The schema half of external participants, pinned against the migration SQL.
 *
 * Four composite foreign keys carry guarantees the application cannot promise
 * alone, and the ORM snapshot cannot express composite keys — so they exist only
 * in this hand-written migration, where a regenerated file would silently lose
 * them. The constraints were also exercised against a real Postgres when they
 * were written (spec changelog, 2026-09-29); this keeps them from quietly
 * disappearing afterwards.
 */
const MIGRATIONS = path.resolve(__dirname, '../migrations')
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, 'Migration20260929021644_chat.ts'), 'utf8')
const [UP, DOWN] = MIGRATION.split('override down()')

const snapshot = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, '.snapshot-open-mercato.json'), 'utf8')) as {
  tables: Array<{ name: string; checks?: Array<{ name: string }>; indexes?: Array<{ keyName: string }> }>
}
const table = (name: string) => snapshot.tables.find((candidate) => candidate.name === name)

describe('external participants — migration', () => {
  it.each([
    [
      'chat_participants_external_conversation_fk',
      '("conversation_id", "conversation_kind") references "chat_conversations" ("id", "kind")',
      'on delete cascade',
    ],
    [
      'chat_participants_external_contact_fk',
      '("external_contact_id", "tenant_id", "organization_id") references "chat_external_contacts" ("id", "tenant_id", "organization_id")',
      'on delete no action',
    ],
    [
      'chat_messages_sender_external_contact_fk',
      '("sender_external_contact_id", "tenant_id", "organization_id") references "chat_external_contacts" ("id", "tenant_id", "organization_id")',
      'on delete no action',
    ],
    [
      'chat_message_reactions_external_contact_fk',
      '("external_contact_id", "tenant_id", "organization_id") references "chat_external_contacts" ("id", "tenant_id", "organization_id")',
      'on delete no action',
    ],
  ])('adds %s with its columns and delete rule', (name, keys, onDelete) => {
    const line = UP.split('\n').find((candidate) => candidate.includes(`"${name}"`))
    expect(line).toBeDefined()
    expect(line).toContain(`foreign key ${keys}`)
    expect(line).toContain(onDelete)
  })

  it('makes each identity column nullable, and only those', () => {
    const relaxed = [...UP.matchAll(/alter table "(\w+)" alter column "(\w+)" drop not null/g)].map(
      ([, tableName, column]) => `${tableName}.${column}`,
    )
    expect(relaxed.sort()).toEqual([
      'chat_message_reactions.user_id',
      'chat_messages.sender_user_id',
      'chat_participants.user_id',
    ])
  })

  it('lets no outsider row sit in a direct or a space, and never as an owner', () => {
    expect(UP).toContain(
      `("external_contact_id" is null) = ("conversation_kind" is null) and ("conversation_kind" is null or "conversation_kind" = 'external') and ("external_contact_id" is null or "role" = 'member')`,
    )
  })

  it('reverses every constraint and the table on the way down', () => {
    for (const name of [
      'chat_participants_external_conversation_fk',
      'chat_participants_external_contact_fk',
      'chat_messages_sender_external_contact_fk',
      'chat_message_reactions_external_contact_fk',
      'chat_conversations_id_kind_uq',
    ]) {
      expect(DOWN).toContain(`drop constraint if exists "${name}"`)
    }
    expect(DOWN).toContain('drop table if exists "chat_external_contacts"')
  })
})

describe('external participants — snapshot', () => {
  it.each([
    ['chat_participants', 'chat_participants_identity_chk'],
    ['chat_participants', 'chat_participants_external_shape_chk'],
    ['chat_messages', 'chat_messages_sender_chk'],
    ['chat_message_reactions', 'chat_message_reactions_identity_chk'],
    ['chat_conversations', 'chat_conversations_kind_shape_chk'],
    ['chat_external_contacts', 'chat_external_contacts_network_chk'],
  ])('records %s.%s, so a regenerated migration does not drop it', (tableName, check) => {
    expect(table(tableName)?.checks?.map((candidate) => candidate.name)).toContain(check)
  })

  it.each([
    ['chat_participants', 'chat_participants_conversation_contact_uq'],
    ['chat_message_reactions', 'chat_message_reactions_contact_uq'],
    ['chat_conversations', 'chat_conversations_id_kind_uq'],
    ['chat_external_contacts', 'chat_external_contacts_scope_uq'],
  ])('records the unique key %s.%s', (tableName, key) => {
    expect(table(tableName)?.indexes?.map((candidate) => candidate.keyName)).toContain(key)
  })
})
