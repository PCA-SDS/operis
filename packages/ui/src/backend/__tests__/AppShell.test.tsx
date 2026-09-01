/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import { AppShell, ApplyBreadcrumb } from '../AppShell'
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
  'appShell.closeMenu': 'Close',
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

    expect(screen.getByText('Users List')).toBeInTheDocument()
    expect(screen.getAllByText('Terms')[0]).toBeInTheDocument()
    expect(screen.getByTestId('flash-messages')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:layout:top')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:record:current')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:layout:footer')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:sidebar:top')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:backend:sidebar:footer')).toBeInTheDocument()
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
        <div>Settings content</div>
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

  describe('sidebar layout contract', () => {
    function renderRail() {
      mockPathname = '/backend/users'
      return renderWithProviders(
        <AppShell email="demo@example.com" groups={groups} productName="Operis">
          <div>Content</div>
        </AppShell>,
        { dict },
      )
    }

    it('gives the brand row the same height as the topbar so the two share a centre line', () => {
      renderRail()
      const brand = screen.getByLabelText('Go to dashboard')
      expect(brand.className).toContain('h-16')
      expect(document.querySelector('header')?.className).toContain('h-16')
    })

    it('lets the nav scroll area span the same width as the search field above it', () => {
      const { container } = renderRail()
      const scrollArea = container.querySelector('[data-sidebar-scroll="true"]') as HTMLElement
      // A negative margin or an extra right pad here is what made the rows 4px
      // narrower than the search input.
      expect(scrollArea.className).not.toMatch(/-ml-|-mr-|\bpr-\d/)
      expect(scrollArea.className).toContain('min-h-0')
    })

    it('lets every row label shrink so long titles truncate instead of overflowing', () => {
      renderRail()
      const label = screen.getByText('Users List')
      expect(label.className).toContain('min-w-0')
      expect(label.className).toContain('truncate')
    })

    it('hides the sidebar footer entirely when no module fills its spots', () => {
      const { container } = renderRail()
      const footer = container.querySelector('.sticky.bottom-0') as HTMLElement
      expect(footer.className).toContain('empty:hidden')
    })

    it('wires each group heading to the region it expands', () => {
      renderRail()
      const heading = screen.getByRole('button', { name: /Core/ })
      expect(heading).toHaveAttribute('type', 'button')
      const regionId = heading.getAttribute('aria-controls')
      expect(regionId).toBeTruthy()
      expect(document.getElementById(regionId as string)).not.toBeNull()
    })

    it('names the nav landmark', () => {
      renderRail()
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    })

    it('publishes a --topbar-height that clears the topbar and its rule', () => {
      const { container } = renderRail()
      const shell = container.querySelector('[style*="--topbar-height"]') as HTMLElement
      expect(shell.style.getPropertyValue('--topbar-height')).toBe('65px')
    })
  })

  describe('sidebar loading placeholder', () => {
    /** Render the rail with its chrome request left pending, so the skeleton stays up. */
    async function renderLoadingRail() {
      const previousFetch = global.fetch
      const previousWindowFetch = window.fetch
      const fetchMock = jest.fn(
        () => new Promise<Response>(() => {}),
      ) as unknown as typeof fetch
      global.fetch = fetchMock
      window.fetch = fetchMock
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock

      const view = renderWithProviders(
        <AppShell email="demo@example.com" groups={groups} adminNavApi="/api/auth/admin/nav-loading">
          <div>Content</div>
        </AppShell>,
        { dict },
      )
      await waitFor(() => {
        expect(screen.getAllByTestId('backend-chrome-loading').length).toBeGreaterThan(0)
      })
      const restore = () => {
        global.fetch = previousFetch
        window.fetch = previousWindowFetch
      }
      const rail = screen.getAllByTestId('backend-chrome-loading')[0] as HTMLElement
      return { view, rail, restore }
    }

    it('announces itself as busy instead of loading in silence', async () => {
      const { rail, restore } = await renderLoadingRail()
      try {
        expect(rail).toHaveAttribute('role', 'status')
        expect(rail).toHaveAttribute('aria-busy', 'true')
        expect(rail).toHaveAttribute('aria-label', 'Loading navigation')
      } finally {
        restore()
      }
    })

    it('stands its rows on the same box a real nav row uses, so nothing shifts on load', async () => {
      const { rail, restore } = await renderLoadingRail()
      try {
        const rows = Array.from(rail.querySelectorAll('.h-10.px-3.gap-3'))
        expect(rows.length).toBeGreaterThanOrEqual(7)
        for (const row of rows) {
          // Full-width blocks with no inner padding is what put the old
          // placeholder 12px left of every real row icon.
          expect(row.className).toContain('px-3')
          expect(row.className).toContain('items-center')
        }
      } finally {
        restore()
      }
    })

    it('gives each row an icon square and a label bar, not one undifferentiated slab', async () => {
      const { rail, restore } = await renderLoadingRail()
      try {
        const row = rail.querySelector('.h-10.px-3.gap-3') as HTMLElement
        const parts = Array.from(row.children) as HTMLElement[]
        expect(parts).toHaveLength(2)
        expect(parts[0].className).toContain('size-5')
        expect(parts[1].className).toMatch(/\bw-\d+\b/)
      } finally {
        restore()
      }
    })

    it('varies the label widths so the column reads as names rather than a bar chart', async () => {
      const { rail, restore } = await renderLoadingRail()
      try {
        const widths = Array.from(rail.querySelectorAll('.h-3'))
          .map((node) => (node.className.match(/\bw-\d+\b/) ?? [''])[0])
          .filter(Boolean)
        expect(widths.length).toBeGreaterThanOrEqual(7)
        expect(new Set(widths).size).toBeGreaterThan(1)
      } finally {
        restore()
      }
    })

    it('keeps the group overline short instead of a rail-wide slab', async () => {
      const { rail, restore } = await renderLoadingRail()
      try {
        const headings = Array.from(rail.querySelectorAll('.h-8.px-3'))
        expect(headings.length).toBeGreaterThanOrEqual(2)
        for (const heading of headings) {
          const bar = heading.firstElementChild as HTMLElement
          expect(bar.className).toContain('w-16')
          expect(bar.className).not.toContain('w-full')
        }
      } finally {
        restore()
      }
    })

    it('separates its groups with the same divider the loaded rail uses', async () => {
      const { rail, restore } = await renderLoadingRail()
      try {
        // One divider for two groups — between them, not after the last.
        expect(rail.querySelectorAll('.border-t.border-sidebar-border')).toHaveLength(1)
      } finally {
        restore()
      }
    })

    it('respects reduced motion rather than pulsing regardless', async () => {
      const { rail, restore } = await renderLoadingRail()
      try {
        const bar = rail.querySelector('.animate-pulse') as HTMLElement
        expect(bar.className).toContain('motion-reduce:animate-none')
      } finally {
        restore()
      }
    })
  })

  describe('sidebar scroll affordance', () => {
    function renderScrollableRail() {
      mockPathname = '/backend/users'
      const many = {
        id: 'core',
        name: 'Core',
        items: Array.from({ length: 40 }, (unused, index) => ({
          href: `/backend/item-${index}`,
          title: `Item ${index}`,
        })),
      }
      const view = renderWithProviders(
        <AppShell email="demo@example.com" groups={[many]}>
          <div>Content</div>
        </AppShell>,
        { dict },
      )
      const scrollArea = view.container.querySelector('[data-sidebar-scroll="true"]') as HTMLElement
      // jsdom has no layout, so the scroll geometry the affordance reads is staged here.
      Object.defineProperty(scrollArea, 'clientHeight', { configurable: true, value: 400 })
      Object.defineProperty(scrollArea, 'scrollHeight', { configurable: true, value: 1600 })
      return { ...view, scrollArea }
    }

    it('fades the list only while there is more of it below', async () => {
      const { container, scrollArea } = renderScrollableRail()

      scrollArea.scrollTop = 0
      scrollArea.dispatchEvent(new Event('scroll'))
      await waitFor(() => {
        expect(container.querySelector('[data-sidebar-scroll-chevron="down"]')).not.toBeNull()
      })
      expect(container.querySelector('.bg-gradient-to-t')).not.toBeNull()

      // At the bottom there is nothing left to hint at, and a fade held on here
      // is what washed out the last row.
      scrollArea.scrollTop = 1200
      scrollArea.dispatchEvent(new Event('scroll'))
      await waitFor(() => {
        expect(container.querySelector('[data-sidebar-scroll-chevron="up"]')).not.toBeNull()
      })
      expect(container.querySelector('.bg-gradient-to-t')).toBeNull()
    })

    it('reserves the affordance band so the last row can scroll clear of the chevron', async () => {
      const { scrollArea } = renderScrollableRail()

      scrollArea.scrollTop = 0
      scrollArea.dispatchEvent(new Event('scroll'))
      await waitFor(() => {
        expect(scrollArea.className).toContain('pb-10')
      })
    })

    it('reserves nothing when the nav fits without scrolling', () => {
      mockPathname = '/backend/users'
      const { container } = renderWithProviders(
        <AppShell email="demo@example.com" groups={groups}>
          <div>Content</div>
        </AppShell>,
        { dict },
      )
      const scrollArea = container.querySelector('[data-sidebar-scroll="true"]') as HTMLElement
      expect(scrollArea.className).not.toContain('pb-10')
      expect(container.querySelector('[data-testid="sidebar-scroll-chevron"]')).toBeNull()
    })
  })

  describe('main-nav subpages', () => {
    const dealsGroups = [
      {
        id: 'customers',
        name: 'Customers',
        items: [
          {
            href: '/backend/customers/deals',
            title: 'Deals',
            children: [
              { href: '/backend/customers/deals/pipeline', title: 'Sales Pipeline' },
              { href: '/backend/customers/deals/map', title: 'Deals Map' },
            ],
          },
        ],
      },
    ]

    it('lists subpages even when the route is nowhere near their parent', async () => {
      mockPathname = '/backend/users'

      renderWithProviders(
        <AppShell email="demo@example.com" groups={dealsGroups}>
          <div>Content</div>
        </AppShell>,
        { dict },
      )

      expect(screen.getByRole('link', { name: 'Sales Pipeline' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Deals Map' })).toBeInTheDocument()
    })

    it('indents subpages without drawing a guide line beside them', async () => {
      mockPathname = '/backend/users'

      const { container } = renderWithProviders(
        <AppShell email="demo@example.com" groups={dealsGroups}>
          <div>Content</div>
        </AppShell>,
        { dict },
      )

      const child = screen.getByRole('link', { name: 'Sales Pipeline' })
      // One 12px step in from the parent's `px-3`, so a child icon lands where
      // a parent label starts.
      expect(child.className).toContain('pl-6')
      expect(container.querySelector('.bg-sidebar-border.w-px')).toBeNull()
    })

    it('keeps the parent row inactive while the route sits outside its branch', async () => {
      mockPathname = '/backend/users'

      renderWithProviders(
        <AppShell email="demo@example.com" groups={dealsGroups}>
          <div>Content</div>
        </AppShell>,
        { dict },
      )

      expect(screen.getByRole('link', { name: 'Deals' }).className).not.toContain('bg-sidebar-primary')
    })

    it('marks the subpage active, not its parent, when the route is on the subpage', async () => {
      mockPathname = '/backend/customers/deals/pipeline'

      renderWithProviders(
        <AppShell email="demo@example.com" groups={dealsGroups}>
          <div>Content</div>
        </AppShell>,
        { dict },
      )

      expect(screen.getByRole('link', { name: 'Sales Pipeline' }).className).toContain('bg-sidebar-primary')
      expect(screen.getByRole('link', { name: 'Deals' }).className).not.toContain('bg-sidebar-primary')
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
        <div>Settings content</div>
      </AppShell>,
      { dict },
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'User Entities' })).toHaveClass('bg-sidebar-primary')
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
          <div>Hydrated content</div>
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

  describe('section sidebar (settings/profile mode)', () => {
    it('swaps the section nav into the single rail, replacing the main nav', async () => {
      mockPathname = '/backend/entities/user'

      const { container } = renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={groups}
          settingsPathPrefixes={['/backend/entities/user']}
          settingsSections={[
            {
              id: 'data-designer',
              label: 'Data Designer',
              items: [
                { id: 'user-entities', label: 'User Entities', href: '/backend/entities/user' },
              ],
            },
          ]}
        >
          <div>Settings content</div>
        </AppShell>,
        { dict },
      )

      await waitFor(() => {
        expect(screen.getByText('User Entities')).toBeInTheDocument()
      })

      const sectionAside = screen.getByTestId('appshell-section-sidebar')
      expect(within(sectionAside).getByText('User Entities')).toBeInTheDocument()
      // One rail: the main nav is not rendered alongside the section nav on
      // desktop. The mobile drawer still mounts it, so scope to the aside.
      const desktopAside = container.querySelector('aside') as HTMLElement
      expect(desktopAside.contains(sectionAside)).toBe(true)
      expect(desktopAside.querySelector('a[href="/backend/users"]')).toBeNull()
      expect(desktopAside.querySelector('a[href="/backend/roles"]')).toBeNull()
    })

    it('renders exactly one desktop sidebar column', async () => {
      mockPathname = '/backend/entities/user'

      const { container } = renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={groups}
          settingsPathPrefixes={['/backend/entities/user']}
          settingsSections={[
            {
              id: 'data-designer',
              label: 'Data Designer',
              items: [
                { id: 'user-entities', label: 'User Entities', href: '/backend/entities/user' },
              ],
            },
          ]}
        >
          <div>Settings content</div>
        </AppShell>,
        { dict },
      )

      await waitFor(() => {
        expect(screen.getByText('User Entities')).toBeInTheDocument()
      })

      const asides = container.querySelectorAll('aside')
      expect(asides.length).toBe(1)
      expect((asides[0] as HTMLElement).style.width).toBe('304px')
    })

    it('section header renders chevron + title as a single Back-to-Main link', async () => {
      mockPathname = '/backend/entities/user'

      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={groups}
          settingsSectionTitle="Settings"
          settingsPathPrefixes={['/backend/entities/user']}
          settingsSections={[
            {
              id: 'data-designer',
              label: 'Data Designer',
              items: [
                { id: 'user-entities', label: 'User Entities', href: '/backend/entities/user' },
              ],
            },
          ]}
        >
          <div>Settings content</div>
        </AppShell>,
        { dict },
      )

      const backLink = await screen.findByTestId('appshell-section-back-to-main')
      expect(backLink).toHaveAttribute('href', '/backend')
      expect(backLink).toHaveAttribute('aria-label', 'Back to Main')
      expect(backLink.textContent).toContain('Settings')
    })

    it('renders the built-in wordmark inline, once, without repeating the name beside it', async () => {
      mockPathname = '/backend'
      const { container } = renderWithProviders(
        <AppShell email="demo@example.com" groups={groups} productName="Operis">
          <div>Content</div>
        </AppShell>,
        { dict },
      )

      const header = await screen.findByLabelText('Go to dashboard')
      // Inline <svg>, not <img>: an external file cannot inherit the sidebar's ink.
      const svg = header.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(header.querySelector('img')).toBeNull()
      // <title> is the lockup's accessible name, so the header still reads "Operis"...
      expect(within(header).getByTitle('Operis')).toBeInTheDocument()
      // ...but only once: the brand <span> beside it would be the same word twice.
      expect(header.querySelector('span')).toBeNull()
      expect(container.querySelectorAll('a[aria-label="Go to dashboard"]').length).toBe(1)
    })

    it('keeps the name beside the mark when the brand is whitelabelled', async () => {
      mockPathname = '/backend'
      renderWithProviders(
        <AppShell email="demo@example.com" groups={groups} productName="Acme Ops">
          <div>Content</div>
        </AppShell>,
        { dict },
      )

      const header = await screen.findByLabelText('Go to dashboard')
      expect(header.textContent).toContain('Acme Ops')
      expect(header.querySelector('svg')).not.toBeNull()
    })

    it('renders settings and profile section navs with identical chrome-row treatment', async () => {
      const settingsSections = [
        {
          id: 'data-designer',
          label: 'Data Designer',
          items: [
            { id: 'user-entities', label: 'User Entities', href: '/backend/entities/user' },
            { id: 'user-records', label: 'User Records', href: '/backend/entities/records' },
          ],
        },
      ]
      const profileSections = [
        {
          id: 'account',
          label: 'Account',
          items: [
            { id: 'security', label: 'Security', href: '/backend/profile/security' },
            { id: 'sessions', label: 'Sessions', href: '/backend/profile/sessions' },
          ],
        },
      ]

      mockPathname = '/backend/entities/user'
      const settingsRender = renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={groups}
          settingsPathPrefixes={['/backend/entities/user']}
          settingsSections={settingsSections}
          profileSections={profileSections}
          profilePathPrefixes={['/backend/profile/']}
        >
          <div>Settings content</div>
        </AppShell>,
        { dict },
      )

      const settingsAside = await screen.findByTestId('appshell-section-sidebar')
      const settingsIdle = within(settingsAside).getByText('User Records').closest('a')
      expect(settingsIdle?.className).toContain('hover:bg-sidebar-accent')
      expect(settingsIdle?.className).toContain('rounded-lg')

      settingsRender.unmount()

      mockPathname = '/backend/profile/security'
      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={groups}
          settingsPathPrefixes={['/backend/entities/user']}
          settingsSections={settingsSections}
          profileSections={profileSections}
          profilePathPrefixes={['/backend/profile/']}
        >
          <div>Profile content</div>
        </AppShell>,
        { dict },
      )

      const profileAside = await screen.findByTestId('appshell-section-sidebar')
      const profileIdle = within(profileAside).getByText('Sessions').closest('a')
      expect(profileIdle?.className).toContain('hover:bg-sidebar-accent')
      expect(profileIdle?.className).toContain('rounded-lg')
    })

    it('gives the section sidebar its own nav search now that it is the only column', async () => {
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
                { id: 'user-entities', label: 'User Entities', href: '/backend/entities/user' },
              ],
            },
          ]}
        >
          <div>Settings content</div>
        </AppShell>,
        { dict },
      )

      const sectionAside = await screen.findByTestId('appshell-section-sidebar')
      expect(within(sectionAside).getAllByLabelText('Search navigation').length).toBeGreaterThan(0)
    })

    it('does not render the section sidebar when on a main route', async () => {
      mockPathname = '/backend/users'

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
                { id: 'user-entities', label: 'User Entities', href: '/backend/entities/user' },
              ],
            },
          ]}
        >
          <div>Main content</div>
        </AppShell>,
        { dict },
      )

      expect(screen.queryByTestId('appshell-section-sidebar')).toBeNull()
      expect(screen.queryByTestId('appshell-section-back-to-main')).toBeNull()
    })
  })

  it('renders nav icons from iconName when iconMarkup is missing', async () => {
    const previousFetch = global.fetch
    const previousWindowFetch = window.fetch
    const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()
      if (url.includes('/api/auth/admin/nav-icon-fallback')) {
        return new Response(JSON.stringify({
          groups: [
            {
              id: 'checkout',
              name: 'Checkout',
              defaultName: 'Checkout',
              items: [
                {
                  href: '/backend/checkout/pay-links',
                  title: 'Pay Links',
                  defaultTitle: 'Pay Links',
                  enabled: true,
                  iconName: 'ticket',
                },
              ],
            },
          ],
          settingsSections: [],
          settingsPathPrefixes: [],
          profileSections: [],
          profilePathPrefixes: ['/backend/profile/'],
          grantedFeatures: ['checkout.view'],
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
          adminNavApi="/api/auth/admin/nav-icon-fallback"
        >
          <div>Hydrated content</div>
        </AppShell>,
        { dict },
      )

      await waitFor(() => {
        expect(screen.getByText('Pay Links')).toBeInTheDocument()
      }, { timeout: 10_000 })

      const link = screen.getByRole('link', { name: 'Pay Links' })
      expect(link.querySelector('svg.lucide-ticket')).toBeTruthy()
    } finally {
      global.fetch = previousFetch
      window.fetch = previousWindowFetch
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
    }
  })

  // Regression: #1828 — skeleton must hide stale SSR groups until chrome resolves
  it('shows skeleton (not stale SSR groups) while chrome API is loading', async () => {
    const previousFetch = global.fetch
    const previousWindowFetch = window.fetch
    const previousOriginalFetch = (window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
    let resolveFetch: ((response: Response) => void) | null = null
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()
      if (url.includes('/api/auth/admin/nav-flicker-regression')) {
        return fetchPromise
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    global.fetch = fetchMock
    window.fetch = fetchMock
    ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock

    const staleGroups = [
      {
        id: 'core',
        name: 'Stale Core',
        items: [{ href: '/backend/stale-link', title: 'Stale Link' }],
      },
    ]

    try {
      renderWithProviders(
        <AppShell
          email="demo@example.com"
          groups={staleGroups}
          adminNavApi="/api/auth/admin/nav-flicker-regression"
        >
          <div>Hydrated content</div>
        </AppShell>,
        { dict },
      )

      await waitFor(() => {
        expect(screen.getAllByTestId('backend-chrome-loading').length).toBeGreaterThan(0)
      })
      expect(screen.queryByText('Stale Link')).toBeNull()
      expect(screen.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'false')

      resolveFetch?.(new Response(JSON.stringify({
        groups: [
          {
            id: 'core',
            name: 'Core',
            defaultName: 'Core',
            items: [
              {
                href: '/backend/users',
                title: 'Fresh Link',
                defaultTitle: 'Fresh Link',
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
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

      await waitFor(() => {
        expect(screen.getByText('Fresh Link')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('backend-chrome-loading')).toBeNull()
      expect(screen.queryByText('Stale Link')).toBeNull()
    } finally {
      global.fetch = previousFetch
      window.fetch = previousWindowFetch
      ;(window as Window & { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = previousOriginalFetch
    }
  })
})
