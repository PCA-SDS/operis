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
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const fields: CrudField[] = [
  { id: 'email', label: 'Email', type: 'text', layout: 'half' },
  { id: 'phone', label: 'Phone', type: 'text', layout: 'half' },
  { id: 'bio', label: 'Bio', type: 'textarea', rows: 4 },
  { id: 'active', label: 'Active', type: 'checkbox' },
  { id: 'notes', label: 'Notes', type: 'text' },
]

const groups: CrudFormGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['email', 'phone', 'bio', 'active'] },
  { id: 'extra', title: 'Extra', column: 2, fields: ['notes'] },
]

function renderForm(props: Record<string, unknown>) {
  return renderWithProviders(
    React.createElement(CrudForm as never, {
      title: 'Person',
      fields,
      onSubmit: () => {},
      isLoading: true,
      loadingMessage: 'Loading person',
      ...props,
    }),
  )
}

describe('CrudForm while its record loads', () => {
  it('draws its own sections and labels in place of the form, announcing its loading message', () => {
    const { container } = renderForm({ groups })
    expect(screen.getByRole('status')).toHaveTextContent('Loading person')
    expect(screen.getByText('Details')).toBeInTheDocument()
    expect(screen.getByText('Extra')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
    // No live controls: nothing to type into before the values arrive.
    const body = container.querySelector('[data-slot="page-skeleton"]')!
    expect(body.querySelector('input, textarea, form')).toBeNull()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('keeps each field’s span and control shape', () => {
    const { container } = renderForm({ groups })
    const body = container.querySelector('[data-slot="page-skeleton"]')!
    expect(body.querySelectorAll('[class*="md:@md/crud-fields:col-span-3"]')).toHaveLength(2)
    expect((body.querySelector('[style]') as HTMLElement).style.height).toBe('98px')
    const active = screen.getByText('Active').closest('[aria-hidden="true"]')
    expect(active?.querySelector('.size-4')).not.toBeNull()
  })

  it('lays a form without groups out as one untitled panel of its fields', () => {
    const { container } = renderForm({})
    const body = container.querySelector('[data-slot="page-skeleton"]')!
    expect(body.querySelectorAll('section')).toHaveLength(1)
    expect(body.querySelector('section header')).toBeNull()
    expect(screen.getByText('Bio')).toBeInTheDocument()
  })

  it('shows the real form once the record has loaded', () => {
    const { container } = renderForm({ groups, isLoading: false })
    expect(container.querySelector('[data-slot="page-skeleton"]')).toBeNull()
    expect(container.querySelector('form')).not.toBeNull()
  })
})
