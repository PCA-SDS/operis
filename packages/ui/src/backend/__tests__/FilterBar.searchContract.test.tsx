/** @jest-environment jsdom */

/**
 * The integration suite reaches every list-view search box through the ARIA
 * contract this file pins down:
 *
 *   getByRole('searchbox', { name: 'Search', exact: true })   TC-ADMIN-001/002/007,
 *                                                            TC-AUTH-010..013,
 *                                                            TC-INT-004, TC-CAT-012
 *   getByRole('searchbox', { name: 'Search categories' })     TC-CAT-007, TC-CAT-008
 *   main input[placeholder="Search"]                          TC-EXAMPLE-003/017
 *
 * That contract is not a detail of `FilterBar` — it comes from the `SearchInput`
 * primitive underneath (`type="search"` → role `searchbox`, placeholder → the
 * accessible name). Restyling the primitive must never move it, and a jsdom
 * test fails in seconds where the Playwright specs need a seeded database.
 */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { FilterBar } from '../FilterBar'

function renderFilterBar(props: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
  return render(<FilterBar onSearchChange={() => {}} {...props} />)
}

/* Playwright derives the accessible name of an unlabelled input from its
   `placeholder`; jsdom's `dom-accessibility-api` does not implement that
   fallback, so asserting `getByRole(..., { name })` here would test the shim,
   not the product. The two inputs Playwright's computation actually reads —
   the `searchbox` role and the verbatim placeholder — are asserted instead. */
describe('FilterBar search — integration ARIA contract', () => {
  it('exposes exactly one role="searchbox" by default', () => {
    renderFilterBar()
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('renders placeholder="Search" verbatim — the name specs match on', () => {
    const { container } = renderFilterBar()
    const input = container.querySelector('input[placeholder="Search"]')
    expect(input).not.toBeNull()
    expect(input).toHaveAttribute('type', 'search')
  })

  it('carries a surface-specific placeholder through unchanged', () => {
    const { container } = renderFilterBar({ searchPlaceholder: 'Search categories' })
    expect(container.querySelector('input[placeholder="Search categories"]')).not.toBeNull()
  })

  it('adds no aria-label or aria-labelledby that would displace the placeholder name', () => {
    const input = renderFilterBar().container.querySelector('input[type="search"]') as HTMLInputElement
    expect(input.getAttribute('aria-label')).toBeNull()
    expect(input.getAttribute('aria-labelledby')).toBeNull()
  })

  it('renders no search box at all when the host passes no onSearchChange', () => {
    render(<FilterBar />)
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('exposes the clear button under its documented accessible name', () => {
    renderFilterBar({ searchValue: 'acme' })
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })
})
