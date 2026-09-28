/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ModuleLayout,
  ModuleSidebar,
  ModuleSidebarAction,
  ModuleSidebarLink,
  ModuleSidebarSection,
  ModuleSidebarSectionLabel,
} from '../ModuleSidebar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/tasks/today',
}))

describe('module sidebar parts', () => {
  it('draws a row in primary ink with an accent icon, and the selected row on the selection fill', () => {
    render(
      <ModuleSidebar label="Tasks navigation" title="Tasks">
        <ModuleSidebarLink href="/backend/tasks/all" icon={<svg data-testid="all-icon" />} label="All Tasks" active={false} />
        <ModuleSidebarLink href="/backend/tasks/today" icon={<svg />} label="Today" active count={2} />
      </ModuleSidebar>,
    )
    const idle = screen.getByRole('link', { name: 'All Tasks' })
    expect(idle).toHaveClass('text-foreground')
    expect(screen.getByTestId('all-icon').parentElement).toHaveClass('text-primary')
    const active = screen.getByRole('link', { name: /Today/ })
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(active).toHaveClass('bg-primary-soft', 'text-primary')
    expect(screen.getByText('2')).toHaveClass('text-muted-foreground')
  })

  it('gives a section a linked label and one action at its end', () => {
    const onNew = jest.fn()
    render(
      <ModuleSidebar label="Tasks navigation">
        <ModuleSidebarSection
          label="My Projects"
          href="/backend/tasks/projects"
          action={{ icon: <svg />, label: 'New project', onClick: onNew }}
        >
          <ModuleSidebarLink href="/backend/tasks/projects/1" label="Launch" active={false} />
        </ModuleSidebarSection>
      </ModuleSidebar>,
    )
    expect(screen.getByRole('link', { name: 'My Projects' })).toHaveAttribute('href', '/backend/tasks/projects')
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Launch' })).toBeInTheDocument()
  })

  it('holds rows while a section loads and shows its empty lines when it has no links', () => {
    const { rerender, container } = render(
      <ModuleSidebar label="Tasks navigation">
        <ModuleSidebarSection label="My Projects" loading empty={{ title: 'No projects yet', description: 'Use the + above.' }} />
      </ModuleSidebar>,
    )
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument()
    rerender(
      <ModuleSidebar label="Tasks navigation">
        <ModuleSidebarSection label="My Projects" empty={{ title: 'No projects yet', description: 'Use the + above.' }} />
      </ModuleSidebar>,
    )
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByText('Use the + above.')).toBeInTheDocument()
  })

  it('collapses to icons when the module offers a toggle', () => {
    const onToggle = jest.fn()
    const { container } = render(
      <ModuleLayout
        collapsed
        sidebar={(
          <ModuleSidebar
            label="Design system"
            title="Design system"
            collapsed
            onToggleCollapse={onToggle}
            toggleLabels={{ collapse: 'Collapse', expand: 'Expand' }}
          >
            <ModuleSidebarSectionLabel>Foundations</ModuleSidebarSectionLabel>
            <ModuleSidebarAction icon={<svg />} label="Add" onClick={() => {}} />
            <ModuleSidebarLink href="/backend/design-system?family=color" icon={<svg />} label="Colour" active={false} />
          </ModuleSidebar>
        )}
      >
        <p>content</p>
      </ModuleLayout>,
    )
    const toggle = screen.getByRole('button', { name: 'Expand' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Foundations')).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Colour' })
    expect(link).toHaveAttribute('title', 'Colour')
    expect(screen.getByText('Colour')).toHaveClass('md:sr-only')
    expect(screen.getByText('Add')).toHaveClass('md:sr-only')
    expect(container.querySelector('[data-module-layout]')).toHaveClass('md:grid-cols-[3.5rem_minmax(0,1fr)]')
  })

  it('keeps a sidebar without a toggle exactly as it was', () => {
    const { container } = render(
      <ModuleLayout sidebar={<ModuleSidebar label="Customers navigation" title="Customers"><ModuleSidebarSectionLabel>Records</ModuleSidebarSectionLabel></ModuleSidebar>}>
        <p>content</p>
      </ModuleLayout>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Customers')).toHaveClass('text-sm', 'font-semibold')
    expect(screen.getByText('Records')).toBeInTheDocument()
    expect(container.querySelector('[data-module-layout]')).toHaveClass('md:grid-cols-[14rem_minmax(0,1fr)]')
  })
})
