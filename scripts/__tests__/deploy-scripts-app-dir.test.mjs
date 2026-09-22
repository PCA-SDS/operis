// deploy/dc, deploy/deploy.sh and deploy/backup.sh each operate on a whole stack —
// its containers, its database, its volumes. Which stack is decided by APP_DIR.
//
// That default used to be the literal string /opt/operis. With a second stack on the
// same host it meant a script sitting in /opt/operis-staging still acted on PRODUCTION:
//
//   cd /opt/operis-staging && ./dc down -v      # destroys production's volumes
//
// Read, typed and reviewed, that line looks like a staging command. It was in this
// repo's own runbook. Nothing about running it would have warned anybody.
//
// These tests pin the fix: a script resolves the stack from where the script LIVES.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

/** A stack directory holding a copy of `script` plus the files it insists on. */
function makeStack(root, name) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'deploy', 'dc'), path.join(dir, 'dc'))
  fs.chmodSync(path.join(dir, 'dc'), 0o755)
  fs.writeFileSync(path.join(dir, '.env'), 'STACK_NAME=' + name + '\n')
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'name: ' + name + '\n')
  return dir
}

/**
 * Runs `dc` with a stubbed `docker` on PATH that reports the working directory it was
 * invoked from. `dc` cds to APP_DIR before exec'ing docker, so that directory IS the
 * stack the command would have acted on.
 */
function stackActedOn(stackDir, { cwd, appDirEnv }) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-bin-'))
  const stub = path.join(binDir, 'docker')
  fs.writeFileSync(stub, '#!/bin/sh\npwd\n')
  fs.chmodSync(stub, 0o755)

  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` }
  if (appDirEnv) env.APP_DIR = appDirEnv
  else delete env.APP_DIR

  const out = execFileSync(path.join(stackDir, 'dc'), ['ps'], { cwd, env, encoding: 'utf8' })
  return fs.realpathSync(out.trim())
}

test('dc acts on the stack it lives in, not a hardcoded path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stacks-'))
  const production = makeStack(root, 'operis')
  const staging = makeStack(root, 'operis-staging')

  // Invoked from somewhere else entirely by absolute path — the case that used to
  // silently reach production.
  assert.equal(stackActedOn(staging, { cwd: os.tmpdir() }), fs.realpathSync(staging))
  assert.equal(stackActedOn(production, { cwd: os.tmpdir() }), fs.realpathSync(production))

  // And the shape the runbook actually uses.
  assert.equal(stackActedOn(staging, { cwd: staging }), fs.realpathSync(staging))
})

test('an explicit APP_DIR still wins, because CI passes one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stacks-'))
  const production = makeStack(root, 'operis')
  const staging = makeStack(root, 'operis-staging')

  assert.equal(
    stackActedOn(production, { cwd: os.tmpdir(), appDirEnv: staging }),
    fs.realpathSync(staging),
  )
})

test('no deploy script hardcodes a stack directory as its default', () => {
  // deploy.sh and backup.sh take the same argument and carry the same risk, but they
  // exec docker per-service rather than once, so they are pinned by inspection here
  // rather than by running them.
  for (const name of ['dc', 'deploy.sh', 'backup.sh']) {
    const source = fs.readFileSync(path.join(repoRoot, 'deploy', name), 'utf8')
    assert.ok(
      !/APP_DIR="\$\{APP_DIR:-\/opt\/[a-z-]+\}"/.test(source),
      `deploy/${name} pins APP_DIR to a literal path. A copy of this script in another ` +
        `stack's directory would act on the pinned stack instead of its own.`,
    )
    assert.ok(
      source.includes('APP_DIR="${APP_DIR:-$(cd -- "$(dirname -- "$0")" && pwd)}"'),
      `deploy/${name} should default APP_DIR to the directory the script lives in.`,
    )
  }
})
