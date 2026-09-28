/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivityTimelineFilters } from '../ActivityTimelineFilters'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

const baseProps = {
  entityId: 'person-123',
  dateFrom: '',
  dateTo: '',
  onDateFromChange: jest.fn(),
  onDateToChange: jest.fn(),
  onReset: jest.fn(),
}

beforeEach(() => {
  readApiResultOrThrowMock.mockReset()
  readApiResultOrThrowMock.mockResolvedValue({ call: 18, email: 4, meeting: 2, note: 0, total: 24 })
})

function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
}

describe('ActivityTimelineFilters', () => {
  it('is one quiet Filter button until something is filtered', async () => {
    renderWithProviders(
      <ActivityTimelineFilters {...baseProps} activeTypes={[]} onTypesChange={jest.fn()} />,
    )

    const button = screen.getByRole('button', { name: 'Filter' })
    expect(button).not.toHaveAttribute('data-filtered')
    // No chip row: the types live in the popover.
    expect(screen.queryByRole('checkbox')).toBeNull()

    openFilters()
    for (const name of [/^note/i, /^call/i, /^meeting/i, /^email/i, /^task/i]) {
      expect(await screen.findByRole('checkbox', { name })).not.toBeChecked()
    }
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeDisabled()
  })

  it('marks the button and the chosen types while filtered', async () => {
    renderWithProviders(
      <ActivityTimelineFilters {...baseProps} activeTypes={['call']} onTypesChange={jest.fn()} />,
    )

    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('data-filtered', 'true')
    openFilters()
    expect(await screen.findByRole('checkbox', { name: /^call/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^email/i })).not.toBeChecked()
  })

  it('clears every filter at once', async () => {
    const onReset = jest.fn()
    renderWithProviders(
      <ActivityTimelineFilters {...baseProps} onReset={onReset} activeTypes={['call', 'email']} onTypesChange={jest.fn()} />,
    )

    openFilters()
    fireEvent.click(await screen.findByRole('button', { name: /clear filters/i }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it("shows each type's count for this record", async () => {
    renderWithProviders(
      <ActivityTimelineFilters {...baseProps} activeTypes={[]} onTypesChange={jest.fn()} />,
    )

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/customers/interactions/counts?entityId=person-123'),
        expect.any(Object),
      )
    })

    openFilters()
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /call 18/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('checkbox', { name: /email 4/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /meeting 2/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^note$/i })).toBeInTheDocument()
  })

  it('toggling a type calls onTypesChange with the new selection', async () => {
    const onTypesChange = jest.fn()
    const { rerender } = renderWithProviders(
      <ActivityTimelineFilters {...baseProps} activeTypes={[]} onTypesChange={onTypesChange} />,
    )

    openFilters()
    fireEvent.click(await screen.findByRole('checkbox', { name: /^call/i }))
    expect(onTypesChange).toHaveBeenLastCalledWith(['call'])

    rerender(<ActivityTimelineFilters {...baseProps} activeTypes={['call']} onTypesChange={onTypesChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /^call/i }))
    expect(onTypesChange).toHaveBeenLastCalledWith([])
  })
})
