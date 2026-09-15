#!/usr/bin/env node
/**
 * Runs `next build` with an overridable heap ceiling.
 *
 * The heap used to be hard-coded in the package.json script as
 * `cross-env NODE_OPTIONS=--max-old-space-size=8192 next build`. Because
 * cross-env *replaces* NODE_OPTIONS rather than merging with it, that silently
 * overrode the smaller ceiling the Dockerfile sets — so the image build always
 * asked for an 8 GB heap no matter what the daemon could give it, and OOM-killed
 * on any machine with less. `cross-env-shell` is not a fix: it does not expand
 * `${VAR:-default}` in an assignment, it forwards the literal text to Node.
 *
 * Hence a script. `NEXT_BUILD_HEAP_MB` sets the ceiling, defaulting to the 8192
 * the hard-coded value used, so every environment that does not set it builds
 * exactly as before. Any other NODE_OPTIONS the caller set are preserved.
 */
import { spawn } from 'node:child_process'

const DEFAULT_HEAP_MB = 8192

export function resolveHeapMb(raw) {
  // Whole-string digits only. `Number.parseInt` would read "1.5.2" as 1 and hand
  // node a 1 MB heap — a malformed value must fall back, not half-parse.
  const text = String(raw ?? '').trim()
  if (!/^\d+$/.test(text)) return DEFAULT_HEAP_MB
  const parsed = Number.parseInt(text, 10)
  return parsed > 0 ? parsed : DEFAULT_HEAP_MB
}

export function buildNodeOptions(existing, heapMb) {
  const kept = (existing ?? '')
    .split(/\s+/)
    .filter((flag) => flag && !flag.startsWith('--max-old-space-size'))
  return [...kept, `--max-old-space-size=${heapMb}`].join(' ')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const heapMb = resolveHeapMb(process.env.NEXT_BUILD_HEAP_MB)
  const child = spawn('next', ['build', ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_OPTIONS: buildNodeOptions(process.env.NODE_OPTIONS, heapMb) },
  })
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
  child.on('error', (err) => {
    console.error('[build] failed to start next build:', err.message)
    process.exit(1)
  })
}
