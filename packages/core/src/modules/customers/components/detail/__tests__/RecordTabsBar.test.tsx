/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { planRecordTabs, RecordTabsBar } from '../RecordTabsBar'

const widths = { activities: 80, emails: 60, companies: 100, addresses: 90, tasks: 60, changelog: 90, files: 50 }
const ids = Object.keys(widths)
// 530px of tabs plus six 16px gaps.
const allTabsWidth = 530 + 6 * 16

describe('planRecordTabs', () => {
  it('shows every tab when they all fit', () => {
    expect(planRecordTabs(ids, widths, allTabsWidth, 70, 'activities')).toEqual({ visible: ids, overflow: [] })
  })

  it('shows every tab until the strip has been measured', () => {
    expect(planRecordTabs(ids, widths, 0, 70, 'activities')).toEqual({ visible: ids, overflow: [] })
  })

  it('keeps the tabs that fit, in order, and puts the rest behind More', () => {
    // 400px: room for More (70 + 16) leaves 314 for tabs: activities, emails and companies (272 with gaps).
    expect(planRecordTabs(ids, widths, 400, 70, 'activities')).toEqual({
      visible: ['activities', 'emails', 'companies'],
      overflow: ['addresses', 'tasks', 'changelog', 'files'],
    })
  })

  it('keeps the active tab in view by giving it the last place before More', () => {
    // Files (50) is kept first; activities and emails fit beside it (222 with gaps), companies would not.
    expect(planRecordTabs(ids, widths, 400, 70, 'files')).toEqual({
      visible: ['activities', 'emails', 'files'],
      overflow: ['companies', 'addresses', 'tasks', 'changelog'],
    })
  })
})

describe('RecordTabsBar', () => {
  it('draws counts as quiet numbers inside the tab, and the section action as a soft button', () => {
    const onAction = jest.fn()
    renderWithProviders(
      <RecordTabsBar
        tabs={[
          { id: 'people', label: 'People', count: 3 },
          { id: 'files', label: 'Files' },
        ]}
        activeTab="people"
        onTabChange={jest.fn()}
        ariaLabel="Sections"
        sectionAction={{ label: 'Add person', onClick: onAction }}
      />,
    )

    const people = screen.getByRole('tab', { name: 'People 3' })
    expect(people).toHaveAttribute('aria-selected', 'true')
    // One weight in every state, so choosing a tab never shifts the strip.
    expect(people.className).toContain('font-medium')
    expect(people.className).not.toContain('font-semibold')
    expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument()

    const action = screen.getByRole('button', { name: 'Add person' })
    expect(action.className).toContain('bg-primary-soft')
    fireEvent.click(action)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('switches tabs', () => {
    const onTabChange = jest.fn()
    renderWithProviders(
      <RecordTabsBar
        tabs={[{ id: 'people', label: 'People' }, { id: 'files', label: 'Files' }]}
        activeTab="people"
        onTabChange={onTabChange}
        ariaLabel="Sections"
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
    expect(onTabChange).toHaveBeenCalledWith('files')
  })
})
