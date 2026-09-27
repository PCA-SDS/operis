/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AppShell, ApplyBreadcrumb } from '../AppShell'
import { BackendModuleFrame } from '../module-nav/BackendModuleFrame'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockInjectionSpot = jest.fn()
let mockPathname = '/backend/users'

jest.mock('next/link', () => {
  const React = require('react')
  return React.forwardRef(({ children, href, ...rest }: any, ref: React.ForwardedRef<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : href?.toString?.()} ref={ref} {...rest}>
      {children}
    </a>
  ))
})

jest.mock('next/image', () => {
  const React = require('react')
  return (props: any) => {
    const { unoptimized, ...rest } = props
    return <img alt={rest.alt} data-unoptimized={unoptimized ? 'true' : 'false'} {...rest} />
  }
})

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams('tab=profile'),
  useRouter: () => ({
    refresh: jest.fn(),
    push: jest.fn(),
  }),
}))

jest.mock('../injection/InjectionSpot', () => ({
  InjectionSpot: (props: { spotId: string; context?: Record<string, unknown> }) => {
    mockInjectionSpot(props)
    return <div data-testid={`injection-spot:${props.spotId}`} />
  },
  useInjectionSpotEvents: () => ({ triggerEvent: async () => ({ ok: true }) }),
}))

jest.mock('../injection/useInjectedMenuItems', () => ({
  useInjectedMenuItems: () => ({
    items: [],
    isLoading: false,
  }),
}))

jest.mock('../injection/eventBridge', () => ({
  useEventBridge: jest.fn(),
}))

jest.mock('../injection/StatusBadgeInjectionSpot', () => ({
  StatusBadgeInjectionSpot: () => <div data-testid="status-badge-injection-spot" />,
}))

jest.mock('../operations/LastOperationBanner', () => ({
  LastOperationBanner: () => <div data-testid="last-operation-banner" />,
}))

jest.mock('../progress/ProgressTopBar', () => ({
  ProgressTopBar: () => <div data-testid="progress-top-bar" />,
}))

jest.mock('../indexes/PartialIndexBanner', () => ({
  PartialIndexBanner: () => <div data-testid="partial-index-banner" />,
}))

jest.mock('../FlashMessages', () => ({
  FlashMessages: () => <div data-testid="flash-messages" />,
}))

jest.mock('../../frontend/LanguageSwitcher', () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}))

jest.mock('../upgrades/UpgradeActionBanner', () => ({
  UpgradeActionBanner: () => <div data-testid="upgrade-action-banner" />,
}))

jest.mock('../devtools', () => ({
  UmesDevToolsPanel: () => null,
}))

const dict = {
  'appShell.productName': 'Mercato',
  'appShell.menu': 'Menu',
  'appShell.userFallback': 'User',
  'appShell.goToDashboard': 'Go to dashboard',
  'appShell.modules.title': 'Modules',
  'appShell.modules.open': 'Open module menu',
  'appShell.modules.openWithCurrent': 'Switch module, current: {module}',
  'appShell.modules.searchPlaceholder': 'Search modules and pages',
  'appShell.modules.empty': 'No modules available',
  'appShell.modules.noResults': 'Nothing matches your search',
  'appShell.modules.pages': 'Pages',
  'appShell.moduleNav.label': '{module} navigation',
  'common.terms': 'Terms',
  'common.privacy': 'Privacy',
  'dashboard.title': 'Dashboard',
  'custom.page.title': 'Custom Page',
  'custom.page.breadcrumb': 'Custom Trail',
}

const groups = [
  {
    id: 'core',
    name: 'Core',
    items: [
      { href: '/backend/users', title: 'Users List' },
      { href: '/backend/roles', title: 'Roles' },
    ],
  },
]

describe('AppShell', () => {
  beforeEach(() => {
    mockInjectionSpot.mockClear()
    mockPathname = '/backend/users'
  })

  beforeAll(() => {
    const storage: Record<string, string> = {}
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, value: string) => {
          storage[key] = value
        },
        removeItem: (key: string) => {
          delete storage[key]
        },
      },
      configurable: true,
    })
    if (typeof globalThis.Response === 'undefined') {
      globalThis.Response = class MockResponse {
        _body: string; status: number; headers: Headers
        constructor(body?: string | null, init?: ResponseInit) {
          this._body = body ?? ''; this.status = init?.status ?? 200
          this.headers = new Headers(init?.headers)
        }
        get ok() { return this.status >= 200 && this.status < 300 }
        async json() { return JSON.parse(this._body) }
        async text() { return this._body }
      } as unknown as typeof Response
    }
    if (!globalThis.fetch) {
      globalThis.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }),
      ) as typeof fetch
    }
  })


  /* The topbar is a three-column grid: breadcrumb, centred slot, actions. Both
     flanks grow from a zero basis so they split the slack evenly — that even
     split is the only thing that actually centres the middle column, so a
     change to either flank's flex is a change to where the search sits. */
  it('renders centerHeaderSlot between the breadcrumb and the action cluster', async () => {
    renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        centerHeaderSlot={<div data-testid="header-center">search</div>}
        rightHeaderSlot={<div data-testid="header-right">actions</div>}
      >
        <div>Child content</div>
      </AppShell>,
      { dict },
    )

    const header = document.querySelector('header') as HTMLElement
    const center = screen.getByTestId('header-center')
    const right = screen.getByTestId('header-right')
    expect(header.contains(center)).toBe(true)
    expect(
      center.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    const [left, middle, actions] = Array.from(header.children).filter(
      (el) => !el.classList.contains('hidden'),
    ) as HTMLElement[]
    expect(left.className).toContain('flex-1')
    expect(middle.contains(center)).toBe(true)
    expect(middle.className).toContain('shrink-0')
    expect(actions.className).toContain('flex-1')
    // Without `min-w-fit` the action cluster shrinks under its own icons and
    // they spill leftwards over the centred search.
    expect(actions.className).toContain('min-w-fit')
  })

  it('omits the centre column entirely when no centerHeaderSlot is given', async () => {
    renderWithProviders(
      <AppShell email="demo@example.com" groups={groups} rightHeaderSlot={<div data-testid="header-right">actions</div>}>
        <div>Child content</div>
      </AppShell>,
      { dict },
    )
    const header = document.querySelector('header') as HTMLElement
    const columns = Array.from(header.children).filter((el) => !el.classList.contains('hidden'))
    expect(columns).toHaveLength(2)
  })

  it('renders navigation and breadcrumbs with translations applied via ApplyBreadcrumb', async () => {
    renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        breadcrumb={[{ label: 'Initial' }]}
        currentTitle="Initial"
      >
        <ApplyBreadcrumb
          titleKey="custom.page.title"
          breadcrumb={[{ label: 'Custom Trail', labelKey: 'custom.page.breadcrumb', href: '/custom' }]}
        />
        <div>Child content</div>
      </AppShell>,
      { dict },
    )

    expect(screen.getByTestId('module-switcher-current')).toHaveTextContent('Core')
    expect(screen.getAllByText('Terms')[0]).toBeInTheDocument()
    expect(screen.getByTestId('flash-messages')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:layout:top')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:record:current')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:layout:footer')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend-mutation:global')).toBeInTheDocument()
    expect(screen.getByText('Child content')).toBeInTheDocument()

    const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(breadcrumbNav).toHaveAttribute('data-slot', 'breadcrumb')
    expect(breadcrumbNav).toHaveAttribute('data-divider', 'arrow')
    const dashboardHome = within(breadcrumbNav).getByRole('link', { name: 'Dashboard' })
    expect(dashboardHome).toHaveAttribute('href', '/backend')
    const activePage = within(breadcrumbNav).getByText((_, el) => el?.getAttribute('data-slot') === 'breadcrumb-page')
    expect(activePage).toHaveAttribute('aria-current', 'page')
    expect(mockInjectionSpot).toHaveBeenCalledWith(
      expect.objectContaining({
        spotId: 'backend-mutation:global',
        context: {
          path: '/backend/users',
          query: 'tab=profile',
        },
      }),
    )
    expect(mockInjectionSpot).toHaveBeenCalledWith(
      expect.objectContaining({
        spotId: 'backend:record:current',
        context: {
          path: '/backend/users',
          query: 'tab=profile',
        },
      }),
    )
  })

  it('keeps the incoming page breadcrumb when the pathname change and ApplyBreadcrumb land in the same commit', () => {
    const { rerender } = renderWithProviders(
      <AppShell email="demo@example.com" groups={groups}>
        <ApplyBreadcrumb breadcrumb={[{ label: 'Users List' }]} />
      </AppShell>,
      { dict },
    )

    mockPathname = '/backend/roles'
    rerender(
      <AppShell email="demo@example.com" groups={groups}>
        <ApplyBreadcrumb breadcrumb={[{ label: 'Roles' }]} />
      </AppShell>,
    )

    const breadcrumbNav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const activePage = within(breadcrumbNav).getByText((_, el) => el?.getAttribute('data-slot') === 'breadcrumb-page')
    expect(activePage).toHaveTextContent('Roles')
    expect(within(breadcrumbNav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/backend')
  })

  it('hides the backend footer status bar when requested', () => {
    renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        version="1.2.3"
        hideFooter
      >
        <div>Child content</div>
      </AppShell>,
      { dict },
    )

    expect(screen.getByText('Child content')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:layout:footer')).toBeInTheDocument()
  })

  it.each([
    ['internal-file', '/api/attachments/file/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    ['internal-image-query', '/api/attachments/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/acme.svg?width=320&height=320'],
    ['external-webp', 'https://example.com/acme-wide-logo.webp'],
  ])('uses an aspect-ratio-preserving backend chrome brand logo when enabled for %s', async (variant, logoSrc) => {
    const previousFetch = global.fetch
    const previousWindowFetch = window.fetch
    const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({
        brand: {
          name: 'Acme',
          logo: {
            src: logoSrc,
            alt: 'Acme logo',
            preserveAspectRatio: true,
          },
        },
        groups,
        settingsSections: [],
        settingsPathPrefixes: [],
        profileSections: [],
        profilePathPrefixes: [],
        grantedFeatures: [],
        roles: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as typeof fetch
    global.fetch = fetchMock
    window.fetch = fetchMock
    ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock

    try {
      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={[]}
          adminNavApi={`/api/auth/admin/nav-brand-logo-${variant}`}
        >
          <div>Child content</div>
        </AppShell>,
        { dict },
      )

      await waitFor(() => {
        const logo = screen.getByAltText('Acme logo')
        expect(logo).toHaveAttribute('src', logoSrc)
        expect(logo).toHaveAttribute('data-unoptimized', 'true')
        expect(logo).toHaveClass('object-contain')
        expect(logo).not.toHaveClass('rounded-full')
      })
      expect(screen.getByText('Acme')).toBeInTheDocument()
    } finally {
      global.fetch = previousFetch
      window.fetch = previousWindowFetch
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
    }
  })

  it('uses the cropped icon treatment for backend chrome brand logos by default', async () => {
    const previousFetch = global.fetch
    const previousWindowFetch = window.fetch
    const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
    const logoSrc = 'https://example.com/acme-wide-logo.webp'
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({
        brand: {
          name: 'Acme',
          logo: {
            src: logoSrc,
            alt: 'Acme logo',
          },
        },
        groups,
        settingsSections: [],
        settingsPathPrefixes: [],
        profileSections: [],
        profilePathPrefixes: [],
        grantedFeatures: [],
        roles: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as typeof fetch
    global.fetch = fetchMock
    window.fetch = fetchMock
    ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock

    try {
      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={[]}
          adminNavApi="/api/auth/admin/nav-brand-logo-cropped"
        >
          <div>Child content</div>
        </AppShell>,
        { dict },
      )

      await waitFor(() => {
        const logo = screen.getByAltText('Acme logo')
        expect(logo).toHaveAttribute('src', logoSrc)
        expect(logo).toHaveAttribute('data-unoptimized', 'true')
        expect(logo).toHaveClass('object-cover')
        expect(logo).toHaveClass('rounded-full')
        expect(logo).not.toHaveClass('object-contain')
      })
    } finally {
      global.fetch = previousFetch
      window.fetch = previousWindowFetch
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
    }
  })

  it('renders nested settings links when settings parent route is active', async () => {
    mockPathname = '/backend/entities/user'

    renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        settingsPathPrefixes={['/backend/entities/user']}
        settingsSections={[
          {
            id: 'data-designer',
            label: 'Data Designer',
            items: [
              {
                id: 'user-entities',
                label: 'User Entities',
                href: '/backend/entities/user',
                children: [
                  {
                    id: 'calendar-entity',
                    label: 'Calendar Entity',
                    href: '/backend/entities/user/example%3Acalendar_entity/records',
                  },
                ],
              },
            ],
          },
        ]}
      >
        <BackendModuleFrame enabled>
          <div>Settings content</div>
        </BackendModuleFrame>
      </AppShell>,
      { dict },
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Calendar Entity' })).toHaveAttribute(
        'href',
        '/backend/entities/user/example%3Acalendar_entity/records',
      )
    })
  })

  it('renders the upgrade action banner only for users who can manage upgrade actions', () => {
    const { rerender } = renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        canManageUpgradeActions={false}
      >
        <div>Child content</div>
      </AppShell>,
      { dict },
    )

    expect(screen.queryByTestId('upgrade-action-banner')).not.toBeInTheDocument()

    rerender(
      <AppShell
        email="demo@example.com"
        groups={groups}
        canManageUpgradeActions
      >
        <div>Child content</div>
      </AppShell>,
    )

    expect(screen.getByTestId('upgrade-action-banner')).toBeInTheDocument()
  })

  it('resets breadcrumb to server-provided values when pathname changes', async () => {
    mockPathname = '/backend/users'

    const { rerender } = renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        currentTitle="Users List"
        breadcrumb={[{ label: 'Users List' }]}
      >
        <div>Page content</div>
      </AppShell>,
      { dict },
    )

    const getBreadcrumbText = () => {
      const allNavs = screen.getAllByRole('navigation')
      const breadcrumbNav = allNavs.find((nav) => nav.classList.contains('text-sm'))
      return breadcrumbNav?.textContent ?? ''
    }

    await waitFor(() => {
      expect(getBreadcrumbText()).toContain('Users List')
    })

    mockPathname = '/backend'

    rerender(
      <AppShell
        email="demo@example.com"
        groups={groups}
        currentTitle=""
      >
        <div>Dashboard content</div>
      </AppShell>,
    )

    await waitFor(() => {
      expect(screen.getByText('Dashboard content')).toBeInTheDocument()
      expect(getBreadcrumbText()).not.toContain('Users List')
    })
  })

  it('keeps settings parent item active on descendant routes outside explicit child list', async () => {
    mockPathname = '/backend/entities/user/example%3Acalendar_entity'

    renderWithProviders(
      <AppShell
        email="demo@example.com"
        groups={groups}
        settingsPathPrefixes={['/backend/entities/user']}
        settingsSections={[
          {
            id: 'data-designer',
            label: 'Data Designer',
            items: [
              {
                id: 'user-entities',
                label: 'User Entities',
                href: '/backend/entities/user',
                children: [
                  {
                    id: 'calendar-entity',
                    label: 'Calendar Entity',
                    href: '/backend/entities/user/example%3Acalendar_entity/records',
                  },
                ],
              },
            ],
          },
        ]}
      >
        <BackendModuleFrame enabled>
          <div>Settings content</div>
        </BackendModuleFrame>
      </AppShell>,
      { dict },
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'User Entities' })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('link', { name: 'Calendar Entity' })).toBeInTheDocument()
    })
  })

  it('hydrates backend chrome from the shared bootstrap payload and flips the ready marker', async () => {
    const previousFetch = global.fetch
    const previousWindowFetch = window.fetch
    const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()
      if (url.includes('/api/auth/admin/nav')) {
        return new Response(JSON.stringify({
          groups: [
            {
              id: 'core',
              name: 'Core',
              defaultName: 'Core',
              items: [
                {
                  href: '/backend/users',
                  title: 'Users List',
                  defaultTitle: 'Users List',
                  enabled: true,
                },
              ],
            },
          ],
          settingsSections: [],
          settingsPathPrefixes: [],
          profileSections: [],
          profilePathPrefixes: ['/backend/profile/'],
          grantedFeatures: ['auth.*'],
          roles: ['admin'],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    global.fetch = fetchMock
    window.fetch = fetchMock
    ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock

    try {
      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={[]}
          adminNavApi="/api/auth/admin/nav"
        >
          <BackendModuleFrame enabled>
            <div>Hydrated content</div>
          </BackendModuleFrame>
        </AppShell>,
        { dict },
      )

      expect(screen.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'false')

      await waitFor(() => {
        expect(screen.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true')
        expect(screen.getByText('Users List')).toBeInTheDocument()
      })
    } finally {
      global.fetch = previousFetch
      window.fetch = previousWindowFetch
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
    }
  })

  it('has no global sidebar: the topbar carries the brand and the module switcher', () => {
    const { container } = renderWithProviders(
      <AppShell email="demo@example.com" groups={groups} productName="Operis">
        <div>Content</div>
      </AppShell>,
      { dict },
    )
    expect(container.querySelector('#appshell-sidebar')).toBeNull()
    expect(container.querySelector('aside')).toBeNull()
    const header = document.querySelector('header') as HTMLElement
    const brand = within(header).getByTestId('appshell-brand')
    expect(brand).toHaveAttribute('href', '/backend')
    expect(within(header).getByTestId('module-switcher-trigger')).toBeInTheDocument()
  })

  it('publishes a --topbar-height that clears the topbar and its rule', () => {
    const { container } = renderWithProviders(
      <AppShell email="demo@example.com" groups={groups}>
        <div>Content</div>
      </AppShell>,
      { dict },
    )
    const root = container.querySelector('[data-app-shell-column]')?.parentElement as HTMLElement
    expect(root.style.getPropertyValue('--topbar-height')).toBe('64px')
  })

  describe('module sidebar', () => {
    const moduleGroups = [
      {
        id: 'customers.nav.group',
        name: 'Customers',
        iconName: 'users',
        items: [
          { href: '/backend/customers/people', title: 'People' },
          {
            href: '/backend/customers/deals',
            title: 'Deals',
            children: [
              { href: '/backend/customers/deals/pipeline', title: 'Sales Pipeline' },
              { href: '/backend/customers/deals/map', title: 'Deals Map' },
            ],
          },
          { href: '/backend/customers/hidden', title: 'Hidden Page', hidden: true },
        ],
      },
      {
        id: 'catalog.nav.group',
        name: 'Catalog',
        items: [{ href: '/backend/catalog/products', title: 'Products' }],
      },
    ]

    function renderModulePage(options: { enabled?: boolean; shellGroups?: typeof moduleGroups } = {}) {
      return renderWithProviders(
        <AppShell email="demo@example.com" groups={options.shellGroups ?? moduleGroups}>
          <BackendModuleFrame enabled={options.enabled ?? true}>
            <div>Page content</div>
          </BackendModuleFrame>
        </AppShell>,
        { dict },
      )
    }

    it('lists only the pages of the module the route belongs to', () => {
      mockPathname = '/backend/customers/people/123'
      renderModulePage()
      const sidebar = screen.getByTestId('module-sidebar')
      expect(sidebar).toHaveAttribute('aria-label', 'Customers navigation')
      expect(within(sidebar).getByText('Customers')).toBeInTheDocument()
      expect(within(sidebar).getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page')
      expect(within(sidebar).getByRole('link', { name: 'Deals' })).toBeInTheDocument()
      expect(within(sidebar).queryByRole('link', { name: 'Products' })).toBeNull()
      expect(within(sidebar).queryByRole('link', { name: 'Hidden Page' })).toBeNull()
      expect(screen.getByText('Page content')).toBeInTheDocument()
    })

    it('always lists subpages, and marks the subpage active rather than its parent', () => {
      mockPathname = '/backend/customers/deals/pipeline'
      renderModulePage()
      const sidebar = screen.getByTestId('module-sidebar')
      expect(within(sidebar).getByRole('link', { name: 'Deals Map' })).toBeInTheDocument()
      expect(within(sidebar).getByRole('link', { name: 'Sales Pipeline' })).toHaveAttribute('aria-current', 'page')
      expect(within(sidebar).getByRole('link', { name: 'Deals' })).not.toHaveAttribute('aria-current')
    })

    it('does not treat a sibling path with the same prefix as part of the branch', () => {
      mockPathname = '/backend/customers/people-archive'
      renderModulePage()
      expect(screen.queryByTestId('module-sidebar')).toBeNull()
    })

    it('renders no sidebar on a page that opted out, keeping the page in the same wrapper', () => {
      mockPathname = '/backend/customers/people'
      renderModulePage({ enabled: false })
      expect(screen.queryByTestId('module-sidebar')).toBeNull()
      expect(screen.getByText('Page content').closest('[data-module-frame]')).not.toBeNull()
    })

    it('places a hidden detail route in its declared module and lights its breadcrumb parent', () => {
      mockPathname = '/backend/customers/people-v2/123'
      renderWithProviders(
        <AppShell email="demo@example.com" groups={moduleGroups}>
          <BackendModuleFrame enabled routeGroupId="customers.nav.group" routeParentHref="/backend/customers/people">
            <div>Detail content</div>
          </BackendModuleFrame>
        </AppShell>,
        { dict },
      )
      const sidebar = screen.getByTestId('module-sidebar')
      expect(sidebar).toHaveAttribute('aria-label', 'Customers navigation')
      expect(within(sidebar).getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByTestId('module-switcher-current')).toHaveTextContent('Customers')
    })

    it('renders no sidebar when the route belongs to no module', () => {
      mockPathname = '/backend/unknown'
      renderModulePage()
      expect(screen.queryByTestId('module-sidebar')).toBeNull()
    })

    it('hosts the backend:sidebar:* injection spots so existing widgets keep a home', () => {
      mockPathname = '/backend/customers/people'
      renderModulePage()
      const sidebar = screen.getByTestId('module-sidebar')
      for (const spotId of ['backend:sidebar:top', 'backend:sidebar:nav', 'backend:sidebar:nav:footer', 'backend:sidebar:footer']) {
        expect(within(sidebar).getByTestId(`injection-spot:${spotId}`)).toBeInTheDocument()
      }
    })

    it('shows the settings sections, grouped, on a settings route', () => {
      mockPathname = '/backend/config/system'
      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={moduleGroups}
          settingsSectionTitle="Settings"
          settingsPathPrefixes={['/backend/config']}
          settingsSections={[
            { id: 'system', label: 'System', order: 1, items: [{ id: 'sys', label: 'System Status', href: '/backend/config/system' }] },
            { id: 'auth', label: 'Auth', order: 2, items: [{ id: 'users', label: 'Users', href: '/backend/config/users' }] },
          ]}
        >
          <BackendModuleFrame enabled>
            <div>Settings content</div>
          </BackendModuleFrame>
        </AppShell>,
        { dict },
      )
      const sidebar = screen.getByTestId('module-sidebar')
      expect(sidebar).toHaveAttribute('aria-label', 'Settings navigation')
      expect(within(sidebar).getByText('System')).toBeInTheDocument()
      expect(within(sidebar).getByText('Auth')).toBeInTheDocument()
      expect(within(sidebar).getByRole('link', { name: 'System Status' })).toHaveAttribute('aria-current', 'page')
      expect(within(sidebar).queryByRole('link', { name: 'People' })).toBeNull()
      expect(screen.getByTestId('module-switcher-current')).toHaveTextContent('Modules')
    })

    it('lists profile-context pages from other modules in the Profile sidebar', () => {
      mockPathname = '/backend/profile/notification-preferences'
      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={[
            ...moduleGroups,
            {
              id: 'notifications.preferences.profileGroup',
              name: 'Profile',
              items: [{ href: '/backend/profile/notification-preferences', title: 'Notification Preferences', pageContext: 'profile' as const }],
            },
          ]}
          profileSectionTitle="Profile"
          profilePathPrefixes={['/backend/profile/']}
          profileSections={[
            { id: 'account', label: 'Account', items: [{ id: 'pw', label: 'Change Password', href: '/backend/profile/change-password' }] },
          ]}
        >
          <BackendModuleFrame enabled>
            <div>Profile content</div>
          </BackendModuleFrame>
        </AppShell>,
        { dict },
      )
      const sidebar = screen.getByTestId('module-sidebar')
      const links = within(sidebar).getAllByRole('link').map((link) => link.textContent)
      expect(links).toEqual(['Change Password', 'Notification Preferences'])
      expect(within(sidebar).getByRole('link', { name: 'Notification Preferences' })).toHaveAttribute('aria-current', 'page')
    })

    it('renders item icons from iconName when iconMarkup is missing', async () => {
      mockPathname = '/backend/checkout/pay-links'
      renderModulePage({
        shellGroups: [
          {
            id: 'checkout',
            name: 'Checkout',
            items: [{ href: '/backend/checkout/pay-links', title: 'Pay Links', iconName: 'ticket' } as never],
          },
        ],
      })
      const link = screen.getByRole('link', { name: 'Pay Links' })
      expect(link.querySelector('svg.lucide-ticket')).toBeTruthy()
    })

    // Regression: #1828 — a placeholder, never stale SSR groups, while the nav payload loads
    it('holds the column with a placeholder while the navigation loads, then shows fresh pages', async () => {
      const previousFetch = global.fetch
      const previousWindowFetch = window.fetch
      const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
      let resolveFetch: ((response: Response) => void) | null = null
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
        if (url.includes('/api/auth/admin/nav-module-sidebar-loading')) return fetchPromise
        return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
      }) as unknown as typeof fetch
      global.fetch = fetchMock
      window.fetch = fetchMock
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock
      mockPathname = '/backend/users'
      try {
        const { container } = renderWithProviders(
          <AppShell
            email="demo@example.com"
            groups={[{ id: 'core', name: 'Stale Core', items: [{ href: '/backend/users', title: 'Stale Link' }] }]}
            adminNavApi="/api/auth/admin/nav-module-sidebar-loading"
          >
            <BackendModuleFrame enabled>
              <div>Page content</div>
            </BackendModuleFrame>
          </AppShell>,
          { dict },
        )
        expect(container.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull()
        expect(screen.queryByText('Stale Link')).toBeNull()
        resolveFetch?.(new Response(JSON.stringify({
          groups: [{ id: 'core', name: 'Core', defaultName: 'Core', items: [{ href: '/backend/users', title: 'Fresh Link', defaultTitle: 'Fresh Link', enabled: true }] }],
          settingsSections: [],
          settingsPathPrefixes: [],
          profileSections: [],
          profilePathPrefixes: [],
          grantedFeatures: ['auth.*'],
          roles: ['admin'],
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
        await waitFor(() => {
          expect(screen.getByRole('link', { name: 'Fresh Link' })).toHaveAttribute('aria-current', 'page')
        })
        expect(screen.queryByText('Stale Link')).toBeNull()
      } finally {
        global.fetch = previousFetch
        window.fetch = previousWindowFetch
        ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
      }
    })
  })

  describe('module switcher', () => {
    const switcherGroups = [
      {
        id: 'customers.nav.group',
        name: 'Customers',
        iconName: 'users',
        items: [
          { href: '/backend/customers/people', title: 'People' },
          { href: '/backend/customers/companies', title: 'Companies' },
        ],
      },
      {
        id: 'tasks.nav.group',
        name: 'Tasks',
        items: [
          { href: '/backend/tasks/disabled', title: 'Disabled', enabled: false },
          { href: '/backend/tasks/today', title: 'My Tasks' },
        ],
      },
      {
        id: 'settings-only',
        name: 'Settings Only',
        items: [{ href: '/backend/config/secret', title: 'Secret', pageContext: 'settings' as const }],
      },
    ]

    function renderSwitcher(shellGroups: typeof switcherGroups | [] = switcherGroups) {
      return renderWithProviders(
        <AppShell email="demo@example.com" groups={shellGroups as typeof switcherGroups}>
          <div>Content</div>
        </AppShell>,
        { dict },
      )
    }

    function openSwitcher() {
      fireEvent.click(screen.getByTestId('module-switcher-trigger'))
      return screen.getByTestId('module-switcher')
    }

    it('names the current module on the trigger', () => {
      mockPathname = '/backend/customers/companies'
      renderSwitcher()
      expect(screen.getByTestId('module-switcher-current')).toHaveTextContent('Customers')
      expect(screen.getByTestId('module-switcher-trigger')).toHaveAttribute('aria-label', 'Switch module, current: Customers')
    })

    it('lists each reachable module once, opening it at its first enabled page', () => {
      mockPathname = '/backend/customers/companies'
      renderSwitcher()
      const menu = openSwitcher()
      const tiles = within(menu).getAllByRole('link').filter((el) => el.hasAttribute('data-module-tile'))
      expect(tiles.map((tile) => tile.textContent)).toEqual(['Customers', 'Tasks'])
      expect(tiles[0]).toHaveAttribute('href', '/backend/customers/people')
      expect(tiles[0]).toHaveAttribute('aria-current', 'page')
      expect(tiles[1]).toHaveAttribute('href', '/backend/tasks/today')
      expect(tiles[1]).not.toHaveAttribute('aria-current')
      expect(tiles[0].querySelector('svg.lucide-users')).toBeTruthy()
    })

    it('filters modules by name or page title and lists matching pages', () => {
      mockPathname = '/backend'
      renderSwitcher()
      const menu = openSwitcher()
      fireEvent.change(within(menu).getByRole('searchbox'), { target: { value: 'compan' } })
      const tiles = within(menu).getAllByRole('link').filter((el) => el.hasAttribute('data-module-tile'))
      expect(tiles.map((tile) => tile.textContent)).toEqual(['Customers'])
      const pageLink = within(menu).getByRole('link', { name: /Companies/ })
      expect(pageLink).toHaveAttribute('href', '/backend/customers/companies')
    })

    it('says so when nothing matches the search', () => {
      renderSwitcher()
      const menu = openSwitcher()
      fireEvent.change(within(menu).getByRole('searchbox'), { target: { value: 'zzz' } })
      expect(within(menu).getByText('Nothing matches your search')).toBeInTheDocument()
    })

    it('shows an empty state when the viewer can reach no module', () => {
      renderSwitcher([])
      const menu = openSwitcher()
      expect(within(menu).getByText('No modules available')).toBeInTheDocument()
    })

    it('offers drag-to-rearrange only to viewers who can save it, and not while searching', async () => {
      const previousFetch = global.fetch
      const previousWindowFetch = window.fetch
      const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
        if (url.includes('/api/auth/admin/nav-reorder')) {
          return new Response(JSON.stringify({
            groups: switcherGroups,
            settingsSections: [],
            settingsPathPrefixes: [],
            profileSections: [],
            profilePathPrefixes: [],
            grantedFeatures: ['auth.sidebar.manage'],
            roles: ['admin'],
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(JSON.stringify({ settings: { groupOrder: [] }, updatedAt: null }), { status: 200, headers: { 'content-type': 'application/json' } })
      }) as unknown as typeof fetch
      global.fetch = fetchMock
      window.fetch = fetchMock
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock
      try {
        renderWithProviders(
          <AppShell email="demo@example.com" groups={[]} adminNavApi="/api/auth/admin/nav-reorder">
            <div>Content</div>
          </AppShell>,
          { dict },
        )
        await waitFor(() => expect(screen.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true'))
        const menu = openSwitcher()
        expect(within(menu).getByTestId('module-switcher-footer')).toHaveTextContent('Drag to rearrange')
        const tile = within(menu).getAllByRole('link').find((el) => el.hasAttribute('data-module-tile')) as HTMLElement
        expect(tile).toHaveAttribute('aria-describedby')
        expect(tile).not.toHaveAttribute('role')
        expect(tile).not.toHaveAttribute('aria-roledescription')
        expect(tile).not.toHaveAttribute('aria-pressed')
        const grid = within(menu).getByRole('list', { name: 'Modules' })
        tile.focus()
        fireEvent.keyDown(tile, { code: 'Space', key: ' ' })
        await waitFor(() => expect(grid).toHaveAttribute('data-dragging', 'true'))
        await new Promise((resolve) => setTimeout(resolve, 0))
        fireEvent.keyDown(tile, { code: 'Escape', key: 'Escape' })
        await waitFor(() => expect(grid).not.toHaveAttribute('data-dragging'))
        expect(screen.getByTestId('module-switcher')).toBeInTheDocument()
        fireEvent.change(within(menu).getByRole('searchbox'), { target: { value: 'cust' } })
        expect(within(menu).queryByTestId('module-switcher-footer')).toBeNull()
      } finally {
        global.fetch = previousFetch
        window.fetch = previousWindowFetch
        ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
      }
    })

    it('offers Reset for a saved order even when the switcher opened before the navigation loaded', async () => {
      const previousFetch = global.fetch
      const previousWindowFetch = window.fetch
      const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
      const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
        if (url.includes('/api/auth/admin/nav-late')) {
          return new Response(JSON.stringify({
            groups: switcherGroups,
            settingsSections: [],
            settingsPathPrefixes: [],
            profileSections: [],
            profilePathPrefixes: [],
            grantedFeatures: ['auth.sidebar.manage'],
            roles: ['admin'],
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(
          JSON.stringify({ settings: { groupOrder: ['tasks.nav.group', 'customers.nav.group'] }, updatedAt: 'v1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }) as unknown as typeof fetch
      global.fetch = fetchMock
      window.fetch = fetchMock
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock
      try {
        renderWithProviders(
          <AppShell email="demo@example.com" groups={[]} adminNavApi="/api/auth/admin/nav-late">
            <div>Content</div>
          </AppShell>,
          { dict },
        )
        fireEvent.click(screen.getByTestId('module-switcher-trigger'))
        const reset = await screen.findByTestId('module-switcher-reset')
        await waitFor(() => expect(reset).not.toHaveClass('invisible'))
      } finally {
        global.fetch = previousFetch
        window.fetch = previousWindowFetch
        ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
      }
    })

    it('offers no reordering without permission', () => {
      renderSwitcher()
      const menu = openSwitcher()
      expect(within(menu).queryByTestId('module-switcher-footer')).toBeNull()
      const tile = within(menu).getAllByRole('link').find((el) => el.hasAttribute('data-module-tile')) as HTMLElement
      expect(tile).not.toHaveAttribute('aria-describedby')
    })

    it('moves focus from the search into the grid with the arrow keys', () => {
      renderSwitcher()
      const menu = openSwitcher()
      fireEvent.keyDown(within(menu).getByRole('searchbox'), { key: 'ArrowDown' })
      const tiles = within(menu).getAllByRole('link').filter((el) => el.hasAttribute('data-module-tile'))
      expect(document.activeElement).toBe(tiles[0])
      fireEvent.keyDown(tiles[0], { key: 'ArrowRight' })
      expect(document.activeElement).toBe(tiles[1])
    })
  })
})
