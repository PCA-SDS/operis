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
 * So this is an interlock, not a style rule: minification and CLASSIC injection may not both be
 * on. Lifting it means moving the container to explicit `asFunction` registrations with
 * destructured cradle access — at which point parameter names stop being load-bearing and this
 * test starts passing on its own.
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
      + 'Under Turbopack this is the flag that governs BOTH graphs, so it must be stated explicitly.',
  )
  assert.match(
    container,
    /createContainer/,
    `${path.relative(repoRoot, containerPath)} no longer calls createContainer — this interlock is reading the wrong file.`,
  )
})

test('minification stays off while the container resolves by parameter name', () => {
  if (!usesClassicInjection) return // Container moved off CLASSIC; the interlock no longer applies.

  const enabled = [
    ...(serverMinification === true ? ['serverMinification'] : []),
    ...(turbopackMinify === true ? ['turbopackMinify'] : []),
  ]

  assert.deepEqual(
    enabled,
    [],
    'The Awilix container still runs in InjectionMode.CLASSIC, which resolves dependencies by '
      + `constructor parameter NAME, but ${enabled.join(' and ')} ${enabled.length === 1 ? 'is' : 'are'} enabled. `
      + 'Minified parameter names break every asClass registration at runtime — the app boots, '
      + 'serves /api/configs/health, and 500s on anything that touches the container:\n'
      + "  ⨯ Could not resolve 'e'.  Resolution path: authService -> e\n\n"
      + 'Move packages/shared/src/lib/di/container.ts off CLASSIC first, then boot the app and '
      + 'confirm POST /api/auth/login does not 5xx before enabling either flag.',
  )
})
