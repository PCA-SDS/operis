/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CalendarSettingsModal, CALENDAR_SHORTCUTS } from '../CalendarSettingsModal'
import { DEFAULT_CALENDAR_PREFERENCES } from '../../../lib/calendar/preferences'

function renderModal(overrides: { onSave?: () => void; onOpenChange?: () => void } = {}) {
  return renderWithProviders(
    <CalendarSettingsModal
      open
      preferences={DEFAULT_CALENDAR_PREFERENCES}
      seedActivityTypes={['Call', 'Meeting']}
      onOpenChange={overrides.onOpenChange ?? jest.fn()}
      onSave={overrides.onSave ?? jest.fn()}
    />,
    { locale: 'en' },
  )
}

afterEach(cleanup)

describe('CalendarSettingsModal', () => {
  it('carries the keyboard shortcut legend, which no longer has a dialog of its own', () => {
    const { getByRole, getByText } = renderModal()
    expect(getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    // Every key the screen binds, so folding the dialog in dropped nothing.
    for (const shortcut of CALENDAR_SHORTCUTS) {
      expect(getByText(shortcut.key)).toBeInTheDocument()
    }
  })

  it('uses the shared dialog shell rather than a hand-rolled header and footer', () => {
    // The old modal drew its own title row with a CloseButton and its own
    // button band, on a 400px width class. The shell supplies all three, which
    // is what keeps this modal, the event editor and the reference in step.
    const { getByRole } = renderModal()
    expect(getByRole('heading', { name: 'Customization' })).toBeInTheDocument()
    expect(getByRole('button', { name: 'Close' })).toBeInTheDocument()
    // The dialog portals out of the render container, so query the document.
    expect(document.querySelector('[data-slot="dialog-header"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-footer"]')).not.toBeNull()
  })

  it('saves the draft and closes', () => {
    const onSave = jest.fn()
    const onOpenChange = jest.fn()
    const { getByRole } = renderModal({ onSave, onOpenChange })
    fireEvent.click(getByRole('button', { name: 'Save Changes' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
