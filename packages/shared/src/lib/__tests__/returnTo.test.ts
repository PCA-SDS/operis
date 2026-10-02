import { buildHrefWithReturnTo, resolveReturnToParam } from '../navigation/returnTo'

describe('buildHrefWithReturnTo', () => {
  it('adds returnTo to a plain href', () => {
    expect(buildHrefWithReturnTo('/backend/config/customers', '/backend/customers/companies-v2/123?tab=people')).toBe(
      '/backend/config/customers?returnTo=%2Fbackend%2Fcustomers%2Fcompanies-v2%2F123%3Ftab%3Dpeople',
    )
  })

  it('preserves existing query params and hashes', () => {
    expect(buildHrefWithReturnTo('/backend/config/dictionaries?kind=status#list', '/backend/customers/people')).toBe(
      '/backend/config/dictionaries?kind=status&returnTo=%2Fbackend%2Fcustomers%2Fpeople#list',
    )
  })

  it('does not overwrite an existing returnTo parameter', () => {
    expect(
      buildHrefWithReturnTo(
        '/backend/config/dictionaries?returnTo=%2Fbackend%2Fcustomers',
        '/backend/customers/companies-v2/123',
      ),
    ).toBe('/backend/config/dictionaries?returnTo=%2Fbackend%2Fcustomers')
  })
})

describe('resolveReturnToParam', () => {
  it('keeps an in-app path with its query and hash', () => {
    expect(resolveReturnToParam({ returnTo: '/backend/appointments/create?draft=1#referral' }))
      .toBe('/backend/appointments/create?draft=1#referral')
  })

  it('trims surrounding whitespace', () => {
    expect(resolveReturnToParam({ returnTo: '  /backend/customers  ' })).toBe('/backend/customers')
  })

  it.each([
    ['an absolute URL to another site', 'https://evil.example/phish'],
    ['a protocol-relative host', '//evil.example'],
    ['a backslash that normalizes to a host', '/\\evil.example'],
    ['a doubled slash inside the path', '/backend//evil.example'],
    ['a relative path', 'backend/customers'],
    ['a javascript URL', 'javascript:alert(1)'],
  ])('refuses %s', (_label, value) => {
    expect(resolveReturnToParam({ returnTo: value })).toBeNull()
  })

  it('refuses a missing, empty or repeated parameter', () => {
    expect(resolveReturnToParam(undefined)).toBeNull()
    expect(resolveReturnToParam({})).toBeNull()
    expect(resolveReturnToParam({ returnTo: '   ' })).toBeNull()
    expect(resolveReturnToParam({ returnTo: ['/a', '/b'] })).toBeNull()
  })
})
