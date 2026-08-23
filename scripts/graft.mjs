#!/usr/bin/env node
/**
 * Graft CLI bridge for Operis.
 *
 * Graft is the structural code-navigation layer agents query instead of sweeping the
 * repo with grep/read (see `.ai/docs/code-navigation.md`). It is a developer tool, not a
 * build input, and it pulls a native `tree-sitter` binding — as a root devDependency that
 * would add a node-gyp step to every `yarn install`, including the Dockerfile and CI. So
 * it is resolved at call time against a single pinned version instead.
 *
 * Usage:
 *   node scripts/graft.mjs <graft-args...>
 *   node scripts/graft.mjs ask "where is tenant scoping enforced"
 *   node scripts/graft.mjs skeleton packages/shared/src/lib/crud/optimistic-lock.ts
 *
 * Resolution order:
 *   1. GRAFT_BIN                   – explicit override, used verbatim
 *   2. `graft` on PATH             – only when its version matches GRAFT_VERSION
 *   3. npx -y @nanonets/graft@pin  – always correct, but pays a fetch on a cold cache
 *
 * A global install (`npm i -g @nanonets/graft@<pin>`) is worth it once the Claude Code
 * hooks are wired: they invoke graft many times per session and branch 3 is the slow path.
 *
 * Environment overrides:
 *   GRAFT_BIN     – path to a graft binary; skips detection entirely
 *   GRAFT_QUIET   – set to any value to suppress the one-line resolution notice
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const GRAFT_VERSION = '0.12.0'
export const GRAFT_PACKAGE = `@nanonets/graft@${GRAFT_VERSION}`

/**
 * `graft version` prints "graft <semver>" followed by an npm freshness line.
 */
export function parseGraftVersion(stdout) {
  const match = /^graft\s+(\d+\.\d+\.\d+)/m.exec(stdout ?? '')
  return match ? match[1] : null
}

function probePathVersion() {
  const result = spawnSync('graft', ['version'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return null
  return parseGraftVersion(result.stdout)
}

/**
 * Pick the graft invocation to use. `probe` returns the version of the `graft` on PATH,
 * or null when there is none — injected so the branches are testable without a binary.
 */
export function resolveGraft({ env = process.env, probe = probePathVersion } = {}) {
  const override = typeof env.GRAFT_BIN === 'string' ? env.GRAFT_BIN.trim() : ''
  if (override) {
    return { command: override, prefixArgs: [], source: `GRAFT_BIN=${override}` }
  }

  const onPath = probe()
  if (onPath === GRAFT_VERSION) {
    return { command: 'graft', prefixArgs: [], source: `graft ${GRAFT_VERSION} on PATH` }
  }

  const mismatch = onPath ? ` (PATH has ${onPath}, pinned to ${GRAFT_VERSION})` : ''
  return {
    command: 'npx',
    prefixArgs: ['-y', GRAFT_PACKAGE],
    source: `npx ${GRAFT_PACKAGE}${mismatch}`,
  }
}

function main() {
  const args = process.argv.slice(2)
  const resolved = resolveGraft()

  if (!process.env.GRAFT_QUIET) {
    console.error(`[graft] via ${resolved.source}`)
  }

  const result = spawnSync(resolved.command, [...resolved.prefixArgs, ...args], {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    console.error(`[graft] failed to run ${resolved.command}: ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
