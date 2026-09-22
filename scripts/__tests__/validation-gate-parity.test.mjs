import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import YAML from 'yaml'

/**
 * Validation-gate parity guard.
 *
 * `.ai/agentic.config.json` → `validation.commands` is what every contributor and coding agent
 * is told to run before pushing. The CI jobs that actually block a merge are the ones
 * `ci-required` waits on in `.github/workflows/ci-deploy.yml`. Those are two hand-maintained
 * copies of one list, and
 * nothing kept them in sync — so the documented gate drifted until running all of it locally
 * still let a PR fail CI on a step the list never mentioned. That is the failure this guard
 * exists to make impossible.
 *
 * The contract is **coverage, not equality**: every `yarn` script a gate job runs must appear
 * in `validation.commands`. The config may carry extra local-only checks — `build:app`
 * catches a Next build break that CI only finds later in the image build, and the i18n checks
 * mirror the pre-commit hook — and extras are additional safety, not drift.
 *
 * Order is deliberately NOT asserted. The real ordering constraint (build → generate → build
 * before anything typechecks) fails loudly and immediately when violated, so pinning order here
 * would only add a brittle way to break the build without catching a silent failure.
 *
 * THE GATE SET IS DERIVED, NOT NAMED. This used to read a single job called `quality`. That
 * job was split into six concurrent ones, and a hardcoded name would have gone on passing by
 * reading a job that no longer existed — or, worse, silently covered one job out of six. The
 * gate is now whatever `ci-required` declares in `needs`, which is the same list branch
 * protection enforces, so a seventh gate job is covered the moment it is wired in and cannot
 * be added without being wired in.
 *
 * The shared prologue (install, build, generate) moved into the local composite action at
 * .github/actions/setup, so that file is parsed alongside the workflow — otherwise every
 * command it runs would silently leave the guard's view.
 */

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci-deploy.yml')
const configPath = path.join(repoRoot, '.ai', 'agentic.config.json')

/**
 * The aggregator that branch protection requires. Its `needs` list IS the gate.
 * Keyed structurally — `name:` is display text and can change without meaning anything.
 */
const AGGREGATOR_JOB = 'ci-required'

/**
 * Jobs that run after the gate rather than as part of it.
 *
 * `deploy` became `deploy-staging` + `deploy-production` when staging was added: one
 * image, deployed to staging automatically and then to production behind a required
 * reviewer. Both are deployments, not checks — they consume the gate's verdict rather
 * than contributing to it, so branch protection has no business waiting on them.
 */
const POST_GATE_JOBS = new Set([
  'build',
  'translation-image',
  'deploy-staging',
  'deploy-production',
])

/** Bookkeeping jobs that gate nothing on their own. */
const NON_CHECK_JOBS = new Set(['scope', 'prepare', AGGREGATOR_JOB])

const setupActionPath = path.join(repoRoot, '.github', 'actions', 'setup', 'action.yml')

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

function yarnScriptsIn(steps) {
  const scripts = []
  for (const step of steps ?? []) {
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

function readWorkflow() {
  return YAML.parse(fs.readFileSync(workflowPath, 'utf8'))
}

/** The jobs `ci-required` waits on, minus the bookkeeping ones. */
function gateJobIds(workflow) {
  const aggregator = workflow?.jobs?.[AGGREGATOR_JOB]
  assert.ok(
    aggregator,
    `ci-deploy.yml has no "${AGGREGATOR_JOB}" job. That job is the single required status check; `
      + 'without it nothing blocks a merge and this guard has nothing to derive the gate from.',
  )

  const needs = Array.isArray(aggregator.needs) ? aggregator.needs : [aggregator.needs].filter(Boolean)
  return needs.filter((jobId) => !NON_CHECK_JOBS.has(jobId))
}

function readGateJobYarnScripts() {
  const workflow = readWorkflow()
  const scripts = []

  for (const jobId of gateJobIds(workflow)) {
    const job = workflow.jobs?.[jobId]
    assert.ok(job, `ci-required lists "${jobId}" in needs, but no such job exists.`)
    for (const script of yarnScriptsIn(job.steps)) {
      if (!scripts.includes(script)) scripts.push(script)
    }
  }

  // The shared prologue lives in the composite action, not in any job's steps.
  const setupAction = YAML.parse(fs.readFileSync(setupActionPath, 'utf8'))
  for (const script of yarnScriptsIn(setupAction?.runs?.steps)) {
    if (!scripts.includes(script)) scripts.push(script)
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

test('the parser actually found the gate jobs\' commands', () => {
  // Guards every assertion below against a silently empty parse.
  assert.ok(
    ciScripts.length >= MIN_EXPECTED_CI_COMMANDS,
    `Only parsed ${ciScripts.length} yarn command(s) from the gate jobs (expected at least ${MIN_EXPECTED_CI_COMMANDS}). `
      + `The workflow's shape probably changed and this guard is no longer reading it: ${JSON.stringify(ciScripts)}`,
  )
})

test('every command CI runs is in the documented local gate', () => {
  const missing = ciScripts.filter((script) => !configuredScripts.includes(script))

  assert.deepEqual(
    missing,
    [],
    'These run in a ci-deploy.yml gate job but are absent from validation.commands in '
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

test('every checking job is wired into the required status check', () => {
  // The hole this closes: someone adds a seventh gate job, it runs and goes red on pull
  // requests, and the merge is allowed anyway because branch protection only requires
  // `ci-required` and `ci-required` never waited on it. A job that checks something must
  // be in that needs list, or it is decoration.
  const workflow = readWorkflow()
  const declared = new Set(gateJobIds(workflow))

  const unwired = Object.keys(workflow.jobs ?? {}).filter(
    (jobId) => !declared.has(jobId) && !NON_CHECK_JOBS.has(jobId) && !POST_GATE_JOBS.has(jobId),
  )

  assert.deepEqual(
    unwired,
    [],
    `These jobs run but are not in ${AGGREGATOR_JOB}'s needs, so branch protection ignores whether they pass:\n`
      + unwired.map((jobId) => `  ${jobId}`).join('\n')
      + `\n\nAdd each to the ${AGGREGATOR_JOB} needs list, or to POST_GATE_JOBS in this test if it genuinely `
      + 'runs after the gate rather than as part of it.',
  )
})

test('the aggregator inspects results rather than relying on needs alone', () => {
  // `needs` alone does NOT make a job fail when a dependency fails IF the job also carries
  // `if: always()` — which this one must, so that a legitimately skipped job does not skip
  // the required check itself. The explicit result inspection is therefore load-bearing:
  // without it the aggregator would report success no matter what its dependencies did.
  const aggregator = readWorkflow().jobs?.[AGGREGATOR_JOB]
  // run + env together: the results reach the script through `env: ${{ toJSON(needs) }}`,
  // so inspecting only `run` would miss the very reference this asserts on.
  const body = (aggregator.steps ?? [])
    .map((step) => [step.run ?? '', JSON.stringify(step.env ?? {})].join('\n'))
    .join('\n')

  assert.match(String(aggregator.if ?? ''), /always\(\)/, `${AGGREGATOR_JOB} must run even when a dependency is skipped.`)
  assert.match(
    body,
    /needs/i,
    `${AGGREGATOR_JOB} carries if: always(), so it MUST inspect the needs results explicitly — otherwise it `
      + 'reports success regardless of whether the gate jobs passed.',
  )
  assert.match(body, /exit 1/, `${AGGREGATOR_JOB} must exit non-zero when a gate job did not pass.`)
})
