import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Regression guard for issue #2402: `yarn test` peak memory fan-out must stay
// bounded. `turbo run test` starts one jest main per package and each main
// forks workers, so an uncapped run is (packages × cores) workers — structurally
// unbounded.
//
// WHAT CHANGED (2026-08-29). This guard used to pin three factors: turbo
// concurrency, `maxWorkers <= 2`, and a V8 old-space cap. Two of those were
// actively harmful and are now asserted the other way round. See
// .ai/specs/2026-08-29-ci-pipeline-reliability-and-speed.md.
//
//   * The V8 old-space cap. `NODE_OPTIONS` applies PER PROCESS, and jest's
//     workers inherit it — so `--max-old-space-size=1024` capped each worker at
//     1 GB (below what ts-jest needs here) while `test:serial`'s 6144 asked for
//     ~18 GB on a 16 GB runner. The flag was a memory hazard in both
//     directions. The bound now comes from topology instead: turbo
//     `--concurrency=1` means one package at a time, so peak process count is
//     `1 + maxWorkers` on any machine, with no flag involved.
//
//   * `workerIdleMemoryLimit`. Recycling workers at 512MB forced constant GC
//     churn, which is what trips a V8 garbage-collector bug that kills a worker
//     with SIGSEGV. Measured over six runs of packages/cli: 5/6 runs crashed
//     with the limit, 2/6 without. Worker COUNT showed no adverse trend from 2
//     to 8, so the old `<= 2` cap bought nothing either.
//
// So these tests now fail if anyone reintroduces a heap flag on the test path or
// a worker-recycling limit, and still fail if the concurrency bound is removed.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)

const availableCores =
  typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length

function findJestConfigs() {
  const roots = [path.join(REPO_ROOT, 'packages'), path.join(REPO_ROOT, 'apps')]
  const found = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const cfg = path.join(root, entry.name, 'jest.config.cjs')
      if (fs.existsSync(cfg)) found.push(cfg)
    }
  }
  return found
}

function assertWorkerCountIsBounded(config, label) {
  assert.ok(
    typeof config.maxWorkers === 'number' && Number.isInteger(config.maxWorkers),
    `${label}: maxWorkers must be an explicit integer, got ${config.maxWorkers}`,
  )
  assert.ok(
    config.maxWorkers >= 1 && config.maxWorkers <= availableCores,
    `${label}: maxWorkers must be between 1 and this machine's core count (${availableCores}), got ${config.maxWorkers}`,
  )
}

function assertNoWorkerRecycling(config, label) {
  assert.equal(
    config.workerIdleMemoryLimit,
    undefined,
    `${label}: must NOT set workerIdleMemoryLimit — recycling workers at a low threshold forces the GC churn that triggers the V8 worker crash (measured 5/6 runs vs 2/6 without it)`,
  )
}

test('a shared jest base config pins an explicit, core-relative worker count', () => {
  const basePath = path.join(REPO_ROOT, 'jest.config.base.cjs')
  assert.ok(fs.existsSync(basePath), 'jest.config.base.cjs must exist at repo root')
  const base = require(basePath)
  assertWorkerCountIsBounded(base, 'jest.config.base.cjs')
  assertNoWorkerRecycling(base, 'jest.config.base.cjs')
})

test('every package jest config inherits a bounded worker count and no recycling limit', () => {
  const configs = findJestConfigs()
  assert.ok(configs.length >= 18, `expected the full set of package jest configs, found ${configs.length}`)
  for (const cfg of configs) {
    const rel = path.relative(REPO_ROOT, cfg)
    assertWorkerCountIsBounded(require(cfg), rel)
    assertNoWorkerRecycling(require(cfg), rel)
  }
})

test('the root test scripts bound the fan-out by concurrency, not by a heap flag', () => {
  const pkg = require(path.join(REPO_ROOT, 'package.json'))

  for (const name of ['test', 'test:serial']) {
    const script = pkg.scripts[name]
    assert.ok(script, `root package.json must define a ${name} script`)

    assert.match(
      script,
      /--concurrency=1\b/,
      `${name}: must run one package at a time, so peak process count is 1 + maxWorkers regardless of machine`,
    )

    assert.doesNotMatch(
      script,
      /--max-old-space-size=/,
      `${name}: must NOT pin a V8 old-space cap. NODE_OPTIONS applies per process, so the flag reaches every jest worker — it starved workers at 1024 and requested ~18 GB on a 16 GB runner at 6144`,
    )
  }
})

test('the CI test entrypoint retries only on a worker crash, never on a test failure', () => {
  const pkg = require(path.join(REPO_ROOT, 'package.json'))
  assert.ok(pkg.scripts['test:ci'], 'root package.json must define a test:ci script')

  const runnerPath = path.join(REPO_ROOT, 'scripts', 'test-with-crash-retry.mjs')
  assert.ok(fs.existsSync(runnerPath), 'scripts/test-with-crash-retry.mjs must exist')
  const source = fs.readFileSync(runnerPath, 'utf8')

  // The retry must stay gated on BOTH conditions. Dropping the failure check
  // would turn a real regression green, which is the one thing this script must
  // never do.
  assert.match(source, /signal=SIG\(/, 'retry must key on a fatal worker signal')
  assert.match(
    source,
    /failures > 0/,
    'retry must refuse to fire when any test reported a failure',
  )
})
