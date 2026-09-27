import {
  buildBackendRouteShapes,
  matchesRoutePattern,
  resolveBackendRouteShape,
  type BackendRouteShapeSource,
} from '../backendRouteShapes'

const PERSON_ID = '1a052ce3-c8e6-44fa-80ad-dd452501f2cf'

// Most specific first, as the layout sorts them.
const routes: BackendRouteShapeSource[] = [
  { pattern: '/backend/customers/people/create', navHidden: true, group: 'Customers', groupKey: 'customers.nav.group' },
  { pattern: '/backend/customers/people', loadingSkeleton: 'list', group: 'Customers' },
  { pattern: '/backend/customers/companies', group: 'Customers' },
  { pattern: '/backend/chat', moduleSidebar: false, loadingSkeleton: 'conversation' },
  {
    pattern: '/backend/customers/people-v2/[id]',
    navHidden: true,
    loadingSkeleton: 'detail',
    group: 'Customers',
    groupKey: 'customers.nav.group',
    breadcrumb: [{ label: 'People', href: '/backend/customers/people' }],
  },
  { pattern: '/backend/customers/people/[id]', navHidden: true, loadingSkeleton: 'detail' },
  { pattern: '/backend/chat/[conversationId]', moduleSidebar: false, loadingSkeleton: 'conversation' },
]

describe('matchesRoutePattern', () => {
  it('matches literal segments case-insensitively and parameters as any one segment', () => {
    expect(matchesRoutePattern('/backend/customers/people', '/backend/Customers/People')).toBe(true)
    expect(matchesRoutePattern('/backend/customers/people-v2/[id]', `/backend/customers/people-v2/${PERSON_ID}`)).toBe(true)
    expect(matchesRoutePattern('/backend/customers/people-v2/[id]', '/backend/customers/people-v2')).toBe(false)
    expect(matchesRoutePattern('/backend/customers/people', '/backend/customers/people/create')).toBe(false)
  })

  it('ignores a trailing slash, a query and a hash', () => {
    expect(matchesRoutePattern('/backend/customers/people', '/backend/customers/people/?page=2#top')).toBe(true)
  })

  it('treats a catch-all as one or more segments and an optional catch-all as any', () => {
    expect(matchesRoutePattern('/backend/docs/[...slug]', '/backend/docs/a/b')).toBe(true)
    expect(matchesRoutePattern('/backend/docs/[...slug]', '/backend/docs')).toBe(false)
    expect(matchesRoutePattern('/backend/docs/[[...slug]]', '/backend/docs')).toBe(true)
  })
})

describe('buildBackendRouteShapes', () => {
  const shapes = buildBackendRouteShapes(routes)

  it('keeps what frames or fills a page and drops routes that carry nothing', () => {
    expect(shapes.find((shape) => shape.pattern === '/backend/customers/people')).toEqual({
      pattern: '/backend/customers/people',
      skeleton: 'list',
    })
    expect(shapes.find((shape) => shape.pattern === '/backend/chat')).toEqual({
      pattern: '/backend/chat',
      moduleSidebar: false,
      skeleton: 'conversation',
    })
    expect(shapes.some((shape) => shape.pattern === '/backend/customers/companies')).toBe(false)
  })

  it('places a page no nav link leads to by its group and breadcrumb parent', () => {
    expect(shapes.find((shape) => shape.pattern === '/backend/customers/people-v2/[id]')).toEqual({
      pattern: '/backend/customers/people-v2/[id]',
      skeleton: 'detail',
      group: 'customers.nav.group',
      parentHref: '/backend/customers/people',
    })
  })

  it('keeps a route that stops a broader pattern after it from claiming its URLs', () => {
    const withoutHints = buildBackendRouteShapes([
      { pattern: '/backend/customers/people/create' },
      { pattern: '/backend/customers/people/[id]', loadingSkeleton: 'detail' },
    ])
    expect(withoutHints.map((shape) => shape.pattern)).toEqual([
      '/backend/customers/people/create',
      '/backend/customers/people/[id]',
    ])
    expect(resolveBackendRouteShape(withoutHints, '/backend/customers/people/create')?.skeleton).toBeUndefined()
  })
})

describe('resolveBackendRouteShape', () => {
  const shapes = buildBackendRouteShapes(routes)

  it('picks the most specific route, so a create page never draws a record', () => {
    expect(resolveBackendRouteShape(shapes, '/backend/customers/people/create')?.pattern).toBe('/backend/customers/people/create')
    expect(resolveBackendRouteShape(shapes, `/backend/customers/people/${PERSON_ID}`)?.skeleton).toBe('detail')
  })

  it('finds a conversation by its parameterised route', () => {
    expect(resolveBackendRouteShape(shapes, '/backend/chat/4213e1d0-ca21-4a09-9652-b7c50c225cc4')).toEqual({
      pattern: '/backend/chat/[conversationId]',
      moduleSidebar: false,
      skeleton: 'conversation',
    })
  })

  it('returns null for a route with nothing to say, so the defaults apply', () => {
    expect(resolveBackendRouteShape(shapes, '/backend/customers/companies')).toBeNull()
  })
})
