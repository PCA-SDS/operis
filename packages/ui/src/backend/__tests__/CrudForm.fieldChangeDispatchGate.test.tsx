/** @jest-environment jsdom */
const pushMock = jest.fn()
const triggerEventMock = jest.fn()
const confirmDialogMock = jest.fn()
const flashMock = jest.fn()

// The widget list the mocked useInjectionSpotEvents reports back to CrudForm.
// `undefined` reproduces a host/test double that does not surface it at all.
let spotWidgets: unknown

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmDialogMock, ConfirmDialogElement: null }),
}))
jest.mock('../FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: triggerEventMock, widgets: spotWidgets }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const fields: CrudField[] = [{ id: 'title', label: 'Title', type: 'text' }]

function widget(handlers: Record<string, unknown>) {
  return { moduleId: 'example', widgetId: 'w1', key: 'w1', module: { eventHandlers: handlers } }
}

function renderForm() {
  return renderWithProviders(
    <CrudForm
      title="Form"
      fields={fields}
      initialValues={{ title: '' }}
      injectionSpotId="example:gate"
      onSubmit={() => {}}
    />,
    { dict: {} },
  )
}

async function typeIntoTitle(container: HTMLElement) {
  const input = container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement
  expect(input).toBeTruthy()
  fireEvent.change(input, { target: { value: 'abc' } })
}

function fieldChangeCalls() {
  return triggerEventMock.mock.calls.filter(([event]) => event === 'onFieldChange')
}

describe('CrudForm onFieldChange dispatch gate', () => {
  beforeEach(() => {
    triggerEventMock.mockReset()
    triggerEventMock.mockImplementation(async (_event: string, data: Record<string, unknown>) => ({ ok: true, data }))
    confirmDialogMock.mockReset()
    flashMock.mockReset()
    spotWidgets = undefined
  })

  it('skips the per-keystroke dispatch when no registered widget handles onFieldChange', async () => {
    spotWidgets = [widget({ onBeforeSave: () => true })]
    const { container } = renderForm()

    await typeIntoTitle(container)

    await waitFor(() => {
      expect((container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement).value).toBe('abc')
    })
    expect(fieldChangeCalls()).toHaveLength(0)
  })

  it('still dispatches when a registered widget handles onFieldChange', async () => {
    spotWidgets = [widget({ onFieldChange: () => undefined })]
    const { container } = renderForm()

    await typeIntoTitle(container)

    await waitFor(() => { expect(fieldChangeCalls().length).toBeGreaterThan(0) })
  })

  it('fails open and dispatches when the host does not surface a widget list', async () => {
    // Every pre-existing CrudForm test double returns `{ triggerEvent }` only.
    // Treating that as "no handlers" would silently disable the feature, so an
    // unknown list must keep the original always-dispatch behavior.
    spotWidgets = undefined
    const { container } = renderForm()

    await typeIntoTitle(container)

    await waitFor(() => { expect(fieldChangeCalls().length).toBeGreaterThan(0) })
  })
})
