import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Request-cancellation coverage guard.
 *
 * A load effect that guards its writes with a `cancelled` flag is protected against a
 * stale response overwriting fresh state, but the request itself keeps running: the server
 * finishes a CRUD list pipeline — DI container, auth, RBAC, org scope, query engine, custom
 * field decoration, access logging — for a response nobody reads. Paging, sorting and
 * filtering re-fire those effects constantly, and every abandoned one is wasted capacity.
 *
 * The convention is an `AbortController` created alongside the flag and aborted in the same
 * cleanup, with its signal threaded into every `apiCall` / `apiCallOrThrow` /
 * `readApiResultOrThrow` in that effect. This test pins it: a new list page that guards with
 * `cancelled` but never cancels the request fails here rather than silently regressing.
 *
 * Two rules follow from `apiCall` REJECTING on abort:
 *   - the cleanup MUST set `cancelled = true` before `controller.abort()`, so the effect's
 *     own `catch` sees the flag already set;
 *   - any `catch` that surfaces the failure to the user MUST check `cancelled`, or every
 *     navigation mid-load flashes an error toast on the page the user just moved to.
 *
 * Effects whose `cancelled` flag guards something other than a request — an animation frame
 * loop, a timer — are not in scope and are skipped: they carry no request to abort.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const REQUEST_HELPER = /\b(apiCall|apiCallOrThrow|readApiResultOrThrow)\b\s*(?:<[^(<>]*>)?\s*\(/
const CATCH_BLOCK = /catch\s*(?:\([^)]*\))?\s*\{([^}]*)\}/gs
const SURFACES_ERROR = /\b(flash|toast)\s*\(|\bsetError\s*\(/

type LoadEffect = { file: string; line: number; body: string }

function listCandidateFiles(): string[] {
  // `git ls-files` keeps this to tracked sources and stays fast on a repo this size.
  const out = execFileSync('git', ['ls-files', '*.tsx', '*.ts'], { cwd: REPO_ROOT, encoding: 'utf8' })
  return out.split('\n').filter((path) => path && !path.includes('__tests__'))
}

function collectLoadEffects(): LoadEffect[] {
  const effects: LoadEffect[] = []
  for (const file of listCandidateFiles()) {
    let source: string
    try {
      source = readFileSync(join(REPO_ROOT, file), 'utf8')
    } catch {
      continue
    }
    if (!source.includes('let cancelled = false')) continue
    for (const match of source.matchAll(/let cancelled = false/g)) {
      const end = source.indexOf('cancelled = true', match.index! + match[0].length)
      if (end === -1) continue
      // Start at the enclosing arrow body, not at the flag: an effect may open its
      // controller on the line ABOVE `let cancelled = false`, and reading only forward
      // from the flag would report a correctly-cancelled effect as an offender.
      const scopeStart = source.lastIndexOf('=> {', match.index!)
      const body = source.slice(scopeStart === -1 ? match.index! : scopeStart, end)
      if (!REQUEST_HELPER.test(body)) continue
      effects.push({ file, line: source.slice(0, match.index!).split('\n').length, body })
    }
  }
  return effects
}

const loadEffects = collectLoadEffects()

describe('list-load request cancellation', () => {
  it('finds the load effects it is meant to guard', () => {
    // A refactor that renames the flag would otherwise make every assertion below vacuous.
    expect(loadEffects.length).toBeGreaterThan(50)
  })

  it('cancels the request when the effect is torn down', () => {
    const offenders = loadEffects
      .filter((effect) => !effect.body.includes('new AbortController()'))
      .map((effect) => `${effect.file}:${effect.line}`)
    expect(offenders).toEqual([])
  })

  it('threads the signal into every request the effect issues', () => {
    const offenders: string[] = []
    for (const effect of loadEffects) {
      const calls = effect.body.match(new RegExp(REQUEST_HELPER.source, 'g'))?.length ?? 0
      const signals = effect.body.match(/signal:\s*controller\.signal/g)?.length ?? 0
      if (signals < calls) offenders.push(`${effect.file}:${effect.line} (${signals}/${calls} calls carry a signal)`)
    }
    expect(offenders).toEqual([])
  })

  it('never surfaces an aborted request as a user-facing error', () => {
    const offenders: string[] = []
    for (const effect of loadEffects) {
      for (const [, handler] of effect.body.matchAll(CATCH_BLOCK)) {
        if (SURFACES_ERROR.test(handler) && !handler.includes('cancelled')) {
          offenders.push(`${effect.file}:${effect.line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
