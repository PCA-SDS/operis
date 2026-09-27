/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

let pathname = '/backend'

jest.mock('next/navigation', () => ({ usePathname: () => pathname }))

const frames: Array<{ enabled: boolean; routeGroupId?: string | null; routeParentHref?: string | null }> = []

jest.mock('@open-mercato/ui/backend/module-nav/BackendModuleFrame', () => ({
  BackendModuleFrame: ({
    children,
    ...props
  }: {
    children: React.ReactNode
    enabled: boolean
    routeGroupId?: string | null
    routeParentHref?: string | null
  }) => {
    frames.push(props)
    return <div data-module-frame="">{children}</div>
  },
}))

jest.mock('@open-mercato/core/modules/customers/components/calendar/CalendarPageSkeleton', () => ({
  CalendarPageSkeleton: () => <div data-testid="calendar-skeleton" />,
}))

import BackendLoading from '../loading'
import { BackendRouteShapesProvider } from '@open-mercato/ui/backend/skeletons/BackendRouteShapesProvider'
import { buildBackendRouteShapes } from '@open-mercato/ui/backend/skeletons/backendRouteShapes'

const shapes = buildBackendRouteShapes([
  { pattern: '/backend/customers/people', loadingSkeleton: 'list' },
  { pattern: '/backend/calendar', loadingSkeleton: 'calendar' },
  { pattern: '/backend/chat', moduleSidebar: false, loadingSkeleton: 'conversation' },
  { pattern: '/backend/tasks/today', moduleSidebar: false },
  {
    pattern: '/backend/customers/people-v2/[id]',
    navHidden: true,
    loadingSkeleton: 'detail',
    groupKey: 'customers.nav.group',
    breadcrumb: [{ label: 'People', href: '/backend/customers/people' }],
  },
  { pattern: '/backend/chat/[conversationId]', moduleSidebar: false, loadingSkeleton: 'conversation' },
])

function renderAt(path: string) {
  pathname = path
  frames.length = 0
  return renderWithProviders(
    <BackendRouteShapesProvider shapes={shapes}>
      <BackendLoading />
    </BackendRouteShapesProvider>,
  )
}

/**
 * The backend is one catch-all route, so every page shares a single Suspense
 * fallback. It draws a page's shape only when the page declared one, and
 * frames every page the way the page will frame itself.
 */
describe('backend loading fallback', () => {
  it('draws the dashboard on the backend home, with no module frame', () => {
    const { container } = renderAt('/backend')
    const skeleton = container.querySelector('[data-slot="page-skeleton"]')
    expect(skeleton?.querySelectorAll('.grid > .rounded-xl')).toHaveLength(3)
    expect(frames).toHaveLength(0)
  })

  it('draws a declared list beside the module sidebar', () => {
    const { container } = renderAt('/backend/customers/people')
    expect(container.querySelectorAll('[data-slot="table-row"]').length).toBeGreaterThan(1)
    expect(frames).toEqual([{ enabled: true, routeGroupId: null, routeParentHref: null }])
  })

  it('places a record no nav link leads to in its module, lighting its parent page', () => {
    renderAt('/backend/customers/people-v2/1a052ce3-c8e6-44fa-80ad-dd452501f2cf')
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(frames).toEqual([
      { enabled: true, routeGroupId: 'customers.nav.group', routeParentHref: '/backend/customers/people' },
    ])
  })

  it('draws the calendar for the calendar route', () => {
    renderAt('/backend/calendar')
    expect(screen.getByTestId('calendar-skeleton')).toBeInTheDocument()
  })

  it('guesses at no shape for a page that declared none', () => {
    const { container } = renderAt('/backend/sales/orders')
    expect(container.querySelector('[data-slot="page-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="page-skeleton"]')).toBeNull()
    expect(frames).toEqual([{ enabled: true, routeGroupId: null, routeParentHref: null }])
  })

  it('leaves the module sidebar out for a page that draws its own', () => {
    renderAt('/backend/tasks/today')
    expect(frames).toEqual([{ enabled: false, routeGroupId: null, routeParentHref: null }])
  })

  it('draws the chat rail beside a blank card on the conversation list', () => {
    const { container } = renderAt('/backend/chat')
    const grid = container.querySelector('[data-slot="page-skeleton"]')
    expect(grid?.className).toContain('lg:grid-cols-[16rem_minmax(0,1fr)]')
    expect(container.querySelector('aside .bg-surface-muted')).not.toBeNull()
    expect(container.querySelector('section')?.children).toHaveLength(0)
    expect(frames[0]?.enabled).toBe(false)
  })

  it('gives a conversation transcript bubbles on both sides', () => {
    const { container } = renderAt('/backend/chat/4213e1d0-ca21-4a09-9652-b7c50c225cc4')
    // Alternating alignment is what makes it read as a conversation rather than
    // a list of rows; every row down the left would jump on arrival.
    const bubbles = Array.from(container.querySelectorAll('section .rounded-2xl'))
    expect(bubbles.length).toBeGreaterThan(3)
    expect(bubbles.some((bubble) => bubble.className.includes('bg-primary-soft'))).toBe(true)
    expect(bubbles.some((bubble) => !bubble.className.includes('bg-primary-soft'))).toBe(true)
  })
})
