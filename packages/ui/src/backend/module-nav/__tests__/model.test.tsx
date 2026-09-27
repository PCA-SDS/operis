import {
  groupToNavSection,
  isPathOnBranch,
  matchesModuleQuery,
  resolveActiveGroup,
  resolveActiveLinkKey,
  resolveGroupEntryHref,
  selectModuleGroups,
  type NavGroup,
} from '../model'

const customers: NavGroup = {
  id: 'customers.nav.group',
  name: 'Customers',
  items: [
    { href: '/backend/customers', title: 'Overview' },
    { href: '/backend/customers/people', title: 'People' },
  ],
}
const deals: NavGroup = {
  id: 'deals.nav.group',
  name: 'Sales',
  items: [
    {
      href: '/backend/customers/deals',
      title: 'Deals',
      children: [{ href: '/backend/customers/deals/pipeline', title: 'Pipeline' }],
    },
  ],
}

describe('module-nav model', () => {
  it('matches a branch by whole path segments only', () => {
    expect(isPathOnBranch('/backend/customers', '/backend/customers')).toBe(true)
    expect(isPathOnBranch('/backend/customers/1', '/backend/customers')).toBe(true)
    expect(isPathOnBranch('/backend/customers-x', '/backend/customers')).toBe(false)
    expect(isPathOnBranch(null, '/backend/customers')).toBe(false)
  })

  it('resolves the module holding the longest matching page, so nested modules claim their own routes', () => {
    expect(resolveActiveGroup([customers, deals], '/backend/customers/people/9')?.id).toBe('customers.nav.group')
    expect(resolveActiveGroup([customers, deals], '/backend/customers/deals/pipeline')?.id).toBe('deals.nav.group')
    expect(resolveActiveGroup([customers, deals], '/backend/customers/deals/42')?.id).toBe('deals.nav.group')
    expect(resolveActiveGroup([customers, deals], '/backend/other')).toBeNull()
  })

  it('ignores hidden pages when resolving the active module', () => {
    const hidden: NavGroup = { id: 'h', name: 'Hidden', items: [{ href: '/backend/secret', title: 'Secret', hidden: true }] }
    expect(resolveActiveGroup([hidden], '/backend/secret')).toBeNull()
  })

  it('opens a module at its first enabled page, falling back to an enabled subpage', () => {
    expect(resolveGroupEntryHref(customers)).toBe('/backend/customers')
    const disabledParent: NavGroup = {
      id: 'x',
      name: 'X',
      items: [{ href: '/backend/x', title: 'X', enabled: false, children: [{ href: '/backend/x/y', title: 'Y' }] }],
    }
    expect(resolveGroupEntryHref(disabledParent)).toBe('/backend/x/y')
    expect(resolveGroupEntryHref({ id: 'e', name: 'E', items: [] })).toBeNull()
  })

  it('keeps settings-context and settings-path pages out of the module list', () => {
    const mixed: NavGroup = {
      id: 'm',
      name: 'Mixed',
      items: [
        { href: '/backend/m', title: 'Main' },
        { href: '/backend/m/admin', title: 'Admin', pageContext: 'settings' },
        { href: '/backend/config/m', title: 'Config' },
      ],
    }
    const onlySettings: NavGroup = { id: 's', name: 'S', items: [{ href: '/backend/config/s', title: 'S' }] }
    const result = selectModuleGroups([mixed, onlySettings], (href) => href.startsWith('/backend/config'))
    expect(result).toHaveLength(1)
    expect(result[0].items.map((item) => item.title)).toEqual(['Main'])
  })

  it('lights exactly one link: the deepest one on the route', () => {
    const section = groupToNavSection(deals, null)
    expect(resolveActiveLinkKey([section], '/backend/customers/deals/pipeline')).toBe('/backend/customers/deals/pipeline')
    expect(resolveActiveLinkKey([section], '/backend/customers/deals/7')).toBe('/backend/customers/deals')
  })

  it('matches a module query against its name and its page titles', () => {
    expect(matchesModuleQuery(deals, 'sal')).toBe(true)
    expect(matchesModuleQuery(deals, 'PIPE')).toBe(true)
    expect(matchesModuleQuery(deals, 'people')).toBe(false)
    expect(matchesModuleQuery(deals, '  ')).toBe(true)
  })
})
