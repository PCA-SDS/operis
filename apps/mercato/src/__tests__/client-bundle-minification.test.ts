import fs from 'node:fs'
import path from 'node:path'

const nextConfigSource = fs.readFileSync(
  path.resolve(__dirname, '../../next.config.ts'),
  'utf8',
)

const containerSource = fs.readFileSync(
  path.resolve(__dirname, '../../../../packages/shared/src/lib/di/container.ts'),
  'utf8',
)

const usesClassicInjection = /InjectionMode\.CLASSIC/.test(containerSource)

/**
 * Minification and dependency injection are coupled here, and the coupling is the
 * whole invariant.
 *
 * Awilix runs in `InjectionMode.CLASSIC`, which resolves dependencies by reading
 * CONSTRUCTOR PARAMETER NAMES. Any minifier that renames those parameters breaks every
 * `asClass` registration at runtime:
 *
 *     ⨯ Could not resolve 'e'.  Resolution path: authService -> e
 *
 * This guard previously pinned `turbopackMinify: true`, on the premise that it governed
 * only the client bundle and so could not reach Awilix. That premise was wrong. With
 * Turbopack, `turbopackMinify` minifies server output too — `serverMinification: false`
 * does not constrain it — and enabling it took sign-in down completely: every
 * `POST /api/auth/login` returned 500 before the password was ever checked. Reproduced
 * on a clean production build and in dev, and confirmed causal by flipping the one flag.
 *
 * So the guard now pins the RELATIONSHIP rather than either flag on its own: while the
 * container resolves by parameter name, neither minifier may be on. Move the container to
 * explicit `asFunction((cradle) => ...).proxy()` registrations and these tests stop
 * constraining the flags by themselves.
 */
describe('minification and DI parameter-name resolution', () => {
  it('keeps both minifiers off while the container resolves by parameter name', () => {
    if (!usesClassicInjection) return

    expect(nextConfigSource).toMatch(/^\s*turbopackMinify:\s*false,/m)
    expect(nextConfigSource).not.toMatch(/^\s*turbopackMinify:\s*true,/m)
    expect(nextConfigSource).toMatch(/^\s*serverMinification:\s*false,/m)
    expect(nextConfigSource).not.toMatch(/^\s*serverMinification:\s*true,/m)
  })

  it('still documents the login probe that must be re-run before either flag changes', () => {
    expect(nextConfigSource).toMatch(/POST \/api\/auth\/login/)
  })

  /**
   * The probe recorded alongside the previous change accepted `400 Invalid email or
   * password` as proof the container had resolved. It is not: `/api/auth/login` accepts
   * only form-encoded bodies, so a JSON probe fails zod and returns 400 three lines
   * BEFORE `container.resolve('authService')`. The probe could not have failed, which is
   * how the outage reached a green build. Keep the corrected expectation written down.
   */
  it('records that only a 200 from a credentialed sign-in proves the container resolved', () => {
    expect(nextConfigSource).toMatch(/application\/x-www-form-urlencoded/)
    expect(nextConfigSource).toMatch(/200 = container resolved/)
  })
})
