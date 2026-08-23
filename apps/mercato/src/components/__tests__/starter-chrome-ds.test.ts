import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../../../..')

// The create-app standalone template was removed with that package, so the app
// is now the only starter chrome to check.
const componentPairs = [
  [
    'app',
    path.join(repoRoot, 'apps/mercato/src/components'),
  ],
] as const

const forbiddenStarterStatusColor =
  /\b(?:(?:hover:|dark:hover:)?(?:bg|border|text)|(?:dark:)?marker:text|dark:(?:bg|border|text))-(?:amber|blue|emerald|slate)-\d+(?:\/\d+)?/g

describe('starter chrome design-system coverage', () => {
  it.each(componentPairs)('%s StartPageContent and GlobalNoticeBars use semantic status tokens', (_label, componentsDir) => {
    for (const fileName of ['StartPageContent.tsx', 'GlobalNoticeBars.tsx']) {
      const filePath = path.join(componentsDir, fileName)
      const source = fs.readFileSync(filePath, 'utf8')

      expect(source.match(forbiddenStarterStatusColor) ?? []).toEqual([])
    }
  })

  it.each(componentPairs)('%s OrganizationSwitcher uses button primitives instead of raw buttons', (_label, componentsDir) => {
    const source = fs.readFileSync(path.join(componentsDir, 'OrganizationSwitcher.tsx'), 'utf8')

    expect(source).not.toMatch(/<button\b/)
  })

  // The two copies are the only writers of `om_selected_tenant`, and only the app copy is covered
  // by behavioral tests — parity is what keeps a scaffolded app from silently keeping the bug.

  // Behavioral coverage lives in OrganizationSwitcher.tenantCookie.test.tsx against the app copy;
  // this only pins that the template carries the expiring write, since the parity test above is
  // what actually keeps the two in step.
  it.each(componentPairs)('%s OrganizationSwitcher expires the tenant cookie instead of blanking it', (_label, componentsDir) => {
    const source = fs.readFileSync(path.join(componentsDir, 'OrganizationSwitcher.tsx'), 'utf8')

    expect(source).toMatch(/om_selected_tenant=; path=\/; max-age=0/)
  })
})
