import fs from 'node:fs'
import path from 'node:path'
import { features } from '../acl'
import { metadata } from '../index'
import setup from '../setup'
import {
  ChatMatrixEvent,
  ChatMatrixIdentity,
  ChatMatrixRoom,
  ChatMatrixSyncState,
  ChatMatrixTransaction,
} from '../data/entities'

/**
 * What this module promises the rest of the system.
 *
 * The load-bearing claim is the last one: this module adds tables and changes
 * nothing in `chat`. If that stops being true, the whole "swap the transport
 * without breaking anything" argument stops being true with it.
 */

const MODULE_ROOT = path.resolve(__dirname, '..')

describe('module metadata', () => {
  it('is named for its module id', () => {
    expect(metadata.name).toBe('chat_matrix')
  })

  it('is off by default', () => {
    // The transport is behind OM_CHAT_TRANSPORT and does nothing until a
    // homeserver is configured; switching it on for a new tenant would
    // advertise a capability no deployment has yet.
    expect(metadata.defaultEntitlement).toBe('disabled')
  })

  it('declares its dependency on chat', () => {
    expect(metadata.requires).toContain('chat')
  })
})

describe('ACL', () => {
  it('namespaces every feature under the module', () => {
    expect(features.filter((feature) => !feature.id.startsWith('chat_matrix.'))).toEqual([])
  })

  it('tags every feature with the module', () => {
    expect(features.filter((feature) => feature.module !== 'chat_matrix')).toEqual([])
  })

  it('grants no way into a conversation', () => {
    // Chat access is membership, not privilege. This module must not become a
    // route around that, so it exposes transport health and nothing else.
    const suspicious = features.filter((feature) => /read|message|conversation/i.test(feature.id))
    expect(suspicious).toEqual([])
  })

  it('is seeded to administrators only', () => {
    expect(Object.keys(setup.defaultRoleFeatures ?? {})).toEqual(['admin'])
  })
})

describe('entities', () => {
  it('owns exactly the five mapping tables', () => {
    const entities = [
      ChatMatrixIdentity,
      ChatMatrixRoom,
      ChatMatrixEvent,
      ChatMatrixTransaction,
      ChatMatrixSyncState,
    ]
    expect(entities).toHaveLength(5)
    expect(entities.every((entity) => typeof entity === 'function')).toBe(true)
  })

  it('prefixes every table with the module id', () => {
    const source = fs.readFileSync(path.join(MODULE_ROOT, 'data', 'entities.ts'), 'utf8')
    const tables = [...source.matchAll(/tableName:\s*'([^']+)'/g)].map((match) => match[1])
    expect(tables).toHaveLength(5)
    expect(tables.filter((table) => !table.startsWith('chat_matrix_'))).toEqual([])
  })

  it('declares no ORM relation to another module', () => {
    // Conversations and messages are referenced by plain uuid. A relation across
    // the module boundary is banned by the root guidelines, and a hard FK here
    // would also let these tables block a chat-side delete.
    const source = fs.readFileSync(path.join(MODULE_ROOT, 'data', 'entities.ts'), 'utf8')
    expect(source).not.toMatch(/@(ManyToOne|OneToMany|OneToOne|ManyToMany)\(/)
  })
})

describe('the isolation guarantee', () => {
  const migrationDir = path.join(MODULE_ROOT, 'migrations')
  const migrations = fs
    .readdirSync(migrationDir)
    .filter((file) => file.startsWith('Migration') && file.endsWith('.ts'))
    .map((file) => fs.readFileSync(path.join(migrationDir, file), 'utf8'))

  it('ships at least one migration', () => {
    expect(migrations.length).toBeGreaterThan(0)
  })

  it('never alters a chat table', () => {
    // The whole rollback story rests on this: dropping four tables nothing else
    // reads. An ALTER on chat_messages would silently make that false.
    for (const sql of migrations) {
      const statements = [...sql.matchAll(/(alter|drop)\s+table\s+(if\s+exists\s+)?"([a-z_]+)"/gi)]
      const touched = statements.map((match) => match[3])
      const foreign = touched.filter((table) => !table.startsWith('chat_matrix_'))
      expect(foreign).toEqual([])
    }
  })

  it('creates only chat_matrix tables', () => {
    for (const sql of migrations) {
      const created = [...sql.matchAll(/create\s+table\s+"([a-z_]+)"/gi)].map((match) => match[1])
      expect(created.filter((table) => !table.startsWith('chat_matrix_'))).toEqual([])
    }
  })

  it('can be rolled back', () => {
    for (const sql of migrations) {
      expect(sql).toContain('override down()')
    }
  })
})
