/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'

let pathname = '/backend'

jest.mock('next/navigation', () => ({ usePathname: () => pathname }))

import BackendLoading from '../loading'

/**
 * The backend is one catch-all route, so every page shares a single Suspense
 * fallback. Chat is the one surface that is not a list, and showing it eight
 * full-width table rows meant the whole content area moved when the two-pane
 * transcript arrived.
 */
describe('backend loading fallback', () => {
  const skeletons = () => screen.getAllByRole('status')

  it('shows the list shape for an ordinary backend page', () => {
    pathname = '/backend/customers/companies'
    const { container } = render(<BackendLoading />)

    expect(container.querySelector('.grid')).toBeNull()
    // Eight body rows plus a header row, which is what a DataTable resolves to.
    expect(skeletons().length).toBeGreaterThan(30)
  })

  it('shows the transcript shape for chat', () => {
    pathname = '/backend/chat/4213e1d0-ca21-4a09-9652-b7c50c225cc4'
    const { container } = render(<BackendLoading />)

    // The rail-and-pane grid `ChatShell` renders, so the columns do not move.
    const grid = container.querySelector('.grid')
    expect(grid).not.toBeNull()
    expect(grid?.className).toContain('16rem')
    expect(container.querySelector('section')).not.toBeNull()
  })

  it('gives the transcript bubbles on both sides', () => {
    pathname = '/backend/chat'
    const { container } = render(<BackendLoading />)

    // Alternating alignment is what makes it read as a conversation rather than
    // a list of rows; every row down the left would jump on arrival.
    const rows = Array.from(container.querySelectorAll('.rounded-2xl'))
    expect(rows.length).toBeGreaterThan(3)
    expect(rows.some((row) => row.className.includes('bg-primary-soft'))).toBe(true)
    expect(rows.some((row) => row.className.includes('bg-surface-muted'))).toBe(true)
  })

  it('is announced while it is on screen', () => {
    pathname = '/backend/chat'
    render(<BackendLoading />)
    expect(skeletons()[0]).toHaveAttribute('aria-busy', 'true')
  })
})
