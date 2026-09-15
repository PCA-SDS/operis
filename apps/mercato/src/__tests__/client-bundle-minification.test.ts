import fs from 'node:fs'
import path from 'node:path'

const nextConfigSource = fs.readFileSync(
  path.resolve(__dirname, '../../next.config.ts'),
  'utf8',
)

/**
 * `turbopackMinify` and `serverMinification` were both disabled for one
 * server-side reason: Awilix runs in `InjectionMode.CLASSIC` and resolves
 * dependencies by constructor parameter name, which mangling destroys.
 *
 * That constraint is real, but it only applies to the server bundle. Leaving
 * the CLIENT minifier off cost 63% of the raw client JS (64.3 MiB -> 23.6 MiB;
 * 9.8 MiB -> 6.0 MiB gzipped) for no benefit. These guards pin the split so a
 * future edit cannot quietly restore either half of the regression.
 */
describe('client bundle minification', () => {
  it('keeps the client minifier enabled', () => {
    expect(nextConfigSource).toMatch(/^\s*turbopackMinify:\s*true,/m)
    expect(nextConfigSource).not.toMatch(/^\s*turbopackMinify:\s*false,/m)
  })

  it('keeps the server minifier disabled so Awilix CLASSIC injection still resolves', () => {
    expect(nextConfigSource).toMatch(/^\s*serverMinification:\s*false,/m)
  })

  it('documents the login probe that must be re-run before either flag changes', () => {
    expect(nextConfigSource).toMatch(/POST \/api\/auth\/login/)
  })
})
