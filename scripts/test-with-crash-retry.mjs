#!/usr/bin/env node
// Runs the unit-test suite and retries a bounded number of times — but only when
// a jest worker died on a fatal signal, never when a test actually failed.
//
// The crash. A jest worker occasionally dies with SIGSEGV. The macOS crash
// report puts the fault inside V8 itself:
//
//   v8::internal::ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers
//   v8::internal::MarkCompactCollector::MarkLiveObjects
//   v8::internal::Heap::CollectGarbage
//   v8::internal::StackGuard::HandleInterrupts
//
// No native addon and no project code appears on the faulting thread. It is a
// V8 garbage-collector bug, it reproduces on Node 24.19.0 and 24.20.0 alike,
// and it is not attributable to any single suite — jest blames whichever suite
// the dying worker happened to hold, which is why the reported file moves
// around and always shows "1 failed suite, 0 failed tests".
//
// Where it happens. Reproduced readily on macOS/arm64 (roughly 2 runs in 6 for
// packages/cli). NOT observed on the Linux CI runners: four real CI runs,
// including three full ~15-minute test runs made under the worst previous
// configuration, contain zero occurrences. So on CI this script is insurance
// rather than a load-bearing part of the pipeline, and it stays cheap and
// narrow accordingly.
//
// What actually reduced it, measured over six runs of packages/cli's suite:
//
//   maxWorkers 7, worker recycling at 512MB   5/6 runs crashed
//   maxWorkers 7, no recycling limit          2/6
//   maxWorkers 4, no recycling limit          1/6
//
// Removing `workerIdleMemoryLimit` (see jest.config.base.cjs) is the real fix;
// constant recycling near the limit forced the GC churn that trips the bug.
//
// Why the retry does NOT drop to in-band. In-band has no worker process to lose
// and never hits the V8 crash — but it is not safe in this repo. Several
// packages/cli suites exercise worker and scheduler supervisors that register
// real `process.on('SIGTERM'/'SIGINT')` handlers ("11 SIGTERM listeners added
// to [process]"), and in-band those land on the jest main process instead of a
// disposable worker. Running that package in-band through turbo exited 129
// (SIGHUP) in 4 of 5 attempts. The retry therefore re-runs in the same mode.
//
// The retry is cheap: `test` is a cached turbo task, so packages that already
// passed replay from cache and only the crashed package actually re-runs. Two
// retries by default (override with TEST_CRASH_RETRIES); a single retry still
// left roughly 1 local run in 5 red because both attempts hit the crash.
//
// The retry is narrow. It fires only when BOTH hold:
//   1. jest reported a worker terminated by a fatal signal, and
//   2. no test anywhere reported a failure.
// A real regression fails on assertions, which trips condition 2 and is never
// retried — so this cannot turn a genuine failure green. A test that is itself
// flaky also fails on assertions, so it is not masked either.
import { spawn } from 'node:child_process'

const TURBO_ARGS = ['turbo', 'run', 'test', '--concurrency=1', '--continue']

// jest-worker's message when a worker dies on a signal rather than exiting.
const WORKER_CRASH = /was terminated by another process: signal=SIG(SEGV|ABRT|BUS|ILL|KILL)/
// jest's per-package summary. "Tests: 1 failed, 20 passed" means real failures;
// "Tests: 21 passed" alongside a failed SUITE means a worker died.
const FAILED_TESTS = /^\s*Tests:.*?(\d+) failed/gm

function run() {
  return new Promise((resolve) => {
    const child = spawn('yarn', TURBO_ARGS, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env })
    let combined = ''
    for (const stream of ['stdout', 'stderr']) {
      child[stream].on('data', (chunk) => {
        combined += chunk
        process[stream].write(chunk)
      })
    }
    child.on('close', (code) => resolve({ code: code ?? 1, output: combined }))
  })
}

function realTestFailures(output) {
  let total = 0
  for (const match of output.matchAll(FAILED_TESTS)) total += Number.parseInt(match[1], 10)
  return total
}

// Attempts, not retries: 1 initial + up to MAX_RETRIES. Each retry re-runs only
// the crashed package (everything that passed is a turbo cache hit), so an extra
// attempt costs seconds. Observed locally: a single retry left ~1 run in 5 red
// because both attempts hit the crash.
const MAX_RETRIES = Number.parseInt(process.env.TEST_CRASH_RETRIES ?? '2', 10)

let attempt = 0
let result = await run()

while (result.code !== 0) {
  const crashed = WORKER_CRASH.test(result.output)
  const failures = realTestFailures(result.output)

  if (!crashed) {
    console.error('\n::error::Unit tests failed. No worker crash detected, so this is a real failure.')
    process.exit(result.code)
  }

  if (failures > 0) {
    console.error(
      `\n::error::Unit tests failed with ${failures} failing test(s) AND a worker crash. ` +
        'Not retrying — the failing assertions have to be fixed first.',
    )
    process.exit(result.code)
  }

  if (attempt >= MAX_RETRIES) {
    console.error(
      `\n::error::A jest worker died on a fatal signal on all ${attempt + 1} attempts. ` +
        'No test ever reported a failure, so this is still the V8 crash rather than a regression — ' +
        'but it is now failing the build so it cannot go unnoticed.',
    )
    process.exit(result.code)
  }

  attempt += 1
  console.error(
    `\n::warning::A jest worker died on a fatal signal and no test reported a failure. That is the ` +
      `V8 garbage-collector crash, not a regression. Retry ${attempt} of ${MAX_RETRIES} — packages ` +
      'that already passed replay from the turbo cache, so only the crashed package re-runs.',
  )
  result = await run()
}

if (attempt > 0) {
  console.error(`\n::warning::Passed on attempt ${attempt + 1}. Earlier attempts lost a worker to a fatal signal.`)
}
process.exit(0)
