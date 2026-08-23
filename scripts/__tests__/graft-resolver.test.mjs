import test from 'node:test'
import assert from 'node:assert/strict'

import { GRAFT_PACKAGE, GRAFT_VERSION, parseGraftVersion, resolveGraft } from '../graft.mjs'

test('parseGraftVersion reads the version off the first line of `graft version`', () => {
  const stdout = `graft ${GRAFT_VERSION}\nlatest on npm: ${GRAFT_VERSION} ✓ up to date\n`
  assert.equal(parseGraftVersion(stdout), GRAFT_VERSION)
})

test('parseGraftVersion returns null for output that is not a version banner', () => {
  assert.equal(parseGraftVersion('command not found: graft'), null)
  assert.equal(parseGraftVersion(''), null)
  assert.equal(parseGraftVersion(undefined), null)
})

test('GRAFT_BIN wins outright and is never version-probed', () => {
  let probed = false
  const resolved = resolveGraft({
    env: { GRAFT_BIN: '/opt/graft/bin/graft' },
    probe: () => {
      probed = true
      return GRAFT_VERSION
    },
  })

  assert.equal(resolved.command, '/opt/graft/bin/graft')
  assert.deepEqual(resolved.prefixArgs, [])
  assert.equal(probed, false, 'GRAFT_BIN must short-circuit detection')
})

test('a blank GRAFT_BIN is ignored rather than run as an empty command', () => {
  const resolved = resolveGraft({ env: { GRAFT_BIN: '   ' }, probe: () => GRAFT_VERSION })
  assert.equal(resolved.command, 'graft')
})

test('a PATH graft at the pinned version is used directly', () => {
  const resolved = resolveGraft({ env: {}, probe: () => GRAFT_VERSION })

  assert.equal(resolved.command, 'graft')
  assert.deepEqual(resolved.prefixArgs, [])
})

test('a PATH graft at the wrong version is rejected in favour of the pin', () => {
  const resolved = resolveGraft({ env: {}, probe: () => '0.11.0' })

  assert.equal(resolved.command, 'npx')
  assert.deepEqual(resolved.prefixArgs, ['-y', GRAFT_PACKAGE])
  assert.match(resolved.source, /PATH has 0\.11\.0/, 'the mismatch must be visible, not silent')
})

test('no graft on PATH falls back to the pinned package', () => {
  const resolved = resolveGraft({ env: {}, probe: () => null })

  assert.equal(resolved.command, 'npx')
  assert.deepEqual(resolved.prefixArgs, ['-y', GRAFT_PACKAGE])
  assert.doesNotMatch(resolved.source, /PATH has/)
})

test('the pinned package always carries an exact version', () => {
  assert.match(GRAFT_PACKAGE, /^@nanonets\/graft@\d+\.\d+\.\d+$/)
})
