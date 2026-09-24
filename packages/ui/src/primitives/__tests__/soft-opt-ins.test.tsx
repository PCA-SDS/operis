/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { IconButton } from '../icon-button'
import { Tabs, TabsList, TabsTrigger } from '../tabs'
import { FormSection } from '../../backend/forms/FormSection'

describe('IconButton soft variant', () => {
  it('paints the brand-tinted soft fill with a transparent border', () => {
    render(<IconButton variant="soft" aria-label="Edit">x</IconButton>)
    const button = screen.getByRole('button', { name: 'Edit' })
    expect(button.className).toContain('bg-primary-soft')
    expect(button.className).toContain('border-transparent')
    expect(button.className).not.toContain('bg-surface')
  })

  it('leaves the default outline variant unchanged', () => {
    render(<IconButton aria-label="Edit">x</IconButton>)
    expect(screen.getByRole('button', { name: 'Edit' }).className).toContain('border-border')
  })
})

describe('Tabs reserveActiveWidth', () => {
  function renderTabs(reserve?: boolean) {
    return render(
      <Tabs value="a" onValueChange={() => {}} variant="underline" reserveActiveWidth={reserve}>
        <TabsList aria-label="Sections">
          <TabsTrigger value="a">Alpha</TabsTrigger>
          <TabsTrigger value="b">Beta</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
  }

  it('reserves the semibold width on every trigger without duplicating the label', () => {
    renderTabs(true)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Alpha', 'Beta'])
    for (const tab of tabs) {
      const label = tab.querySelector('[data-label]') as HTMLElement
      expect(label.getAttribute('data-label')).toBe(tab.textContent)
      expect(label.className).toContain('after:font-semibold')
      expect(label.className).toContain('after:content-[attr(data-label)]')
    }
  })

  it('renders a plain label per trigger by default', () => {
    renderTabs()
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.querySelector('[data-label]')).toBeNull()
    }
  })
})

describe('FormSection panel', () => {
  it('draws the tinted section panel by default', () => {
    const { container } = render(<FormSection title="Details">field</FormSection>)
    expect(container.querySelector('[data-crud-section="true"]')).not.toBeNull()
  })

  it('lays the fields out flat when panel is false', () => {
    const { container } = render(<FormSection title="Details" panel={false}>field</FormSection>)
    expect(container.querySelector('[data-crud-section]')).toBeNull()
    expect(container.textContent).toContain('field')
  })
})
