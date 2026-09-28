import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const moduleRoot = join(__dirname, '..')

describe('organization availability editor contract', () => {
  it('keeps ruleset schedule saves separate from organization policy activation', () => {
    const editorSource = readFileSync(join(moduleRoot, 'components', 'AvailabilityRulesEditor.tsx'), 'utf8')
    const detailPageSource = readFileSync(
      join(moduleRoot, 'backend', 'planner', 'availability-rulesets', '[id]', 'page.tsx'),
      'utf8',
    )

    expect(editorSource).not.toContain('/api/planner/organization-availability-settings')
    expect(detailPageSource).toContain('<OrganizationAvailabilityPolicyCard ruleSetId={rulesetId ?? \'\'} />')
  })
})
