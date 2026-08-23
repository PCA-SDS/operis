import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..')
// The create-app template copy was removed with that package.
const probeRoutes = ['apps/mercato/src/modules/example/api/override-probe/route.ts']

describe('example public route safety guidance (#3864)', () => {
  it.each(probeRoutes)('%s warns against copying unauthenticated metadata to data-bearing routes', (route) => {
    const source = readFileSync(join(repoRoot, route), 'utf8')

    expect(source).toContain('Test-only public probe: do not copy `requireAuth: false` to data-bearing routes.')
  })
})
