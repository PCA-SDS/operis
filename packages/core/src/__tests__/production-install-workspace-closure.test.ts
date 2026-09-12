import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fg from 'fast-glob'

/**
 * Production-install closure guard.
 *
 * The runtime image does not run a full `yarn install`. It copies the workspace
 * manifests and then runs exactly one install:
 *
 *   RUN yarn workspaces focus @open-mercato/app --production
 *
 * That command links only the workspaces reachable from `@open-mercato/app`'s
 * PRODUCTION dependency graph. Two consequences the repo layout hides:
 *
 *   1. `devDependencies` are dropped, so a workspace a module imports at
 *      runtime cannot be declared only there.
 *   2. A `peerDependency` is never installed by the package that declares it —
 *      the consumer has to supply it. For this monorepo the consumer is
 *      `apps/mercato`.
 *
 * `packages/*` declare their workspace siblings as dev + peer, which is correct
 * for a library, and `apps/mercato` re-declares each one as a real dependency.
 * Miss that second half and everything still passes locally — a full
 * `yarn install` links every workspace regardless of section — while the
 * production container throws at import:
 *
 *   Cannot find package '@open-mercato/matrix' imported from
 *     /app/packages/core/dist/modules/chat_matrix/di.js
 *
 * which crash-loops the app, times out the deploy health check after 600s, and
 * rolls back. That cost two production deploys before anyone saw it, so the
 * invariant is pinned here where it fails in seconds instead.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

type Manifest = {
  name?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const readManifest = (absolutePath: string): Manifest =>
  JSON.parse(readFileSync(absolutePath, 'utf8')) as Manifest

const appManifest = readManifest(join(repoRoot, 'apps', 'mercato', 'package.json'))
const appDependencies = new Set(Object.keys(appManifest.dependencies ?? {}))

const workspaceManifests = fg
  .sync('packages/*/package.json', { cwd: repoRoot, absolute: true })
  .sort()

describe('production install links every workspace the app can import', () => {
  it('declares each @open-mercato/* peer dependency in apps/mercato', () => {
    const unsatisfied: string[] = []

    for (const manifestPath of workspaceManifests) {
      const manifest = readManifest(manifestPath)
      const peers = Object.keys(manifest.peerDependencies ?? {}).filter((name) =>
        name.startsWith('@open-mercato/'),
      )
      for (const peer of peers) {
        if (appDependencies.has(peer)) continue
        unsatisfied.push(`${manifest.name ?? manifestPath} peer-depends on ${peer}`)
      }
    }

    expect(unsatisfied).toEqual([])
  })
})
