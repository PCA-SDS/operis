import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

/**
 * Minification / DI-injection-mode safety interlock.
 *
 * Awilix's `InjectionMode.CLASSIC` resolves every dependency **by constructor parameter name**.
 * A minifier renames those parameters to `e`, `t`, `n`, so every `asClass` registration fails
 * the moment the container is used:
 *
 *     ⨯ Could not resolve 'e'.  Resolution path: authService -> e
 *
 * That combination shipped once. The TC39 entity-decorator migration removed the *other*
 * reason minification was disabled — MikroORM keying metadata off `constructor.name` — and the
 * flags were turned on without anyone asking what else in the codebase reads identifiers at
 * runtime. Login returned 500 in production while CI and the deploy both reported green: unit
 * tests run unminified source, and the deploy smoke test probed a route that resolves nothing
 * from the container.
 *
 * So this is an interlock, not a style rule. It arbitrates BOTH minifier flags.
 *
 * CORRECTION (2026-09-15) — WITHDRAWN. That revision released the `turbopackMinify` interlock
 * on the premise that the two flags are independent and that the client minifier "cannot reach"
 * Awilix. Its supporting measurement was:
 *
 *     POST /api/auth/login -> 400 {"ok":false,"error":"Invalid email or password"}
 *     "i.e. the container resolved authService by parameter name and ran the password check"
 *
 * That inference is wrong, and it is the same false-green that let the original outage ship.
 * `/api/auth/login` accepts `application/x-www-form-urlencoded` or form data ONLY. Any other
 * body (JSON, most obviously) throws inside `parseLoginForm`, which catches and returns empty
 * fields; zod then fails and the handler returns 400 at `login.ts:104` — three lines BEFORE
 * `container.resolve('authService')` at `login.ts:107`. A 400 proves the request never reached
 * the container. The probe could not have failed, whatever the flags were set to.
 *
 * RE-MEASURED (2026-09-16) with a real credentialed, form-encoded sign-in, against a clean
 * production build and again in dev:
 *
 *   - `turbopackMinify: true`  -> POST /api/auth/login 500, and the server log carries
 *       `⨯ Could not resolve 'e'.  Resolution path: authService -> e`
 *       at `packages/core/src/modules/auth/api/login.ts:107`. The ephemeral production
 *       environment could not reach readiness at all. Nobody could sign in.
 *   - `turbopackMinify: false` -> POST /api/auth/login 200, token issued, zero
 *       `Could not resolve` entries in the log.
 *
 * Only that one flag changed between the two runs, so under the installed Turbopack it DOES
 * reach the server graph and `serverMinification: false` does not constrain it.
 *
 * Both flags therefore stay off while the container resolves by parameter name. The cost is
 * real — ~63% of the raw client JS — and it is the price of a working login until the container
 * moves to explicit `asFunction((cradle) => ...).proxy()` registrations (17 `asClass` sites plus
 * the named-parameter `asFunction` sites in container.ts). At that point parameter names stop
 * being load-bearing and both interlocks release on their own.
 *
 * Before changing either flag, re-run the probe THAT CAN FAIL:
 *
 *   curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login \
 *     -H 'Content-Type: application/x-www-form-urlencoded' \
 *     --data-urlencode "email=$EMAIL" --data-urlencode "password=$PASSWORD"
 *   # 200 = container resolved. 500 = minification broke DI. 400 = malformed probe, NOT a pass.
 *
 * `/api/configs/health` is likewise insufficient: it resolves nothing from the container.
 */

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const nextConfigPath = path.join(repoRoot, 'apps', 'mercato', 'next.config.ts')
const containerPath = path.join(repoRoot, 'packages', 'shared', 'src', 'lib', 'di', 'container.ts')

/**
 * Strip comments so a flag *described* in prose is never read as a flag that is *set*.
 *
 * Line comments go FIRST. `next.config.ts` documents a path as `charts/*Impl.tsx` inside a
 * `//` comment, and a block-comment pass run first treats that `/*` as an opener — swallowing
 * everything up to the next `*\/`, including the very flags this file exists to read.
 */
function stripComments(source) {
  const withoutLineComments = source
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
  return withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '')
}

function readMinifierFlag(source, flag) {
  const match = new RegExp(`\\b${flag}\\s*:\\s*(true|false)`).exec(source)
  return match ? match[1] === 'true' : null
}

const nextConfig = stripComments(fs.readFileSync(nextConfigPath, 'utf8'))
const container = stripComments(fs.readFileSync(containerPath, 'utf8'))

const serverMinification = readMinifierFlag(nextConfig, 'serverMinification')
const turbopackMinify = readMinifierFlag(nextConfig, 'turbopackMinify')
const usesClassicInjection = /InjectionMode\.CLASSIC/.test(container)

test('the interlock can still find both settings it arbitrates', () => {
  // Without this, a rename on either side turns every assertion below into a vacuous pass —
  // which is exactly how the combination reached production the first time.
  assert.notEqual(
    serverMinification,
    null,
    `Could not find an explicit \`serverMinification: true|false\` in ${path.relative(repoRoot, nextConfigPath)}. `
      + 'Next defaults it to TRUE, so an absent flag means minification is ON and this interlock cannot see it.',
  )
  assert.notEqual(
    turbopackMinify,
    null,
    `Could not find an explicit \`turbopackMinify: true|false\` in ${path.relative(repoRoot, nextConfigPath)}. `
      + 'Next defaults it to TRUE, and TRUE breaks Awilix CLASSIC resolution on the server, so an '
      + 'absent flag is an outage waiting to happen. It must stay stated explicitly.',
  )
  assert.match(
    container,
    /createContainer/,
    `${path.relative(repoRoot, containerPath)} no longer calls createContainer — this interlock is reading the wrong file.`,
  )
})

test('server minification stays off while the container resolves by parameter name', () => {
  if (!usesClassicInjection) return // Container moved off CLASSIC; the interlock no longer applies.

  assert.equal(
    serverMinification,
    false,
    'The Awilix container still runs in InjectionMode.CLASSIC, which resolves dependencies by '
      + 'constructor parameter NAME, but serverMinification is enabled. Minified parameter names '
      + 'break every asClass registration at runtime — the app boots, serves /api/configs/health, '
      + 'and 500s on anything that touches the container:\n'
      + "  ⨯ Could not resolve 'e'.  Resolution path: authService -> e\n\n"
      + 'Move packages/shared/src/lib/di/container.ts off CLASSIC first, then boot the app and '
      + 'confirm POST /api/auth/login does not 5xx before enabling this flag.',
  )
})

test('turbopackMinify stays off too while the container resolves by parameter name', () => {
  if (!usesClassicInjection) return // Container moved off CLASSIC; the interlock no longer applies.

  // Measured, not assumed: under the installed Turbopack this flag reaches the SERVER graph,
  // and `serverMinification: false` does not constrain it. See the header for the two runs.
  assert.equal(
    turbopackMinify,
    false,
    'turbopackMinify is enabled while the Awilix container still runs in InjectionMode.CLASSIC. '
      + 'Measured on this repo: that combination mangles server constructor parameter names and '
      + 'takes authentication down completely —\n'
      + "  POST /api/auth/login -> 500,  ⨯ Could not resolve 'e'.  Resolution path: authService -> e\n\n"
      + 'It is NOT client-only, whatever an earlier revision of this file claimed. Move '
      + 'packages/shared/src/lib/di/container.ts off CLASSIC first, then prove it with a real '
      + 'form-encoded sign-in returning 200 — a 400 means the probe was malformed and never '
      + 'reached the container.',
  )
})
