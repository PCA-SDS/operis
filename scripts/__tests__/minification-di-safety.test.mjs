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
 * So this is an interlock, not a style rule. It arbitrates `serverMinification` only.
 *
 * CORRECTION (2026-09-15): this file used to interlock `turbopackMinify` too, on the stated
 * premise that "under Turbopack this is the flag that governs BOTH graphs". Measured against
 * the installed next@16.3.3, that is false — the two flags are independent:
 *
 *   - With `turbopackMinify: true` and `serverMinification: false`, the SERVER output keeps
 *     its constructor parameter names (`constructor(em, entityName`,
 *     `constructor(em, getDbFn, resolveEncryptionService`), and the literal `rbacService`
 *     still appears in 1,055 server files. The CLIENT output is mangled in the same build
 *     (`constructor(e,r)`, `constructor(e,t)`).
 *   - Booted on that build, `POST /api/auth/login` returns
 *     `400 {"ok":false,"error":"Invalid email or password"}` — i.e. the container resolved
 *     `authService` by parameter name and ran the password check. Protected routes return 401
 *     (RBAC resolved), and the server log contains zero `Could not resolve` /
 *     `AwilixResolutionError` entries.
 *
 * Awilix only ever runs on the server, so the client minifier cannot reach it. Keeping
 * `turbopackMinify` off was collateral damage from a server-side constraint, and it cost 63%
 * of the raw client JS (64.3 MiB -> 23.6 MiB; 9.8 MiB -> 6.0 MiB gzipped) for no safety.
 *
 * `serverMinification` stays interlocked. Lifting THAT means moving the container to explicit
 * `asFunction` registrations with destructured cradle access — at which point parameter names
 * stop being load-bearing and this test starts passing on its own.
 *
 * Before changing either flag, re-run the login probe above. `/api/configs/health` is NOT
 * sufficient: it resolves nothing from the container, which is how the original breakage
 * reached production green.
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
      + 'This is the CLIENT minifier and is deliberately enabled; it must stay stated explicitly '
      + 'so a silent revert to Next\'s default is visible in review rather than as a 63% client-JS '
      + 'regression nobody notices.',
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

test('the client minifier is not re-disabled as collateral damage from the server constraint', () => {
  // The two flags are independent (see the header). Turning the CLIENT minifier off does not
  // protect Awilix — Awilix never runs in the browser — it just ships 63% more raw JS. If a
  // future change genuinely needs it off, state the reason here and flip this assertion.
  assert.equal(
    turbopackMinify,
    true,
    'turbopackMinify (the CLIENT minifier) is disabled. That does not protect the Awilix '
      + 'container — Awilix only runs on the server, which serverMinification already covers — '
      + 'and it costs ~63% of the raw client bundle. Re-enable it, or record here why the client '
      + 'bundle must ship unminified.',
  )
})
