import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import fg from 'fast-glob'

/**
 * License-boundary guard (fork of upstream #3475).
 *
 * Operis is a fork of Open Mercato's MIT-licensed open-source core. Upstream is
 * open-CORE: it also ships one commercial package, `@open-mercato/enterprise`,
 * whose license forbids production use, reproduction, and derivation without a
 * commercial license. Operis holds no such license, so that package — and its
 * specifications — were deliberately NOT imported. See `NOTICE.md` and
 * `docs/architecture/adr/ADR-0002-exclude-enterprise-edition.md`.
 *
 * That makes this fork uniformly MIT, and this guard pins that invariant:
 *
 *   1. No module/integration metadata may declare `license: 'Proprietary'`.
 *      Upstream had ~28 OSS manifests hardcoding it by copy-paste, which
 *      misled adopters into thinking the core needed a commercial license.
 *   2. No commercially-licensed package tree may reappear in the workspace.
 *      If someone re-imports `packages/enterprise/` (or vendors it under
 *      another name with a restricted LICENSE.md), this fails loudly rather
 *      than silently putting the repo in breach.
 *
 * The `ModuleInfo.license` / `IntegrationDefinition.license` strings are
 * descriptive metadata only — the PACKAGE is the licensing boundary.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const metadataFiles = fg.sync(
  ['packages/*/src/modules/**/index.ts', 'packages/*/src/modules/**/integration.ts'],
  {
    cwd: repoRoot,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/__tests__/**', '**/__mocks__/**'],
  },
)

const licenseOf = (file: string): string | null => {
  const match = readFileSync(file, 'utf8').match(/license:\s*'([^']+)'/)
  return match ? match[1] : null
}

const rel = (file: string): string => relative(repoRoot, file).split(sep).join('/')

describe('license boundary consistency', () => {
  it('discovers module/integration metadata files', () => {
    expect(metadataFiles.length).toBeGreaterThan(0)
  })

  it('no module metadata declares a proprietary license', () => {
    const offenders = metadataFiles.filter((file) => licenseOf(file) === 'Proprietary').map(rel)

    expect(offenders).toEqual([])
  })

  it('does not reintroduce the excluded commercial enterprise package', () => {
    expect(existsSync(join(repoRoot, 'packages', 'enterprise'))).toBe(false)
  })

  it('carries no package with a restricted (non-MIT) license declaration', () => {
    const packageManifests = fg.sync(['packages/*/package.json', 'apps/*/package.json'], {
      cwd: repoRoot,
      absolute: true,
      ignore: ['**/node_modules/**'],
    })

    const restricted = packageManifests
      .filter((file) => {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
          license?: string
          publishConfig?: { access?: string }
        }
        // An MIT license, or none at all (inheriting the root MIT LICENSE), is fine.
        // Anything else — notably `SEE LICENSE IN ...` — signals a restricted tree.
        const license = pkg.license
        const licenseIsRestricted = typeof license === 'string' && license !== 'MIT'
        const publishIsRestricted = pkg.publishConfig?.access === 'restricted'
        return licenseIsRestricted || publishIsRestricted
      })
      .map(rel)

    expect(restricted).toEqual([])
  })
})
