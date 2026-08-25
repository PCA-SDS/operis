import { buildHomeQuickLinks } from '@/lib/homeQuickLinks'

describe('buildHomeQuickLinks', () => {
  it('always offers the login link', () => {
    const links = buildHomeQuickLinks([{ id: 'auth' }, { id: 'customers' }])

    expect(links.map((link) => link.href)).toEqual(['/login'])
  })

  it('offers nothing module-owned for a build that registers no such module', () => {
    // The starter page is unauthenticated, so a module-owned link can only be
    // filtered by what the build registers. Every entry must therefore be keyed
    // by module id; a link that leaked into the base list would advertise a
    // surface this deployment does not serve.
    const links = buildHomeQuickLinks([])

    expect(links.every((link) => link.href === '/login')).toBe(true)
  })
})
