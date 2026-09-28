/** @jest-environment jsdom */
jest.setTimeout(15000)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn(async () => ({ ok: true, data: {} })) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const fields: CrudField[] = [
  { id: 'email', label: 'Email', type: 'text', layout: 'half' },
  { id: 'phone', label: 'Phone', type: 'text', layout: 'half' },
  { id: 'onboarded', label: 'Onboarded', type: 'text', layout: 'third' },
  { id: 'registered', label: 'Registered', type: 'text', layout: 'third' },
  { id: 'ended', label: 'Ended', type: 'text', layout: 'third' },
]

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['email', 'phone'] },
  { id: 'lifecycle', title: 'Lifecycle', column: 2, fields: ['onboarded', 'registered', 'ended'] },
]

function renderForm() {
  return renderWithProviders(
    React.createElement(CrudForm as never, {
      title: 'Company',
      fields,
      groups,
      onSubmit: () => {},
    }),
  )
}

function tokens(element: Element | null): string[] {
  return (element?.className ?? '').split(/\s+/).filter(Boolean)
}

describe('CrudForm spacing', () => {
  it('sets the columns 32px apart and each column\'s sections 32px apart', async () => {
    const { container } = renderForm()
    await waitFor(() => expect(screen.getByText('Lifecycle')).toBeInTheDocument())

    const columns = Array.from(container.querySelectorAll('div')).find((node) =>
      tokens(node).includes('lg:grid-cols-[7fr_3fr]'),
    )
    expect(tokens(columns)).toEqual(expect.arrayContaining(['gap-8']))
    expect(tokens(columns)).not.toContain('gap-4')
    for (const stack of Array.from(columns?.children ?? [])) {
      expect(tokens(stack)).toContain('space-y-8')
    }
  })

  it('pads each section panel 32px and spaces its fields 24px apart', async () => {
    const { container } = renderForm()
    await waitFor(() => expect(screen.getByText('Details')).toBeInTheDocument())

    const panels = container.querySelectorAll('[data-crud-section="true"]')
    expect(panels.length).toBe(2)
    for (const panel of Array.from(panels)) {
      expect(tokens(panel)).toContain('sm:p-8')
      const grid = panel.querySelector('.grid')
      expect(tokens(grid)).toContain('gap-6')
    }
  })

  it('lays fields side by side only when their own column is wide enough, not the screen alone', async () => {
    // The side column put three date pickers in 283px, because the grid split on
    // the screen width. The grid now measures its own wrapper as well.
    const { container } = renderForm()
    await waitFor(() => expect(screen.getByText('Registered')).toBeInTheDocument())

    const grids = Array.from(container.querySelectorAll('[data-crud-section="true"] .grid'))
    for (const grid of grids) {
      expect(tokens(grid.parentElement)).toContain('@container/crud-fields')
      expect(tokens(grid)).toContain('md:@md/crud-fields:grid-cols-6')
      expect(tokens(grid)).not.toContain('md:grid-cols-6')
    }

    const third = screen.getByText('Registered').closest('[class*="col-span"]')
    expect(tokens(third)).toContain('md:@md/crud-fields:col-span-2')
    expect(tokens(third)).not.toContain('md:col-span-2')
  })
})
