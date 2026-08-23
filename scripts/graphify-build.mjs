#!/usr/bin/env node
/**
 * Graphify whole-repo knowledge-graph builder for Operis.
 *
 * Graphify is the conceptual half of the agent navigation layer: it indexes code
 * structurally (AST) *and* extracts meaning from the ~1,800 markdown/MDX files graft
 * cannot see — specs, ADRs, lessons, the 41 AGENTS.md files. See
 * `.ai/docs/code-navigation.md` for when to reach for it instead of graft.
 *
 * Two cost tiers, chosen automatically:
 *
 *   - no LLM key set → `extract --code-only`, then `update`. Both free and deterministic.
 *     `extract` REFUSES to run over documents without a key, but `update` indexes them
 *     structurally (headings become nodes) for nothing — measured here as 60,452 code
 *     nodes followed by 33,112 document nodes from 1,778 markdown files. `update` is
 *     idempotent, so re-running it does not inflate the graph. Communities stay unnamed.
 *
 *   - LLM key set → a single `extract --backend=…` covering code and documents
 *     semantically, then `cluster-only` to name the communities. Costs tokens once;
 *     cached by content hash.
 *
 * Exclusions live in `.graphifyignore` (read after .gitignore, same spec).
 *
 * A full build takes minutes, not seconds — this is deliberately NOT wired into a git
 * hook. Graft self-refreshes and covers code; run this when the docs have moved.
 *
 * Usage:
 *   node scripts/graphify-build.mjs              # full build
 *   node scripts/graphify-build.mjs --update     # refresh only (re-extract + recluster)
 *   node scripts/graphify-build.mjs --no-viz     # skip graph.html (>5000 nodes anyway)
 *   node scripts/graphify-build.mjs -- --force   # pass anything after `--` to graphify
 *
 * Environment:
 *   GRAPHIFY_BIN  – path to the graphify binary (default: `graphify` on PATH)
 *   one of GEMINI_API_KEY / GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY /
 *   DEEPSEEK_API_KEY / KIMI_API_KEY – enables the semantic document pass
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Ordered so the cheapest capable backend wins when several keys are present.
 * Gemini flash is what graphify itself recommends for bulk document extraction.
 */
export const BACKEND_CANDIDATES = [
  { env: 'GEMINI_API_KEY', backend: 'gemini' },
  { env: 'GOOGLE_API_KEY', backend: 'gemini' },
  { env: 'DEEPSEEK_API_KEY', backend: 'deepseek' },
  { env: 'KIMI_API_KEY', backend: 'kimi' },
  { env: 'OPENAI_API_KEY', backend: 'openai' },
  { env: 'ANTHROPIC_API_KEY', backend: 'claude' },
]

export function detectBackend(env = process.env) {
  for (const candidate of BACKEND_CANDIDATES) {
    const value = env[candidate.env]
    if (typeof value === 'string' && value.trim()) return candidate
  }
  return null
}

/**
 * Without a backend the document half is not merely skipped — it must be skipped
 * explicitly, or graphify counts ~1,800 markdown files it has no way to extract.
 */
export function buildExtractArgs({ backend, target = '.', passthrough = [] } = {}) {
  const args = ['extract', target]
  if (backend) args.push(`--backend=${backend.backend}`)
  else args.push('--code-only')
  return [...args, ...passthrough]
}

/**
 * Community naming is an LLM call. Without a key the communities stay as
 * "Community N" placeholders rather than silently failing the whole clustering step.
 */
export function buildClusterArgs({ backend, target = '.', noViz = false } = {}) {
  const args = ['cluster-only', target]
  if (!backend) args.push('--no-label')
  if (noViz) args.push('--no-viz')
  return args
}

export function buildUpdateArgs({ target = '.', passthrough = [] } = {}) {
  return ['update', target, ...passthrough]
}

export function parseArgs(argv) {
  const options = { update: false, noViz: false, passthrough: [] }
  const separator = argv.indexOf('--')
  const own = separator === -1 ? argv : argv.slice(0, separator)
  if (separator !== -1) options.passthrough = argv.slice(separator + 1)

  for (const arg of own) {
    if (arg === '--update') options.update = true
    else if (arg === '--no-viz') options.noViz = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown argument: ${arg} (pass graphify flags after \`--\`)`)
  }
  return options
}

function run(bin, args) {
  console.log(`\n$ ${bin} ${args.join(' ')}`)
  const result = spawnSync(bin, args, { stdio: 'inherit', cwd: ROOT, env: process.env })
  if (result.error) {
    console.error(`graphify-build: failed to run ${bin}: ${result.error.message}`)
    if (result.error.code === 'ENOENT') {
      console.error('Install it with: uv tool install graphifyy')
    }
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }

  if (options.help) {
    console.log('Usage: node scripts/graphify-build.mjs [--update] [--no-viz] [-- <graphify args>]')
    return
  }

  const bin = process.env.GRAPHIFY_BIN || 'graphify'
  const backend = detectBackend()

  if (backend) {
    console.log(`graphify-build: ${backend.env} detected — full pass (code + documents) via ${backend.backend}.`)
  } else {
    console.log(
      'graphify-build: no LLM key set — running --code-only (AST, free).\n' +
        '  The ~1,800 markdown/MDX files (specs, ADRs, lessons, AGENTS.md) are NOT indexed.\n' +
        '  Set GEMINI_API_KEY and re-run to add the document layer.',
    )
  }

  if (options.update) {
    run(bin, buildUpdateArgs({ passthrough: options.passthrough }))
    return
  }

  run(bin, buildExtractArgs({ backend, passthrough: options.passthrough }))

  if (backend) {
    // The semantic pass already covered documents; clustering only needs to name things.
    run(bin, buildClusterArgs({ backend, noViz: options.noViz }))
  } else {
    // `extract --code-only` deliberately skipped every document. `update` folds them in
    // structurally at no cost, and reclusters, so no separate cluster step is needed.
    console.log('\ngraphify-build: adding the structural document layer (free)…')
    run(bin, buildUpdateArgs({}))
  }

  console.log('\ngraphify-build: done. Report at graphify-out/GRAPH_REPORT.md')
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
