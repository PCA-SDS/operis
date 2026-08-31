import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import YAML from 'yaml'

/**
 * Validation-gate parity guard.
 *
 * `.ai/agentic.config.json` → `validation.commands` is what every contributor and coding agent
 * is told to run before pushing. The CI job that actually blocks a merge is `quality` in
 * `.github/workflows/ci-deploy.yml`. Those are two hand-maintained copies of one list, and
 * nothing kept them in sync — so the documented gate drifted until running all of it locally
 * still let a PR fail CI on a step the list never mentioned. That is the failure this guard
 * exists to make impossible.
 *
 * The contract is **coverage, not equality**: every `yarn` script the `quality` job runs must
 * appear in `validation.commands`. The config may carry extra local-only checks — `build:app`
 * catches a Next build break that CI only finds later in the image build, and the i18n checks
 * mirror the pre-commit hook — and extras are additional safety, not drift.
 *
 * Order is deliberately NOT asserted. The real ordering constraint (build → generate → build
 * before anything typechecks) fails loudly and immediately when violated, so pinning order here
 * would only add a brittle way to break the build without catching a silent failure.
 */

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci-deploy.yml')
const configPath = path.join(repoRoot, '.ai', 'agentic.config.json')

/** The job whose failure blocks a merge. Keyed structurally — `name:` is display text. */
const GATE_JOB = 'quality'

/**
 * Steps that run `yarn` but are not validation.
 *
 * `install` provisions the runner; a developer running the gate locally already has
 * dependencies. Keep this list minimal and reasoned — every entry is a hole in the guard.
 */
const NOT_A_VALIDATION_STEP = new Set(['install'])

/**
 * A floor on what a healthy parse looks like. Without it, a workflow refactor that moved the
 * steps somewhere this parser cannot see would make every assertion below vacuously true — the
 * same silent-skip failure `--passWithNoTests=false` exists to prevent in the guard runner.
 */
const MIN_EXPECTED_CI_COMMANDS = 6

function readGateJobYarnScripts() {
  const workflow = YAML.parse(fs.readFileSync(workflowPath, 'utf8'))
  const job = workflow?.jobs?.[GATE_JOB]
  assert.ok(job, `ci-deploy.yml has no "${GATE_JOB}" job — this guard is reading the wrong file or the job was renamed.`)

  const steps = job.steps ?? []
  assert.ok(steps.length > 0, `The "${GATE_JOB}" job has no steps.`)

  const scripts = []
  for (const step of steps) {
    if (typeof step?.run !== 'string') continue
    for (const line of step.run.split('\n')) {
      // One line may chain several: `yarn lint:check-graph && yarn lint`.
      for (const match of line.matchAll(/(?:^|&&|\|\||;)\s*yarn\s+([\w:.-]+)/g)) {
        const script = match[1]
        if (NOT_A_VALIDATION_STEP.has(script)) continue
        if (!scripts.includes(script)) scripts.push(script)
      }
    }
  }
  return scripts
}

function readConfiguredCommands() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const commands = config?.validation?.commands
  assert.ok(Array.isArray(commands), 'agentic.config.json has no validation.commands array.')
  return commands
}

/** `yarn typecheck:serial` → `typecheck:serial`. Anything not a plain yarn call returns null. */
function yarnScriptOf(command) {
  const match = /^yarn\s+([\w:.-]+)\s*$/.exec(String(command).trim())
  return match ? match[1] : null
}

const ciScripts = readGateJobYarnScripts()
const configuredCommands = readConfiguredCommands()
const configuredScripts = configuredCommands.map(yarnScriptOf).filter((script) => script !== null)

test('the parser actually found the gate job\'s commands', () => {
  // Guards every assertion below against a silently empty parse.
  assert.ok(
    ciScripts.length >= MIN_EXPECTED_CI_COMMANDS,
    `Only parsed ${ciScripts.length} yarn command(s) from the "${GATE_JOB}" job (expected at least ${MIN_EXPECTED_CI_COMMANDS}). `
      + `The workflow's shape probably changed and this guard is no longer reading it: ${JSON.stringify(ciScripts)}`,
  )
})

test('every command CI runs is in the documented local gate', () => {
  const missing = ciScripts.filter((script) => !configuredScripts.includes(script))

  assert.deepEqual(
    missing,
    [],
    'These run in the ci-deploy.yml "quality" job but are absent from validation.commands in '
      + '.ai/agentic.config.json, so following the documented gate locally does NOT reproduce CI:\n'
      + missing.map((script) => `  yarn ${script}`).join('\n')
      + '\n\nAdd them to validation.commands, or add the script to NOT_A_VALIDATION_STEP in this '
      + 'test with a reason if it genuinely is not a check.',
  )
})

test('every documented command is a real script', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts ?? {}
  const unknown = configuredScripts.filter((script) => !(script in scripts))

  assert.deepEqual(
    unknown,
    [],
    'validation.commands names scripts that do not exist in package.json. A typo here makes the '
      + 'documented gate fail with "command not found" — or worse, a runner that skips unknown '
      + 'entries would report a green gate having run nothing:\n'
      + unknown.map((script) => `  yarn ${script}`).join('\n'),
  )
})

test('every documented command is a plain yarn invocation', () => {
  // A shell-chained or flag-bearing entry would silently fall out of the comparisons above,
  // reopening the drift this guard closes.
  const unparsed = configuredCommands.filter((command) => yarnScriptOf(command) === null)

  assert.deepEqual(
    unparsed,
    [],
    'validation.commands entries must each be a single `yarn <script>` call so this guard can '
      + 'compare them against the workflow. Split anything compound into separate entries:\n'
      + unparsed.map((command) => `  ${command}`).join('\n'),
  )
})
