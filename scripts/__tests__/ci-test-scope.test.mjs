import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  ALWAYS_RUN,
  CORE_PACKAGE_DIR,
  STRUCTURAL_PATHS,
  buildGuardJestArgs,
  buildJestInvocations,
  buildRelatedJestArgs,
  decideScope,
  hasSafePathCharacters,
  isSelectableSource,
  isStructuralPath,
  parseArgs,
  readChangedFiles,
} from '../ci-test-scope.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

/**
 * These tests exist because this selector can produce a GREEN RUN THAT TESTED NOTHING —
 * the one failure mode a test selector must never have. Every assertion below is about
 * that: what forces the full suite, what can never be narrowed away, and what happens when
 * the diff cannot be trusted.
 */

test('an unreadable changed-file list runs everything', () => {
  for (const input of [null, undefined, 'packages/core/src/a.ts', 42]) {
    assert.equal(decideScope(input).mode, 'full', `${JSON.stringify(input)} must fall back to the full suite`)
  }
})

test('a path with characters a source file should not contain runs everything', () => {
  const injected = 'packages/core/src/modules/chat/a.ts; rm -rf /'
  const decision = decideScope([injected])

  assert.equal(decision.mode, 'full')
  assert.match(decision.reason, /unsafe characters/)
  assert.ok(!hasSafePathCharacters(injected))
})

test('Next.js dynamic route segments are legitimate paths, not injection', () => {
  // 87 page.meta.ts files in this tree live under `[id]` directories. Rejecting them would
  // force the full suite on a large share of real diffs and quietly erase the narrowing.
  assert.ok(hasSafePathCharacters('packages/core/src/modules/auth/pages/roles/[id]/edit/page.meta.ts'))
})

test('every structural path forces the full suite', () => {
  const structural = [
    'src/modules/chat/di.ts',
    'src/modules/chat/index.ts',
    'src/modules/chat/events.ts',
    'src/modules/chat/acl.ts',
    'src/modules/chat/setup.ts',
    'src/modules/chat/subscribers.ts',
    'src/modules/chat/ce.ts',
    'src/modules/chat/widgets/panel.tsx',
    'src/modules/chat/data/extensions.ts',
    'generated/entities.ids.generated.ts',
    'package.json',
    'tsconfig.json',
  ]

  for (const relativePath of structural) {
    assert.ok(isStructuralPath(relativePath), `${relativePath} must be recognised as structural`)
    const decision = decideScope([`${CORE_PACKAGE_DIR}/${relativePath}`])
    assert.equal(decision.mode, 'full', `${relativePath} must force the full suite`)
  }
})

test('one structural file among many ordinary ones still forces the full suite', () => {
  const decision = decideScope([
    'packages/core/src/modules/chat/lib/format.ts',
    'packages/core/src/modules/chat/lib/parse.ts',
    'packages/core/src/modules/chat/di.ts',
  ])

  assert.equal(decision.mode, 'full', 'a structural change is not diluted by ordinary ones alongside it')
})

test('an ordinary source change narrows to exactly those files', () => {
  const decision = decideScope([
    'packages/core/src/modules/chat/lib/format.ts',
    'packages/core/src/modules/chat/lib/format.ts',
    'packages/ui/src/primitives/button.tsx',
    'README.md',
  ])

  assert.equal(decision.mode, 'related')
  assert.deepEqual(
    decision.files,
    ['src/modules/chat/lib/format.ts'],
    'only files inside packages/core are selectable, and duplicates collapse',
  )
})

test('the guards and the related tests are SEPARATE jest commands', () => {
  // THE REGRESSION THIS EXISTS FOR. `--findRelatedTests` consumes positional arguments as
  // input files, so `jest src/__tests__/ --findRelatedTests <file>` does not run the guards
  // AND the related tests — it finds tests related to both paths. Measured with --listTests
  // on this tree: the path pattern alone lists 24 suites, the combined form lists 2. Jest
  // exits 0 either way, so the cross-cutting guards disappear from a run that still reports
  // success. One command per concern is the only way to keep both.
  const invocations = buildJestInvocations(decideScope(['packages/core/src/modules/chat/lib/format.ts']))

  assert.equal(invocations.length, 2, 'a narrowed run is exactly two commands: the guards, then the related tests')

  const [guards, related] = invocations
  for (const alwaysRun of ALWAYS_RUN) assert.ok(guards.args.includes(alwaysRun))
  assert.ok(
    !guards.args.includes('--findRelatedTests'),
    'the guard command must carry no --findRelatedTests, or its path pattern is reinterpreted as an input file '
      + 'and the guards silently stop running.',
  )

  assert.ok(related.args.includes('--findRelatedTests'))
  for (const alwaysRun of ALWAYS_RUN) {
    assert.ok(
      !related.args.includes(alwaysRun),
      'the related command must carry no always-run path, for the same reason in reverse.',
    )
  }
})

test('the guard command on its own selects the whole cross-cutting directory', () => {
  const args = buildGuardJestArgs()

  for (const alwaysRun of ALWAYS_RUN) assert.ok(args.includes(alwaysRun))
  assert.ok(!args.includes('--findRelatedTests'))
})

test('a diff that touches no core source still runs the cross-cutting suites', () => {
  const decision = decideScope(['packages/ui/src/primitives/button.tsx'])
  const invocations = buildJestInvocations(decision)

  assert.equal(decision.mode, 'related')
  assert.deepEqual(decision.files, [])
  assert.equal(invocations.length, 1, 'an empty file list must not produce a dangling --findRelatedTests command')
  for (const alwaysRun of ALWAYS_RUN) assert.ok(invocations[0].args.includes(alwaysRun))
})

test('the narrowed invocation never claims success on an empty run', () => {
  const args = buildRelatedJestArgs(['src/modules/chat/lib/format.ts'])

  assert.ok(
    !args.includes('--passWithNoTests'),
    'passWithNoTests would let a selector that matched nothing exit 0 — the exact silent-skip this file exists to prevent.',
  )
})

test('the full invocation is one command carrying no narrowing flags at all', () => {
  const invocations = buildJestInvocations({ mode: 'full', files: [], reason: 'x' })

  assert.equal(invocations.length, 1)
  assert.deepEqual(invocations[0].args, ['--config', 'jest.config.cjs'])
})

test('a failed diff resolves to the full suite rather than an empty one', () => {
  assert.throws(() =>
    readChangedFiles('refs/does-not-exist', () => {
      throw new Error('fatal: bad revision')
    }),
  )
  // main() wraps readChangedFiles in try/catch and substitutes a full decision; this asserts
  // the throw actually reaches that handler rather than being swallowed into an empty list.
})

test('the changed-file reader drops deleted files and blank lines', () => {
  const files = readChangedFiles('origin/main', (args) => (args[0] === 'rev-parse' ? '' : 'a.ts\n\n  b.ts  \n'))

  assert.deepEqual(files, ['a.ts', 'b.ts'])
})

test('an unresolvable base ref throws before any diff is attempted', () => {
  // The shallow-clone case: origin/main absent, `git diff` would return an empty list, and
  // an empty list narrows to almost nothing. This must reach main()'s catch and run FULL.
  let diffAttempted = false
  const runGit = (args) => {
    if (args[0] === 'rev-parse') throw new Error('fatal: Needed a single revision')
    diffAttempted = true
    return ''
  }

  assert.throws(() => readChangedFiles('origin/main', runGit))
  assert.equal(diffAttempted, false, 'a diff must not be attempted against a ref that does not resolve')
})

test('argument parsing defaults to the branch this repository actually merges into', () => {
  assert.deepEqual(parseArgs([]), { base: 'origin/main', print: false })
  assert.deepEqual(parseArgs(['--base', 'origin/release', '--print']), { base: 'origin/release', print: true })
  // A trailing --base with no value must not consume undefined as the ref.
  assert.equal(parseArgs(['--base']).base, 'origin/main')
})

test('only real source extensions are selectable', () => {
  assert.ok(isSelectableSource('src/modules/chat/a.ts'))
  assert.ok(isSelectableSource('src/modules/chat/a.tsx'))
  assert.ok(!isSelectableSource('src/modules/chat/a.d.ts'), 'a declaration file resolves to no test')
  assert.ok(!isSelectableSource('src/modules/chat/a.md'))
  assert.ok(!isSelectableSource('migrations/001.ts'), 'only src/ is selectable')
})

test('the always-run directory actually exists and holds the coupling guards', () => {
  // A renamed directory would make ALWAYS_RUN select nothing while every assertion above
  // still passed — the guard would report green having run none of the suites it names.
  for (const alwaysRun of ALWAYS_RUN) {
    const absolute = path.join(repoRoot, CORE_PACKAGE_DIR, alwaysRun)
    assert.ok(fs.existsSync(absolute), `${CORE_PACKAGE_DIR}/${alwaysRun} does not exist`)

    const entries = fs.readdirSync(absolute).filter((entry) => entry.endsWith('.test.ts'))
    assert.ok(entries.length > 0, `${CORE_PACKAGE_DIR}/${alwaysRun} contains no test files`)
    assert.ok(
      entries.includes('module-decoupling.test.ts'),
      'module-decoupling.test.ts is the guard over exactly the cross-module wiring --findRelatedTests cannot see. '
        + 'If it moved, the narrowing lost its primary safety net.',
    )
  }
})

test('the structural list is non-empty and every entry is a regular expression', () => {
  assert.ok(STRUCTURAL_PATHS.length > 0)
  for (const pattern of STRUCTURAL_PATHS) assert.ok(pattern instanceof RegExp)
})
