/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  DashboardSkeleton,
  DetailPageSkeleton,
  FormSkeleton,
  LIST_SKELETON_ROW_COUNT,
  ListPageSkeleton,
  PageLoadingIndicator,
} from '../PageSkeletons'

describe('FormSkeleton', () => {
  it('sets the form’s own section titles and labels, hidden from assistive tech, and announces the form’s message', () => {
    const { container } = renderWithProviders(
      <FormSkeleton
        label="Loading person"
        columns={[
          [{ title: 'Details', fields: [{ span: 'full', label: 'Email' }, { span: 'half', label: 'First name' }] }],
          [{ title: 'Notes', fields: [{ span: 'full', control: 'textarea', rows: 4, label: 'Summary' }] }],
        ]}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading person')
    expect(screen.getByText('Details')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Email')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Summary')).toBeInTheDocument()
    expect(container.querySelector('input, textarea, button')).toBeNull()
  })

  it('draws each control at its real height', () => {
    const { container } = renderWithProviders(
      <FormSkeleton
        columns={[[{
          title: 'Details',
          fields: [
            { span: 'full', label: 'Name' },
            { span: 'full', control: 'textarea', rows: 4, label: 'Bio' },
            { span: 'full', control: 'textarea', label: 'Notes' },
            { span: 'full', control: 'checkbox', label: 'Active' },
            { span: 'full', label: 'Website', hint: true },
          ],
        }]]}
      />,
    )
    const fields = Array.from(container.querySelectorAll('[class*="md:@md/crud-fields:col-span-6"]'))
    expect(fields).toHaveLength(5)
    expect(fields[0]!.querySelector('.h-9')).not.toBeNull()
    // Four 20px lines, the textarea's padding and its border; two rows still fill `min-h-20`.
    expect((fields[1]!.querySelector('[style]') as HTMLElement).style.height).toBe('98px')
    expect((fields[2]!.querySelector('[style]') as HTMLElement).style.height).toBe('80px')
    expect(fields[3]!.querySelector('.size-4')).not.toBeNull()
    expect(fields[3]).toHaveTextContent('Active')
    expect(fields[4]!.querySelector('.mt-1\\.5.h-4\\.5')).not.toBeNull()
  })

  it('leaves out the header of an untitled section and the panel of a flat one', () => {
    const { container } = renderWithProviders(
      <FormSkeleton columns={[[{ title: null, panel: false, fields: [{ label: 'Name' }] }]]} />,
    )
    expect(container.querySelector('section header')).toBeNull()
    expect(container.querySelector('.bg-surface-muted.rounded-xl')).toBeNull()
  })

  it('draws the footer’s buttons as the form will', () => {
    const { container } = renderWithProviders(
      <FormSkeleton columns={[[{ fields: [] }]]} footer={{ withDelete: true, withCancel: true }} />,
    )
    const footer = container.querySelector('.justify-between')
    expect(footer?.querySelectorAll('.h-9')).toHaveLength(3)
  })
})

describe('ListPageSkeleton', () => {
  it('draws the title row, the toolbar, a header row and the table’s rows, with no pager', () => {
    const { container } = renderWithProviders(<ListPageSkeleton />)
    const rows = container.querySelectorAll('[data-slot="table-row"]')
    expect(rows).toHaveLength(LIST_SKELETON_ROW_COUNT + 1)
    expect(container.querySelector('[role="navigation"]')).toBeNull()
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })
})

describe('DetailPageSkeleton', () => {
  it('announces the page’s own loading message', () => {
    renderWithProviders(<DetailPageSkeleton label="Loading company" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading company')
  })
})

describe('DashboardSkeleton', () => {
  it('draws a row of widget cards, each with a two-line description', () => {
    const { container } = renderWithProviders(<DashboardSkeleton />)
    const cards = container.querySelectorAll('.grid > .rounded-xl')
    expect(cards).toHaveLength(3)
    expect(cards[0]!.querySelectorAll(':scope > div:first-child > span')).toHaveLength(3)
  })
})

describe('PageLoadingIndicator', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('shows nothing for a moment, so a quick navigation does not flash it, then a spinner', () => {
    const { container } = renderWithProviders(<PageLoadingIndicator delayMs={400} />)
    const region = container.querySelector('[data-slot="page-loading"]')
    expect(region).not.toBeNull()
    expect(region?.querySelector('[role="status"]')).toBeNull()
    act(() => {
      jest.advanceTimersByTime(400)
    })
    expect(region?.querySelector('[role="status"]')).not.toBeNull()
  })
})
