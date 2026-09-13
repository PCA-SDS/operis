/**
 * Decide how much of `packages/core` a pull request has to test, then run it.
 *
 * `packages/core` is one turbo package holding 48 modules and ~1,537 test files — 62% of
 * every test file in the repository. Turbo's unit of filtering and caching is the package,
 * so a one-line change in `modules/chat/` rehashes `@open-mercato/core#test` and reruns all
 * of it. Nothing below package level is expressible as a turbo filter, which is why this
 * narrowing lives here instead of in turbo.json.
 *
 * The narrowing is Jest's own `--findRelatedTests`, which walks real module resolution
 * rather than guessing from paths, so the 162 module-to-module import edges inside core
 * are followed for free and there is no hand-maintained module map to rot.
 *
 * WHAT THIS DELIBERATELY CANNOT SEE
 *
 * `--findRelatedTests` follows STATIC IMPORTS only. This codebase also couples modules
 * through the DI container, the `#generated/*` registries, event subscribers discovered by
 * convention, and widget injection by spot ID — none of which are edges in Jest's graph.
 * Two things compensate, and neither is optional:
 *
 *   1. STRUCTURAL_PATHS below forces the full suite whenever a diff touches a file that
 *      participates in that dynamic wiring. The list errs toward over-running, exactly as
 *      the `scope` job's image-path list in ci-deploy.yml does.
 *   2. ALWAYS_RUN runs the cross-cutting suites in `src/__tests__/` on every invocation —
 *      module-decoupling, feature-policy coverage, optimistic-lock coverage, UI gating.
 *      Those are the suites that police precisely the coupling Jest's graph misses.
 *
 * And the backstop behind both: the merge queue runs this suite unfiltered before the
 * commit lands, so a miss here blocks a merge rather than reddening main.
 *
 * FAIL-SAFE, NOT FAIL-OPEN
 *
 * Every uncertain path in this file resolves to `full`. An unreadable diff, an unparseable
 * ref, a path with characters a source file should not contain, zero changed files — all
 * of them run everything. A test selector that silently narrows to nothing is worse than
 * one that is slow, because its green is untrue.
 *
 * WHAT THIS RUNS
 *
 * Both halves of the scoped lane, so CI has one entry point:
 *
 *   1. Every package EXCEPT core, through turbo's own affected-package selection. That
 *      selection is correct at package granularity and needs no help from us.
 *   2. packages/core, narrowed as described above.
 *
 * Both halves always run — a failure in one does not skip the other — so a contributor
 * sees every failure from one push instead of peeling them off one run at a time.
 *
 * Usage:
 *   node scripts/ci-test-scope.mjs --base origin/main          # decide and run both halves
 *   node scripts/ci-test-scope.mjs --base origin/main --print  # decide only, print JSON
 */

import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CORE_PACKAGE_DIR = 'packages/core'

/**
 * Suites that run on EVERY invocation, whatever the diff says.
 *
 * These are the guards over dynamic coupling — the wiring `--findRelatedTests` structurally
 * cannot follow. Running them unconditionally is what makes narrowing the rest defensible.
 */
export const ALWAYS_RUN = Object.freeze(['src/__tests__/'])

/**
 * A changed file matching any of these forces the FULL core suite.
 *
 * Each entry is a file whose effect reaches other modules through something other than an
 * import: DI registration, the generated registries, event subscription, ACL features,
 * tenant setup, widget injection, cross-module data links. Add to this list freely — a
 * false "full" costs minutes, a false "related" ships a break.
 */
export const STRUCTURAL_PATHS = Object.freeze([
  /(^|\/)di\.ts$/,
  /(^|\/)index\.ts$/,
  /(^|\/)events\.ts$/,
  /(^|\/)acl\.ts$/,
  /(^|\/)setup\.ts$/,
  /(^|\/)subscribers\.ts$/,
  /(^|\/)ce\.ts$/,
  /(^|\/)modules\.ts$/,
  /(^|\/)widgets\//,
  /(^|\/)data\/extensions\.ts$/,
  /(^|\/)generated\//,
  /(^|\/)jest\.(config|setup|mocks)/,
  /(^|\/)package\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
])

/**
 * The mutate-list lesson from scripts/stryker/scope.mjs, applied for the same reason: a
 * changed path on a public repository is text an outside contributor chose, and it is about
 * to become an argument on a command line. An allowlist of the characters real source paths
 * in this tree actually use — including the square brackets of Next.js dynamic segments —
 * and anything else forces `full` rather than being passed along.
 */
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/[\]-]+$/

/**
 * Code-point ordering, not `localeCompare` — the same rule scripts/stryker/scope.mjs follows,
 * and for the same reason: the selected file list must be byte-identical across machines and
 * runners so a re-run selects the same tests in the same order. A locale-sensitive collation
 * would make that environment-dependent, and a test selection that varies by runner locale is
 * not a selection anyone can reason about.
 */
export function compareByCodePoint(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function hasSafePathCharacters(relativePath) {
  return typeof relativePath === 'string' && SAFE_PATH_PATTERN.test(relativePath)
}

export function isStructuralPath(relativePath) {
  return STRUCTURAL_PATHS.some((pattern) => pattern.test(relativePath))
}

/** Source files Jest can resolve. Tests themselves are handled by `--findRelatedTests`. */
export function isSelectableSource(relativePath) {
  if (!relativePath.startsWith('src/')) return false
  if (relativePath.endsWith('.d.ts')) return false
  return /\.(ts|tsx|js|jsx)$/.test(relativePath)
}

/**
 * @param {string[]} changedFiles repository-root-relative paths
 * @returns {{ mode: 'full' | 'related', files: string[], reason: string }}
 */
export function decideScope(changedFiles) {
  if (!Array.isArray(changedFiles)) {
    return { mode: 'full', files: [], reason: 'changed-file list was unreadable' }
  }

  const corePrefix = `${CORE_PACKAGE_DIR}/`
  const coreFiles = []

  for (const changedPath of changedFiles) {
    if (typeof changedPath !== 'string' || changedPath === '') continue
    if (!changedPath.startsWith(corePrefix)) continue

    if (!hasSafePathCharacters(changedPath)) {
      return { mode: 'full', files: [], reason: `unsafe characters in changed path: ${JSON.stringify(changedPath)}` }
    }

    const relativePath = changedPath.slice(corePrefix.length)
    if (isStructuralPath(relativePath)) {
      return {
        mode: 'full',
        files: [],
        reason: `${relativePath} participates in dynamic wiring that --findRelatedTests cannot follow`,
      }
    }
    if (isSelectableSource(relativePath)) coreFiles.push(relativePath)
  }

  if (coreFiles.length === 0) {
    // Nothing selectable changed inside core. The always-on cross-cutting suites still run;
    // they are cheap and they are the ones that catch wiring regressions from elsewhere.
    return { mode: 'related', files: [], reason: 'no selectable source changed inside packages/core' }
  }

  return {
    mode: 'related',
    files: [...new Set(coreFiles)].sort(compareByCodePoint),
    reason: `${coreFiles.length} changed source file(s) inside packages/core`,
  }
}

/**
 * Resolve the base ref BEFORE diffing against it.
 *
 * `actions/checkout` defaults to `fetch-depth: 1`, and against a shallow clone a base ref
 * is either absent or grafted. Both produce a diff that is empty or wrong rather than an
 * error, and an empty diff narrows to almost nothing — a green run that tested a handful of
 * guards and called it a pass. Checking first turns that into an explicit, logged `full`.
 */
export function assertBaseRefResolves(baseRef, runGit = defaultRunGit) {
  runGit(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`])
}

export function readChangedFiles(baseRef, runGit = defaultRunGit) {
  assertBaseRefResolves(baseRef, runGit)
  const output = runGit(['diff', '--name-only', '--diff-filter=d', `${baseRef}...HEAD`])
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function defaultRunGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

const JEST_BASE = Object.freeze(['--config', 'jest.config.cjs'])

/**
 * SEPARATE INVOCATIONS, and this is not a style choice.
 *
 * `--findRelatedTests` consumes every positional argument as an INPUT FILE to find tests
 * for — it does not combine with a path pattern. Passing both in one command:
 *
 *     jest src/__tests__/ --findRelatedTests src/modules/chat/lib/attachmentDto.ts
 *
 * runs 2 suites, not 26. Jest reports it plainly — "Ran all test suites related to files
 * matching src/__tests__/|src/modules/chat/lib/attachmentDto.ts" — and exits 0, so the
 * cross-cutting guards vanish from the run while the run still reports success. Measured on
 * this tree with `--listTests`: the path pattern alone lists 24, the combined form lists 2.
 *
 * That is precisely the silent-narrowing failure this whole file exists to prevent, so the
 * guards get their own command and their own exit code.
 */
export function buildGuardJestArgs() {
  return [...JEST_BASE, ...ALWAYS_RUN]
}

/**
 * `--passWithNoTests` is deliberately absent: `--findRelatedTests` over files that genuinely
 * have no test should surface as zero suites run, not be swallowed.
 */
export function buildRelatedJestArgs(files) {
  return [...JEST_BASE, '--findRelatedTests', ...files]
}

export function buildFullJestArgs() {
  return [...JEST_BASE]
}

/**
 * Every jest command a decision implies, in order. One entry for `full`; for `related`, the
 * always-on guards plus a second command when there is anything to relate to.
 */
export function buildJestInvocations(decision) {
  if (decision.mode === 'full') return [{ label: 'full core suite', args: buildFullJestArgs() }]

  const invocations = [{ label: 'cross-cutting guards', args: buildGuardJestArgs() }]
  if (decision.files.length > 0) {
    invocations.push({ label: 'tests related to the change', args: buildRelatedJestArgs(decision.files) })
  }
  return invocations
}

/**
 * turbo arguments for the non-core half.
 *
 * `!@open-mercato/core` removes core#test from the SELECTION while leaving core#build
 * available to anything that depends on it. Verified with `turbo run test --dry=json`:
 * under `--filter=@open-mercato/queue --filter=!@open-mercato/shared`, the task list
 * contains `@open-mercato/shared#build` and does NOT contain `@open-mercato/shared#test`.
 *
 * `--concurrency=1` matches the root `test` script: one package at a time, while jest
 * uses every core within it, so peak process count stays bounded at 1 + maxWorkers.
 */
export function buildTurboArgs(baseRef) {
  return [
    'run',
    'test',
    '--concurrency=1',
    '--continue',
    `--filter=...[${baseRef}]`,
    `--filter=!${CORE_PACKAGE_PACKAGE_NAME}`,
  ]
}

export const CORE_PACKAGE_PACKAGE_NAME = '@open-mercato/core'

export function parseArgs(argv) {
  const args = { base: 'origin/main', print: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base' && index + 1 < argv.length) {
      args.base = argv[index + 1]
      index += 1
    } else if (argv[index] === '--print') {
      args.print = true
    }
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

  let decision
  try {
    decision = decideScope(readChangedFiles(args.base))
  } catch (error) {
    // A failed diff is the fail-safe case, not a failure: resolve the ref against a shallow
    // clone, a force-push, a missing base — any of them — by running everything.
    decision = { mode: 'full', files: [], reason: `could not diff against ${args.base}: ${error.message}` }
  }

  process.stderr.write(`[ci-test-scope] mode=${decision.mode} — ${decision.reason}\n`)
  if (decision.mode === 'related' && decision.files.length > 0) {
    for (const file of decision.files) process.stderr.write(`[ci-test-scope]   ${file}\n`)
  }

  if (args.print) {
    process.stdout.write(`${JSON.stringify(decision)}\n`)
    return
  }

  const failures = []

  process.stderr.write('[ci-test-scope] --- every package except core (turbo affected selection) ---\n')
  const turbo = spawnSync('yarn', ['turbo', ...buildTurboArgs(args.base)], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if (turbo.error) failures.push(`turbo failed to start: ${turbo.error.message}`)
  else if (turbo.status !== 0) failures.push(`non-core package tests exited ${turbo.status}`)

  for (const invocation of buildJestInvocations(decision)) {
    process.stderr.write(`[ci-test-scope] --- packages/core: ${invocation.label} ---\n`)
    const jest = spawnSync('yarn', ['jest', ...invocation.args], {
      cwd: path.join(repositoryRoot, CORE_PACKAGE_DIR),
      stdio: 'inherit',
      env: process.env,
    })
    if (jest.error) failures.push(`${invocation.label}: jest failed to start: ${jest.error.message}`)
    else if (jest.status !== 0) failures.push(`${invocation.label}: exited ${jest.status}`)
  }

  // Both halves ran before anything is reported, so one push surfaces every failure.
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`[ci-test-scope] FAILED: ${failure}\n`)
    process.exit(1)
  }
  process.stderr.write('[ci-test-scope] all selected tests passed\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
