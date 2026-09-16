import test from 'node:test'
import assert from 'node:assert/strict'

import { describeDatabaseUrl, looksLocal, parseArgs } from '../reset-and-seed.mjs'

test('parseArgs recognises every flag and defaults them to false', () => {
  assert.deepEqual(parseArgs([]), { yes: false, dryRun: false, build: false, force: false, help: false })
  assert.equal(parseArgs(['--yes']).yes, true)
  assert.equal(parseArgs(['-y']).yes, true)
  assert.equal(parseArgs(['--dry-run']).dryRun, true)
  assert.equal(parseArgs(['--build']).build, true)
  assert.equal(parseArgs(['--force']).force, true)
  assert.equal(parseArgs(['-h']).help, true)
})

test('describeDatabaseUrl reports host and database but never the credentials', () => {
  const described = describeDatabaseUrl('postgres://someone:hunter2@db.internal:6543/operis')
  assert.equal(described, 'db.internal:6543/operis')
  assert.ok(!described.includes('hunter2'))
  assert.ok(!described.includes('someone'))
})

test('describeDatabaseUrl defaults the port and returns null for non-URL input', () => {
  assert.equal(describeDatabaseUrl('postgres://postgres:postgres@localhost/open-mercato'), 'localhost:5432/open-mercato')
  assert.equal(describeDatabaseUrl('not a url'), null)
})

test('looksLocal accepts workstation and compose hosts, rejects remote ones', () => {
  for (const host of ['localhost', '127.0.0.1', 'postgres']) {
    assert.equal(looksLocal(`postgres://u:p@${host}:5432/db`), true, host)
  }
  assert.equal(looksLocal('postgres://u:p@db.production.example.com:5432/db'), false)
  assert.equal(looksLocal('not a url'), false)
})
