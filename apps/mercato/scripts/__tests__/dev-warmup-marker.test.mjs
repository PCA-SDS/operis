import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyWarmupReadyFileEnv, resolveWarmupReadyFile } from '../dev-warmup-marker.mjs'

const devScriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dev.mjs',
)

test('resolveWarmupReadyFile keeps the orchestrator path in splash mode', () => {
  assert.equal(
    resolveWarmupReadyFile({
      rawPassthrough: false,
      envValue: '/repo/apps/mercato/.mercato/dev-warmup-ready.json',
      splashChildStateFile: '/repo/apps/mercato/.mercato/splash-state.json',
    }),
    '/repo/apps/mercato/.mercato/dev-warmup-ready.json',
  )
})

test('resolveWarmupReadyFile derives a path from the splash state file', () => {
  assert.equal(
    resolveWarmupReadyFile({
      rawPassthrough: false,
      envValue: '   ',
      splashChildStateFile: '/repo/apps/mercato/.mercato/splash-state.json',
    }),
    '/repo/apps/mercato/.mercato/splash-state.json.warmup-ready',
  )
})

test('resolveWarmupReadyFile has no marker without a splash state file', () => {
  assert.equal(
    resolveWarmupReadyFile({
      rawPassthrough: false,
      envValue: undefined,
      splashChildStateFile: null,
    }),
    null,
  )
})

test('resolveWarmupReadyFile disowns the marker in raw passthrough mode', () => {
  assert.equal(
    resolveWarmupReadyFile({
      rawPassthrough: true,
      envValue: '/repo/apps/mercato/.mercato/dev-warmup-ready.json',
      splashChildStateFile: '/repo/apps/mercato/.mercato/splash-state.json',
    }),
    null,
  )
})

test('applyWarmupReadyFileEnv advertises the marker the wrapper will write', () => {
  const env = applyWarmupReadyFileEnv({ FOO: 'bar' }, '/repo/.mercato/dev-warmup-ready.json')

  assert.equal(env.OM_DEV_WARMUP_READY_FILE, '/repo/.mercato/dev-warmup-ready.json')
  assert.equal(env.FOO, 'bar')
})

test('applyWarmupReadyFileEnv strips an inherited marker nobody writes', () => {
  const env = applyWarmupReadyFileEnv(
    { FOO: 'bar', OM_DEV_WARMUP_READY_FILE: '/repo/.mercato/dev-warmup-ready.json' },
    null,
  )

  assert.equal('OM_DEV_WARMUP_READY_FILE' in env, false)
  assert.equal(env.FOO, 'bar')
})

test('exhausted warmup retries still release the background services', () => {
  const source = fs.readFileSync(devScriptPath, 'utf8')
  const exhaustedStart = source.indexOf('if (attempt >= maxWarmupRetryAttempts) {')
  assert.notEqual(exhaustedStart, -1, 'dev.mjs must cap warmup retries')
  const exhaustedEnd = source.indexOf('const retryBaseMessage', exhaustedStart)
  assert.notEqual(exhaustedEnd, -1, 'dev.mjs must schedule a retry below the cap')

  assert.match(
    source.slice(exhaustedStart, exhaustedEnd),
    /writeWarmupReadyFile\('warmup-failed'\)/,
    'a warmup that exhausts its retries must write the marker, or `mercato server:dev` '
      + 'parks queue workers and the scheduler for the whole warmup timeout',
  )
})

test('the runtime child never inherits a marker path the wrapper disowned', () => {
  const source = fs.readFileSync(devScriptPath, 'utf8')

  assert.match(source, /env: applyWarmupReadyFileEnv\(\{/)
  assert.match(source, /\}, warmupReadyFile\)/)
})
