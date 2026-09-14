import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

// The two supply-chain gates in ci-deploy.yml only gate while they can fail the run.
// Both have already spent time not doing that:
//
//   - the dependency audit shipped `continue-on-error: true`, deliberately and
//     temporarily, while a backlog of six advisories was outstanding;
//   - the image scan was blocking but could not read the image it was pointed at, so it
//     failed identically whether or not the image was clean.
//
// Either shape produces the same outcome — a green-looking pipeline that is not checking
// anything — and the tempting repair for both is to make the step non-blocking. That is
// what this guards. It asserts the gates can still say no, not what they say.

const WORKFLOW = path.resolve('.github/workflows/ci-deploy.yml')

function workflow() {
  return parse(fs.readFileSync(WORKFLOW, 'utf8'))
}

function stepIn(jobName, stepId) {
  const job = workflow()?.jobs?.[jobName]
  return (job?.steps ?? []).find((step) => step?.id === stepId)
}

test('the dependency audit can fail the run', () => {
  const step = stepIn('audit', 'audit')
  assert.ok(step, 'no step with id "audit" in the audit job')

  // If a fix genuinely does not exist yet, the answer is an entry in
  // scripts/audit-ci-allowlist.json carrying a justification and a re-check condition —
  // scoped to that one advisory. Restoring continue-on-error silences every future
  // advisory in order to clear one.
  assert.equal(
    step['continue-on-error'],
    undefined,
    'the dependency audit is non-blocking again — allowlist the specific advisory in ' +
      'scripts/audit-ci-allowlist.json instead of suppressing the whole gate',
  )
})

test('the image scan can fail the run', () => {
  const step = stepIn('build', 'scan')
  assert.ok(step, 'no step with id "scan" in the build job')
  assert.equal(
    step['continue-on-error'],
    undefined,
    'the image scan is non-blocking — a scanner that cannot fail the build is not a gate',
  )
})

test('every gate job is aggregated by the required check', () => {
  const needs = workflow()?.jobs?.['ci-required']?.needs ?? []

  // A job that fails while nothing depends on it is invisible to branch protection,
  // which is the same end state as continue-on-error by a different route.
  for (const job of ['lint', 'typecheck', 'guards', 'audit', 'test']) {
    assert.ok(needs.includes(job), `ci-required does not depend on the "${job}" job`)
  }
})
