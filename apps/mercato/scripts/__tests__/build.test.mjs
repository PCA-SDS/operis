import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNodeOptions, resolveHeapMb } from '../build.mjs'

test('resolveHeapMb defaults to the previously hard-coded 8192', () => {
  assert.equal(resolveHeapMb(undefined), 8192)
  assert.equal(resolveHeapMb(''), 8192)
  assert.equal(resolveHeapMb('   '), 8192)
})

test('resolveHeapMb honours a valid override', () => {
  assert.equal(resolveHeapMb('6144'), 6144)
  assert.equal(resolveHeapMb(4096), 4096)
})

test('resolveHeapMb falls back rather than passing a bad value to node', () => {
  for (const bad of ['0', '-1', 'abc', 'NaN', '1.5.2']) {
    assert.equal(resolveHeapMb(bad), 8192, `expected fallback for ${bad}`)
  }
})

test('buildNodeOptions sets the ceiling when none is present', () => {
  assert.equal(buildNodeOptions(undefined, 6144), '--max-old-space-size=6144')
  assert.equal(buildNodeOptions('', 6144), '--max-old-space-size=6144')
})

test('buildNodeOptions replaces an inherited ceiling instead of appending a second one', () => {
  const result = buildNodeOptions('--max-old-space-size=4096', 6144)
  assert.equal(result, '--max-old-space-size=6144')
  assert.equal(result.match(/--max-old-space-size/g).length, 1)
})

test('buildNodeOptions preserves unrelated flags the caller set', () => {
  assert.equal(
    buildNodeOptions('--enable-source-maps --max-old-space-size=4096 --no-warnings', 6144),
    '--enable-source-maps --no-warnings --max-old-space-size=6144',
  )
})
