/** @type {import('jest').Config} */
// Shared jest base config — governs test-suite parallelism and memory.
//
// The shape of the fan-out (issue #2402): `turbo run test` launches one jest
// "main" per package, and each main forks worker processes. Left uncapped,
// every package defaults to `os.cpus().length - 1` workers, so the worst-case
// worker count is (packages × cores) — structurally unbounded.
//
// That is now bounded by TOPOLOGY rather than by a heap flag. The root `test`
// script pins turbo to `--concurrency=1`, so exactly one package runs at a
// time and peak process count is `1 + maxWorkers`, whatever the machine. One
// package at a time is not the slow path it sounds like: `test` is a cached
// turbo task, so packages whose inputs did not change replay instead of
// running, and the long pole is a single package (packages/core, ~1400 suites)
// which wants every core to itself anyway.
//
// What this replaced, and why:
//
//   * NODE_OPTIONS=--max-old-space-size=N in the root test scripts. Node
//     applies NODE_OPTIONS to EVERY process that inherits the environment —
//     jest's main and each of its workers. `test` set 1024, which starved each
//     worker below what ts-jest needs on this codebase; `test:serial` set 6144,
//     which asked for up to 3 × 6 GB on a 16 GB runner. The flag intended as a
//     memory guard was a memory hazard in both directions. There is no
//     NODE_OPTIONS heap flag anywhere in the test path now.
//
//   * workerIdleMemoryLimit: '512MB'. Measured, not theorised: running
//     packages/cli's suite six times with the limit produced a worker SIGSEGV
//     in 5 runs; six times without it, 2; and worker COUNT showed no adverse
//     trend from 2 to 8, so the old cap of 2 bought nothing.
//
//     The crash is not a memory shortage and not a native addon. The macOS
//     crash report puts the fault inside V8's own garbage collector —
//     ClearStaleLeftTrimmedPointerVisitor, reached from MarkCompactCollector
//     via StackGuard::HandleInterrupts — with no addon and no project frame on
//     the faulting thread. It is still present on Node 24.20.0. Recycling
//     workers at 512MB forced constant heap churn, which is precisely the
//     condition that trips it: the guard was the largest single contributor to
//     the crashes it existed to prevent.
//
// A crashed worker still surfaces as "N failed suites, 0 failed tests" — a
// suite reported FAILED while every test in it PASSED. That signature means a
// worker died, not that a test regressed. Re-run with `yarn test:serial`
// (JEST_MAX_WORKERS=2) to retry under lower pressure.
//
// Do NOT reach for fully in-band (JEST_MAX_WORKERS=1) as a diagnostic here.
// It does avoid the V8 crash, but several packages/cli suites exercise worker
// and scheduler supervisors that register real process signal handlers; in-band
// those land on the jest main process instead of a disposable worker, and that
// package exited 129 (SIGHUP) in 4 of 5 runs through turbo.
//
// Scope: this crash reproduces readily on macOS/arm64 and has NOT been observed
// on the Linux CI runners — four real CI runs, three of them full test runs on
// the previous worst-case configuration, contain zero occurrences.
//
// Every package's jest.config.cjs spreads this first, then overrides specifics.
const os = require('node:os')

const isCI = process.env.CI === 'true' || process.env.CI === '1'

function availableCores() {
  if (typeof os.availableParallelism === 'function') return os.availableParallelism()
  return os.cpus().length
}

function resolveMaxWorkers() {
  const override = Number.parseInt(process.env.JEST_MAX_WORKERS ?? '', 10)
  if (Number.isInteger(override) && override > 0) return override
  const cores = availableCores()
  // CI: leave one core for the jest main and the turbo process above it.
  // Local: half the machine, so a test run does not make the editor unusable.
  return Math.max(1, isCI ? cores - 1 : Math.floor(cores / 2))
}

const config = {
  // TEMPORARY (TypeScript 7 migration): redirect `import ts from 'typescript'`
  // in test code to the JS-based `typescript-js` alias — native TS 7 drops the
  // JS compiler API. Packages spread this base first and do not override
  // `resolver`, so every suite inherits it. See scripts/jest-typescript-resolver.cjs.
  resolver: require.resolve('./scripts/jest-typescript-resolver.cjs'),
  maxWorkers: resolveMaxWorkers(),
}

// ts-jest transpiles every test file and every module it reaches. Cold, that
// dominates a CI test step; warm, it is close to free. Jest defaults this to a
// tmpdir that CI discards between runs, so CI points it at a cached path.
if (process.env.JEST_CACHE_DIR) {
  config.cacheDirectory = process.env.JEST_CACHE_DIR
}

module.exports = config
