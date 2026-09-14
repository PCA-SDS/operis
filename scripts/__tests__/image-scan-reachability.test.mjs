import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

// The image scan can only fail the build for a real vulnerability if it can READ the
// image in the first place. It could not, from the day it was added until the day this
// test was written: every run died with
//
//   unable to find the specified image "ghcr.io/pca-sds/operis:sha-…"
//     * docker error: No such image
//     * remote error: GET https://ghcr.io/token?…: UNAUTHORIZED: authentication required
//
// Two causes, and a fix for either alone leaves the step broken:
//
//  1. The build ships the image with `docker buildx build --push`, which streams
//     straight to the registry and loads NOTHING into the local daemon. So the
//     `docker` lookup can never resolve, no matter what is mounted.
//  2. Trivy runs inside its own container. The `docker login` the job performs applies
//     to the RUNNER's home directory, which the scanner container cannot see, so the
//     remote lookup reaches GHCR unauthenticated and is refused.
//
// A scanner that cannot reach its target is worse than no scanner: it reports a
// specific, credible-looking failure that has nothing to do with the image's contents,
// and the obvious "fix" is to make the step non-blocking. So this asserts the
// reachability preconditions rather than the scan's verdict.

const WORKFLOW = path.resolve('.github/workflows/ci-deploy.yml')

function scanStep() {
  const workflow = parse(fs.readFileSync(WORKFLOW, 'utf8'))
  const steps = workflow?.jobs?.build?.steps ?? []
  return steps.find((step) => step?.id === 'scan')
}

// Assert against what the shell RUNS, never against what it says. Matching the raw
// body means a comment explaining why the socket is absent reads exactly like a mount,
// and — the direction that actually matters — a real mount could be waved through by
// wording near it.
function commandsOf(step) {
  return (step?.run ?? '')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
}

test('the image scan step still exists in the build job', () => {
  assert.ok(scanStep(), 'no step with id "scan" in the build job of ci-deploy.yml')
})

test('the image scan authenticates to the registry it pulls from', () => {
  const env = scanStep()?.env ?? {}

  // Trivy reads these two for registry auth; its own --help names TRIVY_PASSWORD as
  // the supported way to supply a password. Passing them on the `docker run` command
  // line instead would put the token in the runner's argv, readable through /proc.
  assert.ok(
    env.TRIVY_USERNAME,
    'scan step sets no TRIVY_USERNAME — the remote pull will 401 on a private image',
  )
  assert.ok(
    env.TRIVY_PASSWORD,
    'scan step sets no TRIVY_PASSWORD — the remote pull will 401 on a private image',
  )

  const run = commandsOf(scanStep())
  assert.match(
    run,
    /-e TRIVY_USERNAME/,
    'TRIVY_USERNAME is in the step env but never forwarded into the scanner container',
  )
  assert.match(
    run,
    /-e TRIVY_PASSWORD/,
    'TRIVY_PASSWORD is in the step env but never forwarded into the scanner container',
  )
})

test('the image scan does not rely on an image being present in the local daemon', () => {
  const run = commandsOf(scanStep())

  // Mounting the socket is what made the original failure look like a Trivy problem
  // rather than a "nothing ever loaded this image" problem. It also hands a container
  // root-equivalent control of the runner, in a job that holds `packages: write`.
  assert.doesNotMatch(
    run,
    /docker\.sock/,
    'scan step mounts the docker socket: the pushed image is never loaded locally, ' +
      'so this can only reintroduce the "No such image" path',
  )
})

test('the build publishes the image the scan reads back', () => {
  const workflow = parse(fs.readFileSync(WORKFLOW, 'utf8'))
  const build = (workflow?.jobs?.build?.steps ?? []).find((step) => step?.id === 'build')
  const run = commandsOf(build)

  // If this ever gains `--load`, the local-daemon path becomes viable again and the
  // trade-off above should be re-argued deliberately rather than drifting back.
  assert.match(run, /--push/, 'build step no longer pushes; the scan target may not exist')
  assert.doesNotMatch(
    run,
    /--load/,
    'build step now loads the image locally — revisit whether the scan should read ' +
      'the daemon instead of the registry',
  )
})
