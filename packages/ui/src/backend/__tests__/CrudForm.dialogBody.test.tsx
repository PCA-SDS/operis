/** @jest-environment jsdom */
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('../FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: async (_event: string, data: unknown) => ({ ok: true, data }) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const fields: CrudField[] = [{ id: 'title', label: 'Title', type: 'text', required: true }]

function renderForm(dialogBodyClassName?: string, extraActions?: React.ReactNode) {
  return renderWithProviders(
    <CrudForm
      embedded
      fields={fields}
      initialValues={{ title: '' }}
      submitLabel="Save"
      onSubmit={async () => {}}
      dialogBodyClassName={dialogBodyClassName}
      extraActions={extraActions}
    />,
  )
}

describe('CrudForm dialogBodyClassName', () => {
  it('keeps the content-sized layout by default', () => {
    const { container } = renderForm()
    expect(container.querySelector('[data-dialog-form]')).toBeNull()
  })

  it('puts the fields in a fixed data-dialog-form body and the footer below it, unruled', () => {
    const { container } = renderForm('h-[min(70vh,40rem)] overflow-y-auto')
    const body = container.querySelector('[data-dialog-form="true"]') as HTMLElement
    expect(body).not.toBeNull()
    expect(body.className).toContain('h-[min(70vh,40rem)]')
    expect(body.querySelector('input')).not.toBeNull()

    const submit = container.querySelector('button[type="submit"]') as HTMLElement
    expect(body.contains(submit)).toBe(false)
    const footer = submit.closest('form > *') as HTMLElement
    expect(footer.className).not.toContain('border-t')
    expect(footer.className).not.toContain('sticky')
  })

  it('renders extraActions only in the footer of a fixed dialog body', () => {
    const cancel = <button type="button">Cancel</button>
    const fixed = renderForm('h-[min(70vh,40rem)]', cancel)
    expect(fixed.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
    fixed.unmount()

    const legacy = renderForm(undefined, cancel)
    expect(legacy.getAllByRole('button', { name: 'Cancel' }).length).toBeGreaterThan(1)
  })
})
