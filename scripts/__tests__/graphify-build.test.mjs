import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BACKEND_CANDIDATES,
  buildClusterArgs,
  buildExtractArgs,
  buildUpdateArgs,
  detectBackend,
  parseArgs,
} from '../graphify-build.mjs'

test('no key at all means no backend', () => {
  assert.equal(detectBackend({}), null)
  assert.equal(detectBackend({ GEMINI_API_KEY: '' }), null)
  assert.equal(detectBackend({ GEMINI_API_KEY: '   ' }), null)
})

test('every candidate env var maps to a backend graphify accepts', () => {
  const accepted = new Set(['gemini', 'kimi', 'claude', 'openai', 'deepseek', 'ollama'])
  for (const candidate of BACKEND_CANDIDATES) {
    assert.ok(accepted.has(candidate.backend), `${candidate.backend} is not a graphify backend`)
    assert.equal(detectBackend({ [candidate.env]: 'k' }).backend, candidate.backend)
  }
})

test('gemini wins when several keys are set — it is the cheap bulk-document path', () => {
  const backend = detectBackend({ OPENAI_API_KEY: 'a', ANTHROPIC_API_KEY: 'b', GEMINI_API_KEY: 'c' })
  assert.equal(backend.backend, 'gemini')
})

test('without a backend the extract pass is forced to code-only', () => {
  const args = buildExtractArgs({ backend: null })
  assert.deepEqual(args, ['extract', '.', '--code-only'])
})

test('with a backend the documents are included and no code-only flag is set', () => {
  const args = buildExtractArgs({ backend: { backend: 'gemini' } })
  assert.deepEqual(args, ['extract', '.', '--backend=gemini'])
  assert.ok(!args.includes('--code-only'))
})

test('passthrough args land after the generated flags', () => {
  const args = buildExtractArgs({ backend: null, passthrough: ['--force'] })
  assert.deepEqual(args, ['extract', '.', '--code-only', '--force'])
})

test('clustering skips LLM labelling only when there is no backend', () => {
  assert.ok(buildClusterArgs({ backend: null }).includes('--no-label'))
  assert.ok(!buildClusterArgs({ backend: { backend: 'gemini' } }).includes('--no-label'))
})

test('--no-viz reaches the cluster step', () => {
  assert.ok(buildClusterArgs({ backend: null, noViz: true }).includes('--no-viz'))
  assert.ok(!buildClusterArgs({ backend: null, noViz: false }).includes('--no-viz'))
})

test('update mode targets the repo root', () => {
  assert.deepEqual(buildUpdateArgs({}), ['update', '.'])
  assert.deepEqual(buildUpdateArgs({ passthrough: ['--force'] }), ['update', '.', '--force'])
})

test('parseArgs splits own flags from graphify passthrough', () => {
  const options = parseArgs(['--update', '--no-viz', '--', '--force', '--max-workers', '4'])
  assert.equal(options.update, true)
  assert.equal(options.noViz, true)
  assert.deepEqual(options.passthrough, ['--force', '--max-workers', '4'])
})

test('an unknown own flag fails loudly instead of reaching graphify', () => {
  assert.throws(() => parseArgs(['--deep']), /Unknown argument: --deep/)
})
